/**
 * @module application/workflow-service
 * @description 工作流应用服务 - 11个用例
 */

import type { ProgressData, TaskEntry, WorkflowStats } from '../domain/types';
import type { WorkflowDefinition } from '../domain/workflow';
import type { CommitResult, WorkflowRepository } from '../domain/repository';
import { makeTaskId, cascadeSkip, findNextTask, findParallelTasks, completeTask, failTask, resumeProgress, isAllDone, reopenRollbackBranch } from '../domain/task-store';
import { runLifecycleHook } from '../infrastructure/hooks';
import { log, setWorkflowName } from '../infrastructure/logger';
import { collectStats, analyzeHistory, reflect, experiment, review } from '../infrastructure/history';
import { appendMemory, queryMemory, decayMemory, compactMemory, loadMemory } from '../infrastructure/memory';
import { extractAll } from '../infrastructure/extractor';
import { truncateHeadTail, computeMaxChars } from '../infrastructure/truncation';
import { detect as detectLoop, type LoopDetection } from '../infrastructure/loop-detector';
import { startHeartbeat, runHeartbeat } from '../infrastructure/heartbeat';
import { compareDirtyFilesAgainstBaseline, getTaskActivationAge, loadDirtyBaseline, recordTaskActivations, saveDirtyBaseline } from '../infrastructure/runtime-state';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';

const CHECKPOINT_FAILURE_PATTERNS = [
  /^FAILED\b/i,
  /^(?:fail(?:ed)?|error|crash(?:ed)?|timeout|timed out|rate[- ]?limit(?:ed)?)\b(?:(?:\s*[:\-])|(?:\s+(?:while|when|after|before|during|waiting|connecting|applying|fetching|reading|writing|running|executing|acquiring|get(?:ting)?|to|for))|$)/i,
  /^(?:失败|异常|超时|崩溃|限流|中断|未完成)(?:(?:[:：，。；、])|(?:导致|发生|退出|终止|中断|等待|卡住)|$)/,
  /^无法(?:完成|继续|执行|连接|获取|读取|写入|启动|构建|运行|应用)/,
] as const;

function isExplicitFailureCheckpoint(detail: string): boolean {
  const normalized = detail.trim();
  return CHECKPOINT_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export class WorkflowService {
  private stopHeartbeat: (() => void) | null = null;
  private readonly locallyActivatedTaskIds = new Set<string>();

  constructor(
    private readonly repo: WorkflowRepository,
    private readonly parse: (md: string) => WorkflowDefinition,
  ) {}

  private loopWarningPath(): string {
    return join(this.repo.projectRoot(), '.workflow', 'loop-warning.txt');
  }

  private async saveLoopWarning(msg: string): Promise<void> {
    const p = this.loopWarningPath();
    await mkdir(join(this.repo.projectRoot(), '.workflow'), { recursive: true });
    await writeFile(p, msg, 'utf-8');
  }

  private async loadAndClearLoopWarning(): Promise<string | null> {
    try {
      const msg = await readFile(this.loopWarningPath(), 'utf-8');
      await unlink(this.loopWarningPath());
      return msg || null;
    } catch { return null; }
  }

  /** 跨进程激活时长(ms)，仅当前实例刚激活的任务返回 Infinity（跳过检查） */
  private async getActivationAge(id: string): Promise<number> {
    if (this.locallyActivatedTaskIds.has(id)) {
      return Infinity;
    }
    return getTaskActivationAge(this.repo.projectRoot(), id);
  }

  /** init: 解析任务markdown → 生成progress/tasks */
  async init(tasksMd: string, force = false): Promise<ProgressData> {
    // 自愈检查：验证上轮实验效果
    try {
      const reviewResult = await review(this.repo.projectRoot());
      if (reviewResult.rolledBack) log.info(`[自愈] 已回滚: ${reviewResult.rollbackReason}`);
      for (const c of reviewResult.checks.filter(c => !c.passed)) log.info(`[自愈] ${c.name}: ${c.detail}`);
    } catch (e) {
      log.debug(`[自愈] review 跳过: ${e}`);
    }

    const existing = await this.repo.loadProgress();
    if (existing && existing.status === 'running' && !force) {
      throw new Error(`已有进行中的工作流: ${existing.name}，使用 --force 覆盖`);
    }
    const def = this.parse(tasksMd);
    const tasks: TaskEntry[] = def.tasks.map((t, i) => ({
      id: makeTaskId(i + 1),
      title: t.title,
      description: t.description,
      type: t.type,
      status: 'pending',
      deps: t.deps,
      summary: '',
      retries: 0,
    }));
    const data: ProgressData = {
      name: def.name,
      status: 'running',
      current: null,
      tasks,
      startTime: new Date().toISOString(),
    };
    this.locallyActivatedTaskIds.clear();
    setWorkflowName(def.name);
    await this.repo.saveProgress(data);
    await this.repo.saveTasks(tasksMd);
    await this.repo.saveSummary(`# ${def.name}\n\n${def.description}\n`);
    await saveDirtyBaseline(this.repo.projectRoot(), this.repo.listChangedFiles(), data.startTime);
    await this.repo.ensureClaudeMd();
    await this.repo.ensureHooks();
    await this.repo.ensureClaudeWorktreesIgnored();

    // 历史经验分析：读取历史统计，输出建议，自动调整参数
    await this.applyHistoryInsights();

    // 衰减归档过期记忆
    await decayMemory(this.repo.projectRoot());

    // 记忆条目超过阈值时自动压缩
    const memories = await loadMemory(this.repo.projectRoot());
    if (memories.filter(e => !e.archived).length > 50) {
      await compactMemory(this.repo.projectRoot());
    }

    // 启动心跳自检
    this.stopHeartbeat?.();
    this.stopHeartbeat = startHeartbeat(this.repo.projectRoot());

    return data;
  }

  /** next: 获取下一个可执行任务（含依赖上下文） */
  async next(): Promise<{ task: TaskEntry; context: string } | null> {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      if (isAllDone(data.tasks)) return null;

      const active = data.tasks.filter(t => t.status === 'active');
      if (active.length) {
        throw new Error(`有 ${active.length} 个任务仍为 active 状态（${active.map(t => t.id).join(',')}），请先执行 node flow.js status 检查并补 checkpoint，或 node flow.js resume 重置`);
      }

      const cascaded = cascadeSkip(data.tasks);
      const skippedByC = cascaded.filter((t, i) => t.status === 'skipped' && data.tasks[i].status !== 'skipped');
      if (skippedByC.length) log.debug(`next: cascade skip ${skippedByC.map(t => t.id).join(',')}`);

      const task = findNextTask(cascaded);
      if (!task) {
        await this.repo.saveProgress({ ...data, tasks: cascaded });
        log.debug('next: 无可执行任务');
        return null;
      }

      log.debug(`next: 激活任务 ${task.id} (deps: ${task.deps.join(',') || '无'})`);
      const activated = cascaded.map(t => t.id === task.id ? { ...t, status: 'active' as const } : t);
      await this.repo.saveProgress({ ...data, current: task.id, tasks: activated });
      this.locallyActivatedTaskIds.add(task.id);
      await recordTaskActivations(this.repo.projectRoot(), [task.id]);
      await runLifecycleHook('onTaskStart', this.repo.projectRoot(), { TASK_ID: task.id, TASK_TITLE: task.title });

      // 拼装上下文：summary + 依赖任务产出
      const parts: string[] = [];
      const summary = await this.repo.loadSummary();
      if (summary) parts.push(summary);

      for (const depId of task.deps) {
        const ctx = await this.repo.loadTaskContext(depId);
        if (ctx) parts.push(ctx);
      }

      // 注入相关永久记忆
      const memories = await queryMemory(this.repo.projectRoot(), `${task.title} ${task.description}`);
      const useful = memories.filter(m => m.content.length > 20);
      if (useful.length) {
        parts.push('## 相关记忆\n\n' + useful.map(m => `- [${m.source}] ${m.content}`).join('\n'));
      }

      // 注入循环检测警告
      const loopWarning = await this.loadAndClearLoopWarning();
      if (loopWarning) {
        parts.push(`## 循环检测警告\n\n${loopWarning}`);
      }

      // 心跳自检
      const hcWarnings = await this.healthCheck();
      if (hcWarnings.length) {
        parts.push('## 健康检查警告\n\n' + hcWarnings.map(w => `- ${w}`).join('\n'));
      }

      // 注入进化建议（config.hints）
      const cfg = await this.repo.loadConfig();
      const hints = (cfg as any).hints as string[] | undefined;
      if (hints?.length) {
        parts.push('## 进化建议\n\n' + hints.map(h => `- ${h}`).join('\n'));
      }

      return { task, context: parts.join('\n\n---\n\n') };
    } finally {
      await this.repo.unlock();
    }
  }

  /** nextBatch: 获取所有可并行执行的任务 */
  async nextBatch(): Promise<{ task: TaskEntry; context: string }[]> {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      if (isAllDone(data.tasks)) return [];

      const active = data.tasks.filter(t => t.status === 'active');
      if (active.length) {
        throw new Error(`有 ${active.length} 个任务仍为 active 状态（${active.map(t => t.id).join(',')}），请先执行 node flow.js status 检查并补 checkpoint，或 node flow.js resume 重置`);
      }

      const cascaded = cascadeSkip(data.tasks);
      let tasks = findParallelTasks(cascaded);
      if (!tasks.length) {
        await this.repo.saveProgress({ ...data, tasks: cascaded });
        log.debug('nextBatch: 无可并行任务');
        return [];
      }

      // 消费 config.parallelLimit
      const config = await this.repo.loadConfig();
      const limit = (config as any).parallelLimit;
      if (limit && tasks.length > limit) tasks = tasks.slice(0, limit);

      log.debug(`nextBatch: 激活 ${tasks.map(t => t.id).join(',')}`);
      const activeIds = new Set(tasks.map(t => t.id));
      const activated = cascaded.map(t => activeIds.has(t.id) ? { ...t, status: 'active' as const } : t);
      await this.repo.saveProgress({ ...data, current: tasks[0].id, tasks: activated });
      for (const task of tasks) {
        this.locallyActivatedTaskIds.add(task.id);
      }
      await recordTaskActivations(this.repo.projectRoot(), tasks.map(t => t.id));
      for (const t of tasks) {
        await runLifecycleHook('onTaskStart', this.repo.projectRoot(), { TASK_ID: t.id, TASK_TITLE: t.title });
      }

      const summary = await this.repo.loadSummary();
      const loopWarning = await this.loadAndClearLoopWarning();
      const results: { task: TaskEntry; context: string }[] = [];

      for (const task of tasks) {
        const parts: string[] = [];
        if (summary) parts.push(summary);
        for (const depId of task.deps) {
          const ctx = await this.repo.loadTaskContext(depId);
          if (ctx) parts.push(ctx);
        }
        // 注入相关永久记忆
        const memories = await queryMemory(this.repo.projectRoot(), `${task.title} ${task.description}`);
        const useful = memories.filter(m => m.content.length > 20);
        if (useful.length) {
          parts.push('## 相关记忆\n\n' + useful.map(m => `- [${m.source}] ${m.content}`).join('\n'));
        }
        // 注入循环检测警告
        if (loopWarning) {
          parts.push(`## 循环检测警告\n\n${loopWarning}`);
        }
        // 注入进化建议（config.hints）
        const hints = (config as any).hints as string[] | undefined;
        if (hints?.length) {
          parts.push('## 进化建议\n\n' + hints.map(h => `- ${h}`).join('\n'));
        }
        results.push({ task, context: parts.join('\n\n---\n\n') });
      }
      return results;
    } finally {
      await this.repo.unlock();
    }
  }

  /** checkpoint: 记录任务完成 */
  async checkpoint(id: string, detail: string, files?: string[]): Promise<string> {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      const task = data.tasks.find(t => t.id === id);
      if (!task) throw new Error(`任务 ${id} 不存在`);
      log.debug(`checkpoint ${id}: 当前状态=${task.status}, retries=${task.retries}`);
      if (task.status !== 'active') {
        throw new Error(`任务 ${id} 状态为 ${task.status}，只有 active 状态可以 checkpoint`);
      }

      // 预加载现有记忆，供 extractAll 去重
      const existingMems = (await loadMemory(this.repo.projectRoot())).filter(m => !m.archived).map(m => m.content);

      const isFailed = isExplicitFailureCheckpoint(detail);

      if (isFailed) {
        this.locallyActivatedTaskIds.delete(id);
        // 记录失败原因到 context
        await this.appendFailureContext(id, task, detail);
        // 检测重复失败模式
        const patternWarn = await this.detectFailurePattern(id, task);

        // 循环检测
        const loopResult = await detectLoop(this.repo.projectRoot(), id, detail, true);
        if (loopResult) {
          log.step('loop_detected', loopResult.message, { taskId: id, data: { strategy: loopResult.strategy } });
          await this.saveLoopWarning(`[LOOP WARNING - ${loopResult.strategy}] ${loopResult.message}`);
        }

        // 失败路径也写记忆（提取失败原因中的知识）
        for (const entry of await extractAll(detail, `task-${id}-fail`, existingMems)) {
          await appendMemory(this.repo.projectRoot(), {
            content: entry.content, source: entry.source,
            timestamp: new Date().toISOString(),
          });
        }

        const config = await this.repo.loadConfig();
        const maxRetries = (config as any).maxRetries ?? 3;
        const { result, data: newData } = failTask(data, id, maxRetries);
        await this.repo.saveProgress(newData);
        log.debug(`checkpoint ${id}: failTask result=${result}, retries=${task.retries + 1}`);
        const msg = result === 'retry'
          ? `任务 ${id} 失败(第${task.retries + 1}次)，将重试`
          : `任务 ${id} 连续失败${maxRetries}次，已跳过`;
        const warns = [patternWarn, loopResult ? `[LOOP] ${loopResult.message}` : null].filter(Boolean);
        return warns.length ? `${msg}\n${warns.join('\n')}` : msg;
      }

      if (!detail.trim()) throw new Error(`任务 ${id} checkpoint内容不能为空`);

      // 智能截断：防止过长 summary 膨胀 context
      const maxChars = computeMaxChars(128_000, detail);
      const truncated = detail.length > maxChars ? truncateHeadTail(detail, maxChars) : detail;

      const summaryLine = truncated.split('\n')[0].slice(0, 80);
      this.locallyActivatedTaskIds.delete(id);
      const newData = completeTask(data, id, summaryLine);
      log.debug(`checkpoint ${id}: 完成, summary="${summaryLine}"`);

      await this.repo.saveProgress(newData);
      await this.repo.saveTaskContext(id, `# task-${id}: ${task.title}\n\n${detail}\n`);

      // 智能提取知识写入永久记忆
      for (const entry of await extractAll(detail, `task-${id}`, existingMems)) {
        await appendMemory(this.repo.projectRoot(), {
          content: entry.content,
          source: entry.source,
          timestamp: new Date().toISOString(),
        });
      }

      // 循环检测（成功路径也记录，用于全局熔断统计）
      const loopResult = await detectLoop(this.repo.projectRoot(), id, summaryLine, false);
      if (loopResult) {
        log.step('loop_detected', loopResult.message, { taskId: id, data: { strategy: loopResult.strategy } });
        await this.saveLoopWarning(`[LOOP WARNING - ${loopResult.strategy}] ${loopResult.message}`);
      }

      await this.updateSummary(newData);
      const commitResult = this.repo.commit(id, task.title, summaryLine, files);
      if (commitResult.status === 'committed') this.repo.tag(id);
      await runLifecycleHook('onTaskComplete', this.repo.projectRoot(), { TASK_ID: id, TASK_TITLE: task.title });

      const doneCount = newData.tasks.filter(t => t.status === 'done').length;
      let msg = `任务 ${id} 完成 (${doneCount}/${newData.tasks.length})`;
      msg += this.formatCommitMessage(commitResult, 'task');
      return isAllDone(newData.tasks) ? msg + '\n全部任务已完成，请执行 node flow.js finish 进行收尾' : msg;
    } finally {
      await this.repo.unlock();
    }
  }

  /** resume: 中断恢复 */
  async resume(): Promise<string> {
    const data = await this.repo.loadProgress();
    if (!data) return '无活跃工作流，等待需求输入';
    log.debug(`resume: status=${data.status}, current=${data.current}`);
    if (data.status === 'idle') return '工作流待命中，等待需求输入';
    if (data.status === 'completed') return '工作流已全部完成';
    if (data.status === 'finishing') return `恢复工作流: ${data.name}\n正在收尾阶段，请执行 node flow.js finish`;

    const { data: newData, resetId } = resumeProgress(data);
    this.locallyActivatedTaskIds.clear();
    await this.repo.saveProgress(newData);
    if (resetId) {
      log.debug(`resume: 重置任务 ${resetId}`);
      this.repo.cleanup();
    }

    const doneCount = newData.tasks.filter(t => t.status === 'done').length;
    const total = newData.tasks.length;
    const dirtySummaryLines = await this.describeResumeDirtyState();

    // 启动心跳自检
    this.stopHeartbeat?.();
    this.stopHeartbeat = startHeartbeat(this.repo.projectRoot());

    const lines = [
      `恢复工作流: ${newData.name}`,
      `进度: ${doneCount}/${total}`,
      resetId ? `中断任务 ${resetId} 已重置，将重新执行` : '继续执行',
      ...dirtySummaryLines,
    ];
    return lines.join('\n');
  }

  /** 生成 resume 的 dirty worktree 提示，区分启动前基线与中断残留 */
  private async describeResumeDirtyState(): Promise<string[]> {
    const currentDirtyFiles = this.repo.listChangedFiles();
    const baseline = await loadDirtyBaseline(this.repo.projectRoot());
    const comparison = compareDirtyFilesAgainstBaseline(currentDirtyFiles, baseline?.files ?? []);

    if (!baseline) {
      if (!comparison.currentFiles.length) {
        return ['未找到 dirty baseline；当前工作区无脏业务文件，但无法证明这是干净重启'];
      }
      return [
        `未找到 dirty baseline；无法可靠区分启动前脏文件与中断残留，保守保留当前 ${comparison.currentFiles.length} 个脏文件:`,
        ...comparison.currentFiles.map(file => `- ${file}`),
      ];
    }

    if (!comparison.currentFiles.length) {
      return ['当前工作区无残留脏业务文件，本次恢复是干净重启'];
    }

    const lines: string[] = [];
    if (comparison.preservedBaselineFiles.length) {
      lines.push(`工作流启动前已有 ${comparison.preservedBaselineFiles.length} 个脏文件仍然保留:`);
      lines.push(...comparison.preservedBaselineFiles.map(file => `- ${file}`));
    }
    if (comparison.newDirtyFiles.length) {
      lines.push(`已保留 ${comparison.newDirtyFiles.length} 个中断任务残留的脏业务文件:`);
      lines.push(...comparison.newDirtyFiles.map(file => `- ${file}`));
    }
    return lines;
  }

  /** add: 追加任务 */
  async add(title: string, type: TaskEntry['type']): Promise<string> {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      const maxNum = data.tasks.reduce((m, t) => Math.max(m, parseInt(t.id, 10)), 0);
      const id = makeTaskId(maxNum + 1);
      const newTask: TaskEntry = {
        id, title, description: '', type, status: 'pending',
        deps: [], summary: '', retries: 0,
      };
      const newTasks = [...data.tasks, newTask];
      await this.repo.saveProgress({ ...data, tasks: newTasks });
      return `已追加任务 ${id}: ${title} [${type}]`;
    } finally {
      await this.repo.unlock();
    }
  }

  /** skip: 手动跳过任务 */
  async skip(id: string): Promise<string> {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      const task = data.tasks.find(t => t.id === id);
      if (!task) throw new Error(`任务 ${id} 不存在`);
      if (task.status === 'done') return `任务 ${id} 已完成，无需跳过`;
      const warn = task.status === 'active' ? '（警告: 该任务为 active 状态，子Agent可能仍在运行）' : '';
      const newTasks = data.tasks.map(t =>
        t.id === id ? { ...t, status: 'skipped' as const, summary: '手动跳过' } : t
      );
      await this.repo.saveProgress({ ...data, current: null, tasks: newTasks });
      return `已跳过任务 ${id}: ${task.title}${warn}`;
    } finally {
      await this.repo.unlock();
    }
  }

  /** setup: 项目接管模式 - 写入CLAUDE.md */
  async setup(): Promise<string> {
    const existing = await this.repo.loadProgress();
    const wrote = await this.repo.ensureClaudeMd();
    await this.repo.ensureHooks();
    await this.repo.ensureClaudeWorktreesIgnored();
    const lines: string[] = [];

    if (existing && (existing.status === 'running' || existing.status === 'finishing')) {
      const done = existing.tasks.filter(t => t.status === 'done').length;
      lines.push(`检测到进行中的工作流: ${existing.name}`);
      lines.push(`进度: ${done}/${existing.tasks.length}`);
      if (existing.status === 'finishing') {
        lines.push('状态: 收尾阶段，执行 node flow.js finish 继续');
      } else {
        lines.push('执行 node flow.js resume 继续');
      }
    } else {
      lines.push('项目已接管，工作流工具就绪');
      lines.push('等待需求输入（文档或对话描述）');
    }

    lines.push('');
    if (wrote) lines.push('CLAUDE.md 已更新: 添加了工作流协议');
    lines.push('描述你的开发任务即可启动全自动开发');
    return lines.join('\n');
  }

  /** review: 标记已通过code-review，解锁finish */
  async review(): Promise<string> {
    const data = await this.requireProgress();
    if (!isAllDone(data.tasks)) throw new Error('还有未完成的任务，请先完成所有任务');
    if (data.status === 'finishing') return '已处于review通过状态，可以执行 node flow.js finish';
    await this.repo.saveProgress({ ...data, status: 'finishing' });
    return '代码审查已通过，请执行 node flow.js finish 完成收尾';
  }

  /** finish: 智能收尾 - 先verify，review后置 */
  async finish(): Promise<string> {
    const data = await this.requireProgress();
    log.debug(`finish: status=${data.status}`);
    if (data.status === 'idle' || data.status === 'completed') return '工作流已完成，无需重复finish';
    if (!isAllDone(data.tasks)) throw new Error('还有未完成的任务，请先完成所有任务');

    // 停止心跳
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;

    // 1. 先验证（廉价操作）
    const result = this.repo.verify();
    log.debug(`finish: verify passed=${result.passed}`);
    if (!result.passed) {
      return `验证失败: ${result.error}\n请修复后重新执行 node flow.js finish`;
    }
    const verifySummary = this.formatVerifySummary(result);

    // 2. 验证通过，检查review是否已完成
    if (data.status !== 'finishing') {
      return `验证通过\n${verifySummary}\n请派子Agent执行 code-review，完成后执行 node flow.js review，再执行 node flow.js finish`;
    }

    // 3. verify + review 都通过 → 最终提交
    const done = data.tasks.filter(t => t.status === 'done');
    const skipped = data.tasks.filter(t => t.status === 'skipped');
    const failed = data.tasks.filter(t => t.status === 'failed');
    const stats = [`${done.length} done`, skipped.length ? `${skipped.length} skipped` : '', failed.length ? `${failed.length} failed` : ''].filter(Boolean).join(', ');

    const titles = done.map(t => `- ${t.id}: ${t.title}`).join('\n');
    await runLifecycleHook('onWorkflowFinish', this.repo.projectRoot(), { WORKFLOW_NAME: data.name });

    // 保存工作流历史统计到 .flowpilot/history/（永久存储，不随 clearAll 清理）
    const wfStats = collectStats(data);
    await this.repo.saveHistory(wfStats);

    // 进化循环：Reflect → Experiment
    const configBeforeEvolution = await this.repo.loadConfig();
    const reflectReport = await reflect(wfStats, this.repo.projectRoot());
    const experimentRan = reflectReport.experiments.length > 0;
    if (experimentRan) {
      await experiment(reflectReport, this.repo.projectRoot());
    }

    // 保存进化快照（config 变更前后对比）
    const configAfterEvolution = await this.repo.loadConfig();
    const changedConfigKeys = this.diffConfigKeys(configBeforeEvolution, configAfterEvolution);
    if (changedConfigKeys.length > 0) {
      await this.repo.saveEvolution({
        timestamp: new Date().toISOString(),
        workflowName: data.name,
        configBefore: configBeforeEvolution,
        configAfter: configAfterEvolution,
        suggestions: [],
      });
    }
    const evolutionSummary = this.formatEvolutionSummary({
      reflectRan: true,
      experimentRan,
      changedConfigKeys,
    });

    await this.repo.cleanupInjections();
    this.repo.cleanTags();
    const changedFiles = this.repo.listChangedFiles();
    const commitResult = this.repo.commit('finish', data.name || '工作流完成', `${stats}\n\n${titles}`, changedFiles);
    if (commitResult.status !== 'failed') {
      await this.repo.clearAll();
    }

    return `${verifySummary}\n${stats}\n${evolutionSummary}${this.formatCommitMessage(commitResult, 'finish')}\n工作流回到待命状态\n等待下一个需求...`;
  }

  /** 计算 config 变更的键列表（浅比较，键名排序） */
  private diffConfigKeys(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
  }

  /** 格式化 finish 阶段的进化摘要 */
  private formatEvolutionSummary(summary: {
    reflectRan: boolean;
    experimentRan: boolean;
    changedConfigKeys: string[];
  }): string {
    const changedKeysText = summary.changedConfigKeys.length ? summary.changedConfigKeys.join(', ') : '无';
    return [
      '进化摘要:',
      `- reflect: ${summary.reflectRan ? '已执行' : '未执行'}`,
      `- experiment: ${summary.experimentRan ? '已执行' : '未执行'}`,
      `- config变更: ${summary.changedConfigKeys.length > 0 ? '是' : '否'}`,
      `- 变更键: ${changedKeysText}`,
    ].join('\n');
  }

  /** 格式化验证结果，让 passed/skipped/not-found 对用户可见 */
  private formatVerifySummary(result: { status?: string; steps?: Array<{ command: string; status: string; reason?: string }>; scripts: string[] }): string {
    if (result.status === 'not-found') {
      return '验证结果: 未发现可执行的验证命令';
    }

    const steps = result.steps ?? result.scripts.map(command => ({ command, status: 'passed' }));
    const lines = ['验证结果:'];
    for (const step of steps) {
      if (step.status === 'passed') {
        lines.push(`- 通过: ${step.command}`);
        continue;
      }
      if (step.status === 'skipped') {
        lines.push(`- 跳过: ${step.command}${step.reason ? `（${step.reason}）` : ''}`);
      }
    }
    return lines.join('\n');
  }

  /** 将 git 提交结果映射为面向用户的真实提示语 */
  private formatCommitMessage(result: CommitResult, stage: 'task' | 'finish'): string {
    if (result.status === 'committed') {
      return stage === 'task' ? ' [已自动提交]' : '\n已提交最终commit';
    }

    if (result.status === 'failed') {
      return `\n[git提交失败] ${result.error}\n请根据错误修复后手动检查并提交需要的文件`;
    }

    const reasonMap: Record<NonNullable<CommitResult['reason']>, string> = {
      'no-files': '未提供 --files，未自动提交',
      'runtime-only': '仅检测到 FlowPilot 运行时文件，未自动提交',
      'no-staged-changes': '指定文件无可提交变更，未自动提交',
    };
    const reason = result.reason ? reasonMap[result.reason] : '未自动提交';
    return stage === 'task' ? `\n[未自动提交] ${reason}` : `\n未提交最终commit：${reason}`;
  }

  /** rollback: 回滚到指定任务的快照 */
  async rollback(id: string): Promise<string> {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      const task = data.tasks.find(t => t.id === id);
      if (!task) throw new Error(`任务 ${id} 不存在`);
      if (task.status !== 'done') throw new Error(`任务 ${id} 状态为 ${task.status}，只能回滚已完成的任务`);

      const err = this.repo.rollback(id);
      if (err) return `回滚失败: ${err}`;

      // 将回滚目标及其传递下游任务重置为 pending，并重建滚动摘要
      const newTasks = reopenRollbackBranch(data.tasks, id);
      const newData = { ...data, status: 'running' as const, current: null, tasks: newTasks };
      await this.repo.saveProgress(newData);
      await this.updateSummary(newData);
      const resetCount = newTasks.filter((taskEntry, index) =>
        taskEntry.status === 'pending' && data.tasks[index].status !== 'pending'
      ).length;
      return `已回滚到任务 ${id} 之前的状态，${resetCount} 个任务重置为 pending`;
    } finally {
      await this.repo.unlock();
    }
  }

  /** abort: 中止工作流，清理 .workflow/ 目录 */
  async abort(): Promise<string> {
    const data = await this.repo.loadProgress();
    if (!data) return '无活跃工作流，无需中止';
    await this.repo.saveProgress({ ...data, status: 'aborted' });
    await this.repo.cleanupInjections();
    await this.repo.clearAll();
    return `工作流 "${data.name}" 已中止，.workflow/ 已清理`;
  }

  /** rollbackEvolution: 从进化日志恢复历史 config */
  async rollbackEvolution(index: number): Promise<string> {
    const evolutions = await this.repo.loadEvolutions();
    if (!evolutions.length) return '无进化日志';
    if (index < 0 || index >= evolutions.length) return `索引越界，有效范围: 0-${evolutions.length - 1}`;
    const target = evolutions[index];
    const configBefore = await this.repo.loadConfig();
    await this.repo.saveConfig(target.configBefore);
    await this.repo.saveEvolution({
      timestamp: new Date().toISOString(),
      workflowName: `rollback-to-${index}`,
      configBefore, configAfter: target.configBefore, suggestions: ['手动回滚'],
    });
    return `已回滚到进化点 ${index}（${target.timestamp}）`;
  }

  /** recall: 查询相关记忆 */
  async recall(query: string): Promise<string> {
    const memories = await queryMemory(this.repo.projectRoot(), query);
    if (!memories.length) return '无相关记忆';
    return memories.map(m => `- [${m.source}] ${m.content}`).join('\n');
  }

  /** evolve: 接收CC子Agent的反思结果，执行进化实验 */
  async evolve(reflectionText: string): Promise<string> {
    // 尝试从当前进度获取真实 stats
    let stats: WorkflowStats;
    try {
      const data = await this.repo.loadProgress();
      if (!data) throw new Error('no progress');
      stats = collectStats(data);
    } catch {
      stats = { name: '', totalTasks: 0, doneCount: 0, skipCount: 0, failCount: 0, retryTotal: 0, tasksByType: {}, failsByType: {}, taskResults: [], startTime: new Date().toISOString(), endTime: new Date().toISOString() };
    }
    const report = await reflect(stats, this.repo.projectRoot());
    // 解析子Agent的结构化反思
    const lines = reflectionText.split('\n').filter(l => l.trim());
    const experiments: Array<{ trigger: string; observation: string; action: string; expected: string; target: 'config' | 'claude-md' }> = [];
    for (const line of lines) {
      const m = line.match(/^\[(.+?)\]\s*(.+)/);
      if (m) {
        const tag = m[1].toLowerCase();
        const target = tag.includes('config') ? 'config' as const : 'claude-md' as const;
        experiments.push({ trigger: 'cc-ai-reflect', observation: m[2], action: m[2], expected: '基于AI分析的改进', target });
      }
    }
    if (!experiments.length && lines.length) {
      // 无标签时全部作为 claude-md 实验
      for (const line of lines.slice(0, 3)) {
        experiments.push({ trigger: 'cc-ai-reflect', observation: line, action: line, expected: '基于AI分析的改进', target: 'claude-md' });
      }
    }
    if (!experiments.length) return '无可执行的进化建议';
    const merged = { ...report, experiments: [...report.experiments, ...experiments] };
    await experiment(merged, this.repo.projectRoot());
    return `已应用 ${experiments.length} 条进化建议`;
  }

  /** status: 全局进度 */
  async status(): Promise<ProgressData | null> {
    return this.repo.loadProgress();
  }

  /** 从文本中提取标记行 [DECISION]/[ARCHITECTURE]/[IMPORTANT] */
  private extractTaggedLines(text: string): string[] {
    const TAG_RE = /\[(?:DECISION|ARCHITECTURE|IMPORTANT)\]/i;
    return text.split('\n').filter(l => TAG_RE.test(l)).map(l => l.trim());
  }

  /** 词袋 tokenize（兼容 CJK：连续非空白拉丁词 + 单个 CJK 字符） */
  private tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    for (const m of text.toLowerCase().matchAll(/[a-z0-9_]+|[\u4e00-\u9fff]/g)) {
      tokens.add(m[0]);
    }
    return tokens;
  }

  /** Jaccard 相似度 */
  private similarity(a: string, b: string): number {
    const sa = this.tokenize(a), sb = this.tokenize(b);
    if (!sa.size || !sb.size) return 0;
    let inter = 0;
    for (const t of sa) if (sb.has(t)) inter++;
    return inter / (sa.size + sb.size - inter);
  }

  /** 语义去重：相似度 > 0.8 的摘要合并 */
  private dedup(items: { label: string; text: string }[]): { label: string; text: string }[] {
    const result: { label: string; text: string }[] = [];
    for (const item of items) {
      if (!result.some(r => this.similarity(r.text, item.text) > 0.8)) {
        result.push(item);
      }
    }
    return result;
  }

  /** 智能滚动摘要：保留关键决策 + 时间衰减 + 语义去重 */
  private async updateSummary(data: ProgressData): Promise<void> {
    const done = data.tasks.filter(t => t.status === 'done');
    const lines = [`# ${data.name}\n`];

    // 1. 提取所有关键决策标记
    const taggedLines: string[] = [];
    for (const t of done) {
      const ctx = await this.repo.loadTaskContext(t.id);
      if (ctx) taggedLines.push(...this.extractTaggedLines(ctx));
    }
    // 去重标记行
    const uniqueTagged = [...new Set(taggedLines)];
    if (uniqueTagged.length) {
      lines.push('## 关键决策\n');
      for (const l of uniqueTagged) lines.push(`- ${l}`);
      lines.push('');
    }

    // 2. 时间衰减：按完成顺序（done 数组已按完成顺序排列）
    const recent = done.slice(-5);          // 最近5个：完整摘要
    const mid = done.slice(-10, -5);        // 5-10个前：标题+首行
    const old = done.slice(0, -10);         // 更早：仅标题

    const progressItems: { label: string; text: string }[] = [];

    for (const t of old) {
      progressItems.push({ label: `[${t.type}] ${t.title}`, text: t.title });
    }
    for (const t of mid) {
      const firstLine = t.summary.split('\n')[0] || '';
      const text = firstLine ? `${t.title}: ${firstLine}` : t.title;
      progressItems.push({ label: `[${t.type}] ${text}`, text });
    }
    for (const t of recent) {
      const summary = t.summary && t.summary.length > 500 ? truncateHeadTail(t.summary, 500) : t.summary;
      const text = summary ? `${t.title}: ${summary}` : t.title;
      progressItems.push({ label: `[${t.type}] ${text}`, text });
    }

    // 3. 语义去重
    const deduped = this.dedup(progressItems);

    lines.push('## 任务进展\n');
    for (const item of deduped) lines.push(`- ${item.label}`);

    // 4. 待完成
    const pending = data.tasks.filter(t => t.status !== 'done' && t.status !== 'skipped' && t.status !== 'failed');
    if (pending.length) {
      lines.push('\n## 待完成\n');
      for (const t of pending) lines.push(`- [${t.type}] ${t.title}`);
    }
    let totalSummary = lines.join('\n') + '\n';
    if (totalSummary.length > 3000) totalSummary = truncateHeadTail(totalSummary, 3000);
    await this.repo.saveSummary(totalSummary);
  }

  /** 读取历史经验，输出建议，自动写入 config.json（闭环进化） */
  private async applyHistoryInsights(): Promise<void> {
    const history = await this.repo.loadHistory();
    if (!history.length) return;

    const { suggestions, recommendedConfig } = analyzeHistory(history);
    if (suggestions.length) {
      log.info('[历史经验建议]');
      for (const s of suggestions) log.info(`  - ${s}`);
    }

    if (!Object.keys(recommendedConfig).length) return;

    const configBefore = await this.repo.loadConfig();
    const merged = { ...configBefore };
    let changed = false;
    for (const [k, v] of Object.entries(recommendedConfig)) {
      if (!(k in merged)) { merged[k] = v; changed = true; }
    }
    if (changed) {
      await this.repo.saveConfig(merged);
      await this.repo.saveEvolution({
        timestamp: new Date().toISOString(),
        workflowName: (await this.repo.loadProgress())?.name ?? '',
        configBefore, configAfter: merged, suggestions,
      });
      log.info('[历史经验] 已基于历史数据自动调整默认参数');
    }
  }

  /** 将失败原因追加到 context/task-{id}.md，标记 [FAILED] */
  private async appendFailureContext(id: string, task: TaskEntry, detail: string): Promise<void> {
    const existing = await this.repo.loadTaskContext(id) ?? '';
    const entry = `\n## [FAILED] 第${task.retries + 1}次失败\n\n${detail}\n`;
    const content = existing
      ? existing.trimEnd() + '\n' + entry
      : `# task-${id}: ${task.title}\n${entry}`;
    await this.repo.saveTaskContext(id, content);
  }

  /** 检测连续失败模式：3次FAILED且摘要相似(>60%)时输出警告 */
  private async detectFailurePattern(id: string, task: TaskEntry): Promise<string | null> {
    if (task.retries < 2) return null;
    const ctx = await this.repo.loadTaskContext(id);
    if (!ctx) return null;
    const reasons = [...ctx.matchAll(/## \[FAILED\] .+?\n\n(.+?)(?=\n##|\n*$)/gs)]
      .map(m => m[1].trim());
    if (reasons.length < 3) return null;
    const last3 = reasons.slice(-3);
    const sim01 = this.similarity(last3[0], last3[1]);
    const sim12 = this.similarity(last3[1], last3[2]);
    log.debug(`detectFailurePattern ${id}: sim01=${sim01.toFixed(2)}, sim12=${sim12.toFixed(2)}`);
    if (sim01 > 0.6 && sim12 > 0.6) {
      const msg = `[WARN] 任务 ${id} 陷入重复失败模式，建议 skip 或修改任务描述`;
      log.warn(msg);
      return msg;
    }
    return null;
  }

  /** 心跳自检：委托给 heartbeat 模块 */
  async healthCheck(): Promise<string[]> {
    const result = await runHeartbeat(this.repo.projectRoot());
    return result.warnings;
  }

  private async requireProgress(): Promise<ProgressData> {
    const data = await this.repo.loadProgress();
    if (!data) throw new Error('无活跃工作流，请先 node flow.js init');
    setWorkflowName(data.name);
    return data;
  }

}
