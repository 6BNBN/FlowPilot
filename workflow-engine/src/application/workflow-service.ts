/**
 * @module application/workflow-service
 * @description 工作流应用服务 - 6个核心用例
 */

import type { ProgressData, TaskEntry } from '../domain/types';
import type { WorkflowDefinition } from '../domain/workflow';
import type { WorkflowRepository } from '../infrastructure/repository';
import { makeTaskId, findNextTask, completeTask, failTask, resumeProgress, isAllDone } from '../domain/task-store';
import { generateProtocol } from './protocol-generator';
import { autoCommit } from '../infrastructure/git';

export class WorkflowService {
  constructor(
    private readonly repo: WorkflowRepository,
    private readonly parse: (md: string) => WorkflowDefinition,
  ) {}

  /** init: 解析任务markdown → 生成progress/tasks/protocol */
  async init(tasksMd: string): Promise<ProgressData> {
    const def = this.parse(tasksMd);
    const tasks: TaskEntry[] = def.tasks.map((t, i) => ({
      id: makeTaskId(i + 1),
      title: t.title,
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
    await this.repo.saveProtocol(generateProtocol(def.name));
    await this.repo.saveSummary(`# ${def.name}\n\n${def.description}\n`);
    return data;
  }

  /** next: 获取下一个可执行任务（含依赖上下文） */
  async next(): Promise<{ task: TaskEntry; context: string } | null> {
    const data = await this.requireProgress();
    if (isAllDone(data.tasks)) return null;

    const task = findNextTask(data.tasks);
    if (!task) return null;

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
  }

  /** checkpoint: 记录任务完成 */
  async checkpoint(id: string, detail: string): Promise<string> {
    const data = await this.requireProgress();
    const task = data.tasks.find(t => t.id === id);
    if (!task) throw new Error(`任务 ${id} 不存在`);

    if (detail === 'FAILED') {
      const result = failTask(data, id);
      await this.repo.saveProgress(data);
      return result === 'retry'
        ? `任务 ${id} 失败(第${task.retries}次)，将重试`
        : `任务 ${id} 连续失败3次，已跳过`;
    }

    // 提取摘要（第一行）
    const summaryLine = detail.split('\n')[0].slice(0, 80);
    completeTask(data, id, summaryLine);

    if (isAllDone(data.tasks)) data.status = 'completed';
    await this.repo.saveProgress(data);
    await this.repo.saveTaskContext(id, `# task-${id}: ${task.title}\n\n${detail}\n`);
    autoCommit(id, task.title, summaryLine);

    const doneCount = data.tasks.filter(t => t.status === 'done').length;
    return `任务 ${id} 完成 (${doneCount}/${data.tasks.length}) [已自动提交]`;
  }

  /** resume: 中断恢复 */
  async resume(): Promise<string> {
    const data = await this.repo.loadProgress();
    if (!data) return '无活跃工作流';
    if (data.status === 'completed') return '工作流已全部完成';

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
    const id = makeTaskId(data.tasks.length + 1);
    data.tasks.push({
      id, title, type, status: 'pending',
      deps: [], summary: '', retries: 0,
    });
    await this.repo.saveProgress(data);
    return `已追加任务 ${id}: ${title} [${type}]`;
  }

  /** setup: 项目接管模式 - 生成协议+写入CLAUDE.md */
  async setup(): Promise<string> {
    const existing = await this.repo.loadProgress();
    await this.repo.saveProtocol(generateProtocol('project'));
    const wrote = await this.repo.ensureClaudeMd();
    const lines: string[] = [];

    if (existing && existing.status === 'running') {
      const done = existing.tasks.filter(t => t.status === 'done').length;
      lines.push(`检测到进行中的工作流: ${existing.name}`);
      lines.push(`进度: ${done}/${existing.tasks.length}`);
      lines.push('执行 flow resume 继续');
    } else {
      lines.push('项目已接管，工作流工具就绪');
      lines.push('等待需求输入（文档或对话描述）');
    }

    lines.push('');
    lines.push('协议已生成: .workflow/protocol.md');
    if (wrote) lines.push('CLAUDE.md 已更新: 添加了协议引用');
    lines.push('');
    lines.push('用户说"开始"即可启动全自动开发');
    return lines.join('\n');
  }

  /** status: 全局进度 */
  async status(): Promise<ProgressData | null> {
    return this.repo.loadProgress();
  }

  private async requireProgress(): Promise<ProgressData> {
    const data = await this.repo.loadProgress();
    if (!data) throw new Error('无活跃工作流，请先 flow init');
    return data;
  }
}
