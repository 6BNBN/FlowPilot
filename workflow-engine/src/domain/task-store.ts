/**
 * @module domain/task-store
 * @description 任务存储 - 管理任务状态与进度持久化
 */

import type { TaskEntry, TaskStatus, ProgressData, WorkflowStatus } from './types';

/** 生成三位数任务ID */
export function makeTaskId(n: number): string {
  return String(n).padStart(3, '0');
}

/** 查找下一个待执行任务（依赖已满足） */
export function findNextTask(tasks: TaskEntry[]): TaskEntry | null {
  for (const t of tasks) {
    if (t.status !== 'pending') continue;
    const depsOk = t.deps.every(d => {
      const dep = tasks.find(x => x.id === d);
      return dep && dep.status === 'done';
    });
    if (depsOk) return t;
  }
  return null;
}

/** 标记任务完成 */
export function completeTask(
  data: ProgressData, id: string, summary: string,
): void {
  const t = data.tasks.find(x => x.id === id);
  if (!t) throw new Error(`任务 ${id} 不存在`);
  t.status = 'done';
  t.summary = summary;
  data.current = null;
}

/** 标记任务失败（含重试计数） */
export function failTask(data: ProgressData, id: string): 'retry' | 'skip' {
  const t = data.tasks.find(x => x.id === id);
  if (!t) throw new Error(`任务 ${id} 不存在`);
  t.retries++;
  if (t.retries >= 3) {
    t.status = 'failed';
    data.current = null;
    return 'skip';
  }
  t.status = 'pending';
  data.current = null;
  return 'retry';
}

/** 恢复中断：将 active 任务重置为 pending */
export function resumeProgress(data: ProgressData): string | null {
  for (const t of data.tasks) {
    if (t.status === 'active') {
      t.status = 'pending';
      data.current = null;
      data.status = 'running';
      return t.id;
    }
  }
  if (data.status === 'running') return data.current;
  return null;
}

/** 检查是否全部完成 */
export function isAllDone(tasks: TaskEntry[]): boolean {
  return tasks.every(t => t.status === 'done' || t.status === 'skipped' || t.status === 'failed');
}
