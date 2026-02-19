/**
 * @module domain/task-store
 * @description 任务存储 - 管理任务状态与进度持久化
 */

import type { TaskEntry, TaskStatus, ProgressData, WorkflowStatus } from './types';

/** 生成三位数任务ID */
export function makeTaskId(n: number): string {
  return String(n).padStart(3, '0');
}

/** 查找下一个待执行任务（依赖已满足），同时级联跳过被阻塞的任务 */
export function findNextTask(tasks: TaskEntry[]): TaskEntry | null {
  // 先级联跳过：依赖了 failed/skipped 任务的 pending 任务也标记为 skipped
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of tasks) {
      if (t.status !== 'pending') continue;
      const blocked = t.deps.some(d => {
        const dep = tasks.find(x => x.id === d);
        return dep && (dep.status === 'failed' || dep.status === 'skipped');
      });
      if (blocked) { t.status = 'skipped'; t.summary = '依赖任务失败，已跳过'; changed = true; }
    }
  }
  // 再找可执行任务
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

/** 查找所有可并行执行的任务（依赖已满足的pending任务） */
export function findParallelTasks(tasks: TaskEntry[]): TaskEntry[] {
  // 先级联跳过
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of tasks) {
      if (t.status !== 'pending') continue;
      const blocked = t.deps.some(d => {
        const dep = tasks.find(x => x.id === d);
        return dep && (dep.status === 'failed' || dep.status === 'skipped');
      });
      if (blocked) { t.status = 'skipped'; t.summary = '依赖任务失败，已跳过'; changed = true; }
    }
  }
  return tasks.filter(t => {
    if (t.status !== 'pending') return false;
    return t.deps.every(d => {
      const dep = tasks.find(x => x.id === d);
      return dep && dep.status === 'done';
    });
  });
}

/** 检查是否全部完成 */
export function isAllDone(tasks: TaskEntry[]): boolean {
  return tasks.every(t => t.status === 'done' || t.status === 'skipped' || t.status === 'failed');
}
