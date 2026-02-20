/**
 * @module application/workflow-service
 * @description 工作流应用服务 - 11个用例
 */

import type { ProgressData, TaskEntry } from '../domain/types';
import type { WorkflowDefinition } from '../domain/workflow';
import type { WorkflowRepository } from '../infrastructure/repository';
import { makeTaskId, findNextTask, findParallelTasks, completeTask, failTask, resumeProgress, isAllDone } from '../domain/task-store';
import { autoCommit } from '../infrastructure/git';
import { runVerify } from '../infrastructure/verify';

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

      const task = findNextTask(data.tasks);
      if (!task) {
        await this.repo.saveProgress(data); // persist cascadeSkip changes
        return null;
      }

      task.status = 'active';
      data.current = task.id;
      await this.repo.saveProgress(data);

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

      const tasks = findParallelTasks(data.tasks);
      if (!tasks.length) {
        await this.repo.saveProgress(data); // persist cascadeSkip changes
        return [];
      }

      for (const t of tasks) t.status = 'active';
      data.current = tasks[0].id;
      await this.repo.saveProgress(data);

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
      if (task.status !== 'active' && task.status !== 'pending') {
        throw new Error(`任务 ${id} 状态为 ${task.status}，无法checkpoint`);
      }

      if (detail === 'FAILED') {
        const result = failTask(data, id);
        await this.repo.saveProgress(data);
        return result === 'retry'
          ? `任务 ${id} 失败(第${task.retries}次)，将重试`
          : `任务 ${id} 连续失败3次，已跳过`;
      }

      if (!detail.trim()) throw new Error(`任务 ${id} checkpoint内容不能为空`);

      const summaryLine = detail.split('\n')[0].slice(0, 80);
      completeTask(data, id, summaryLine);

      await this.repo.saveProgress(data);
      await this.repo.saveTaskContext(id, `# task-${id}: ${task.title}\n\n${detail}\n`);
      await this.updateSummary(data);
      autoCommit(id, task.title, summaryLine, files);

      const doneCount = data.tasks.filter(t => t.status === 'done').length;
      const msg = `任务 ${id} 完成 (${doneCount}/${data.tasks.length}) [已自动提交]`;
      return isAllDone(data.tasks) ? msg + '\n全部任务已完成，请执行 node flow.js finish 进行收尾' : msg;
    } finally {
      await this.repo.unlock();
    }
  }

  /** resume: 中断恢复 */
  async resume(): Promise<string> {
    const data = await this.repo.loadProgress();
    if (!data) return '无活跃工作流，等待需求输入';
    if (data.status === 'idle') return '工作流待命中，等待需求输入';
    if (data.status === 'completed') return '工作流已全部完成';
    if (data.status === 'finishing') return `恢复工作流: ${data.name}\n正在收尾阶段，请执行 node flow.js finish`;

    const resetId = resumeProgress(data);
    await this.repo.saveProgress(data);

    const doneCount = data.tasks.filter(t => t.status === 'done').length;
    const total = data.tasks.length;

    if (resetId) {
      return `恢复工作流: ${data.name}\n进度: ${doneCount}/${total}\n中断任务 ${resetId} 已重置，将重新执行`;
    }
    return `恢复工作流: ${data.name}\n进度: ${doneCount}/${total}\n继续执行`;
  }

  /** add: 追加任务 */
  async add(title: string, type: TaskEntry['type']): Promise<string> {
    const data = await this.requireProgress();
    const maxNum = data.tasks.reduce((m, t) => Math.max(m, parseInt(t.id, 10)), 0);
    const id = makeTaskId(maxNum + 1);
    data.tasks.push({
      id, title, description: '', type, status: 'pending',
      deps: [], summary: '', retries: 0,
    });
    await this.repo.saveProgress(data);
    return `已追加任务 ${id}: ${title} [${type}]`;
  }

  /** skip: 手动跳过任务 */
  async skip(id: string): Promise<string> {
    const data = await this.requireProgress();
    const task = data.tasks.find(t => t.id === id);
    if (!task) throw new Error(`任务 ${id} 不存在`);
    if (task.status === 'done') return `任务 ${id} 已完成，无需跳过`;
    task.status = 'skipped';
    task.summary = '手动跳过';
    data.current = null;
    await this.repo.saveProgress(data);
    return `已跳过任务 ${id}: ${task.title}`;
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
    lines.push('用户说"开始"即可启动全自动开发');
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

  /** finish: 智能收尾 - 验证+总结+回到待命 */
  async finish(): Promise<string> {
    const data = await this.requireProgress();
    if (data.status === 'idle' || data.status === 'completed') return '工作流已完成，无需重复finish';
    if (data.status !== 'finishing') throw new Error('请先执行 node flow.js review 完成代码审查');
    if (!isAllDone(data.tasks)) throw new Error('还有未完成的任务，请先完成所有任务');

    // 自动检测并执行验证脚本
    const result = runVerify(this.repo.projectRoot());
    if (!result.passed) {
      return `验证失败: ${result.error}\n请修复后重新执行 node flow.js finish`;
    }

    // 统计
    const done = data.tasks.filter(t => t.status === 'done');
    const skipped = data.tasks.filter(t => t.status === 'skipped');
    const failed = data.tasks.filter(t => t.status === 'failed');
    const stats = [`${done.length} done`, skipped.length ? `${skipped.length} skipped` : '', failed.length ? `${failed.length} failed` : ''].filter(Boolean).join(', ');

    // 清理 .workflow/ 然后最终提交（包含清理）
    await this.repo.clearAll();
    const titles = done.map(t => `- ${t.id}: ${t.title}`).join('\n');
    autoCommit('finish', data.name || '工作流完成', `${stats}\n\n${titles}`);

    const scripts = result.scripts.length ? result.scripts.join(', ') : '无验证脚本';
    return `验证通过: ${scripts}\n${stats}\n已提交最终commit，工作流回到待命状态\n等待下一个需求...`;
  }

  /** status: 全局进度 */
  async status(): Promise<ProgressData | null> {
    return this.repo.loadProgress();
  }

  /** 滚动摘要：每次checkpoint追加，每10个任务压缩 */
  private async updateSummary(data: ProgressData): Promise<void> {
    const done = data.tasks.filter(t => t.status === 'done');
    const lines = [`# ${data.name}\n`];

    // 每10个已完成任务压缩为按类型分组的摘要
    if (done.length > 10) {
      const groups = new Map<string, string[]>();
      for (const t of done) {
        const arr = groups.get(t.type) || [];
        arr.push(t.title);
        groups.set(t.type, arr);
      }
      lines.push('## 已完成模块');
      for (const [type, titles] of groups) {
        lines.push(`- [${type}] ${titles.length}项: ${titles.slice(-3).join(', ')}${titles.length > 3 ? ' 等' : ''}`);
      }
    } else {
      lines.push('## 已完成');
      for (const t of done) {
        lines.push(`- [${t.type}] ${t.title}: ${t.summary}`);
      }
    }

    const pending = data.tasks.filter(t => t.status !== 'done' && t.status !== 'skipped' && t.status !== 'failed');
    if (pending.length) {
      lines.push('\n## 待完成');
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
