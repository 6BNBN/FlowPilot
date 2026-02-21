/**
 * @module application/workflow-service
 * @description 工作流应用服务 - 11个用例
 */

import type { ProgressData, TaskEntry } from '../domain/types';
import type { WorkflowDefinition } from '../domain/workflow';
import type { WorkflowRepository } from '../domain/repository';
import { makeTaskId, cascadeSkip, findNextTask, findParallelTasks, completeTask, failTask, resumeProgress, isAllDone } from '../domain/task-store';
import { runLifecycleHook } from '../infrastructure/hooks';
import { log } from '../infrastructure/logger';

export class WorkflowService {
  constructor(
    private readonly repo: WorkflowRepository,
    private readonly parse: (md: string) => WorkflowDefinition,
  ) {}

  /** init: 解析任务markdown → 生成progress/tasks */
  async init(tasksMd: string, force = false): Promise<ProgressData> {
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
    };
    await this.repo.saveProgress(data);
    await this.repo.saveTasks(tasksMd);
    await this.repo.saveSummary(`# ${def.name}\n\n${def.description}\n`);
    await this.repo.ensureClaudeMd();
    await this.repo.ensureHooks();
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
      await runLifecycleHook('onTaskStart', this.repo.projectRoot(), { TASK_ID: task.id, TASK_TITLE: task.title });

      // 拼装上下文：summary + 依赖任务产出
      const parts: string[] = [];
      const summary = await this.repo.loadSummary();
      if (summary) parts.push(summary);

      for (const depId of task.deps) {
        const ctx = await this.repo.loadTaskContext(depId);
        if (ctx) parts.push(ctx);
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
      const tasks = findParallelTasks(cascaded);
      if (!tasks.length) {
        await this.repo.saveProgress({ ...data, tasks: cascaded });
        log.debug('nextBatch: 无可并行任务');
        return [];
      }

      log.debug(`nextBatch: 激活 ${tasks.map(t => t.id).join(',')}`);
      const activeIds = new Set(tasks.map(t => t.id));
      const activated = cascaded.map(t => activeIds.has(t.id) ? { ...t, status: 'active' as const } : t);
      await this.repo.saveProgress({ ...data, current: tasks[0].id, tasks: activated });
      for (const t of tasks) {
        await runLifecycleHook('onTaskStart', this.repo.projectRoot(), { TASK_ID: t.id, TASK_TITLE: t.title });
      }

      const summary = await this.repo.loadSummary();
      const results: { task: TaskEntry; context: string }[] = [];

      for (const task of tasks) {
        const parts: string[] = [];
        if (summary) parts.push(summary);
        for (const depId of task.deps) {
          const ctx = await this.repo.loadTaskContext(depId);
          if (ctx) parts.push(ctx);
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

      if (detail === 'FAILED') {
        // 记录失败原因到 context
        await this.appendFailureContext(id, task, detail);
        // 检测重复失败模式
        const patternWarn = await this.detectFailurePattern(id, task);

        const { result, data: newData } = failTask(data, id);
        await this.repo.saveProgress(newData);
        log.debug(`checkpoint ${id}: failTask result=${result}, retries=${task.retries + 1}`);
        const msg = result === 'retry'
          ? `任务 ${id} 失败(第${task.retries + 1}次)，将重试`
          : `任务 ${id} 连续失败3次，已跳过`;
        return patternWarn ? `${msg}\n${patternWarn}` : msg;
      }

      if (!detail.trim()) throw new Error(`任务 ${id} checkpoint内容不能为空`);

      const summaryLine = detail.split('\n')[0].slice(0, 80);
      const newData = completeTask(data, id, summaryLine);
      log.debug(`checkpoint ${id}: 完成, summary="${summaryLine}"`);

      await this.repo.saveProgress(newData);
      await this.repo.saveTaskContext(id, `# task-${id}: ${task.title}\n\n${detail}\n`);
      await this.updateSummary(newData);
      const commitErr = this.repo.commit(id, task.title, summaryLine, files);
      if (!commitErr) this.repo.tag(id);
      await runLifecycleHook('onTaskComplete', this.repo.projectRoot(), { TASK_ID: id, TASK_TITLE: task.title });

      const doneCount = newData.tasks.filter(t => t.status === 'done').length;
      let msg = `任务 ${id} 完成 (${doneCount}/${newData.tasks.length})`;
      if (commitErr) {
        msg += `\n[git提交失败] ${commitErr}\n请根据错误修复后手动执行 git add -A && git commit`;
      } else {
        msg += ' [已自动提交]';
      }
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
    await this.repo.saveProgress(newData);
    if (resetId) {
      log.debug(`resume: 重置任务 ${resetId}`);
      this.repo.cleanup();
    }

    const doneCount = newData.tasks.filter(t => t.status === 'done').length;
    const total = newData.tasks.length;

    if (resetId) {
      return `恢复工作流: ${newData.name}\n进度: ${doneCount}/${total}\n中断任务 ${resetId} 已重置，将重新执行`;
    }
    return `恢复工作流: ${newData.name}\n进度: ${doneCount}/${total}\n继续执行`;
  }

  /** add: 追加任务 */
  async add(title: string, type: TaskEntry['type']): Promise<string> {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      const maxNum = data.tasks.reduce((m, t) => Math.max(m, parseInt(t.id, 10)), 0);
      const id = makeTaskId(maxNum + 1);
      data.tasks.push({
        id, title, description: '', type, status: 'pending',
        deps: [], summary: '', retries: 0,
      });
      await this.repo.saveProgress(data);
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
      task.status = 'skipped';
      task.summary = '手动跳过';
      data.current = null;
      await this.repo.saveProgress(data);
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
    data.status = 'finishing';
    await this.repo.saveProgress(data);
    return '代码审查已通过，请执行 node flow.js finish 完成收尾';
  }

  /** finish: 智能收尾 - 先verify，review后置 */
  async finish(): Promise<string> {
    const data = await this.requireProgress();
    log.debug(`finish: status=${data.status}`);
    if (data.status === 'idle' || data.status === 'completed') return '工作流已完成，无需重复finish';
    if (!isAllDone(data.tasks)) throw new Error('还有未完成的任务，请先完成所有任务');

    // 1. 先验证（廉价操作）
    const result = this.repo.verify();
    log.debug(`finish: verify passed=${result.passed}`);
    if (!result.passed) {
      return `验证失败: ${result.error}\n请修复后重新执行 node flow.js finish`;
    }

    // 2. 验证通过，检查review是否已完成
    if (data.status !== 'finishing') {
      return '验证通过，请派子Agent执行 code-review，完成后执行 node flow.js review，再执行 node flow.js finish';
    }

    // 3. verify + review 都通过 → 最终提交
    const done = data.tasks.filter(t => t.status === 'done');
    const skipped = data.tasks.filter(t => t.status === 'skipped');
    const failed = data.tasks.filter(t => t.status === 'failed');
    const stats = [`${done.length} done`, skipped.length ? `${skipped.length} skipped` : '', failed.length ? `${failed.length} failed` : ''].filter(Boolean).join(', ');

    const titles = done.map(t => `- ${t.id}: ${t.title}`).join('\n');
    await runLifecycleHook('onWorkflowFinish', this.repo.projectRoot(), { WORKFLOW_NAME: data.name });
    await this.repo.cleanupInjections();
    this.repo.cleanTags();
    const commitErr = this.repo.commit('finish', data.name || '工作流完成', `${stats}\n\n${titles}`);
    if (!commitErr) {
      await this.repo.clearAll();
    }

    const scripts = result.scripts.length ? result.scripts.join(', ') : '无验证脚本';
    if (commitErr) {
      return `验证通过: ${scripts}\n${stats}\n[git提交失败] ${commitErr}\n请根据错误修复后手动执行 git add -A && git commit`;
    }
    return `验证通过: ${scripts}\n${stats}\n已提交最终commit，工作流回到待命状态\n等待下一个需求...`;
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

      // 将该任务及其后续任务重置为 pending
      const idx = parseInt(id, 10);
      const newTasks = data.tasks.map(t =>
        parseInt(t.id, 10) >= idx && t.status === 'done'
          ? { ...t, status: 'pending' as const, summary: '' }
          : t
      );
      await this.repo.saveProgress({ ...data, current: null, tasks: newTasks });
      const resetCount = newTasks.filter((t, i) => t.status === 'pending' && data.tasks[i].status === 'done').length;
      return `已回滚到任务 ${id} 之前的状态，${resetCount} 个任务重置为 pending`;
    } finally {
      await this.repo.unlock();
    }
  }

  /** abort: 中止工作流，清理 .workflow/ 目录 */
  async abort(): Promise<string> {
    const data = await this.repo.loadProgress();
    if (!data) return '无活跃工作流，无需中止';
    data.status = 'aborted';
    await this.repo.saveProgress(data);
    await this.repo.cleanupInjections();
    await this.repo.clearAll();
    return `工作流 "${data.name}" 已中止，.workflow/ 已清理`;
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
      const text = t.summary ? `${t.title}: ${t.summary}` : t.title;
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
    await this.repo.saveSummary(lines.join('\n') + '\n');
  }

  private async requireProgress(): Promise<ProgressData> {
    const data = await this.repo.loadProgress();
    if (!data) throw new Error('无活跃工作流，请先 node flow.js init');
    return data;
  }
}
