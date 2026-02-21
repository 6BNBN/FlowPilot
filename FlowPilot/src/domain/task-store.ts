/**
 * @module domain/task-store
 * @description 任务存储 - 管理任务状态与进度持久化
 */

import type { TaskEntry, TaskStatus, ProgressData, WorkflowStatus } from './types';

/** 生成三位数任务ID */
export function makeTaskId(n: number): string {
  return String(n).padStart(3, '0');
}

/** 级联跳过：依赖了 failed/skipped 任务的 pending 任务标记为 skipped（会修改 tasks） */
export function cascadeSkip(tasks: TaskEntry[]): void {
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
}

/** 检测任务依赖中的循环引用 */
export function detectCycles(tasks: TaskEntry[]): string[] | null {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const parent = new Map<string, string>();

  function dfs(id: string): string[] | null {
    visited.add(id);
    inStack.add(id);
    const task = tasks.find(t => t.id === id);
    if (task) {
      for (const dep of task.deps) {
        if (!visited.has(dep)) {
          parent.set(dep, id);
          const cycle = dfs(dep);
          if (cycle) return cycle;
        } else if (inStack.has(dep)) {
          // 回溯构建环路径
          const path = [dep];
          let cur = id;
          while (cur !== dep) {
            path.push(cur);
            cur = parent.get(cur)!;
          }
          path.push(dep);
          return path.reverse();
        }
      }
    }
    inStack.delete(id);
    return null;
  }

  for (const t of tasks) {
    if (!visited.has(t.id)) {
      const cycle = dfs(t.id);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** 查找下一个待执行任务（依赖已满足） */
export function findNextTask(tasks: TaskEntry[]): TaskEntry | null {
  const pending = tasks.filter(t => t.status === 'pending');
  const cycle = detectCycles(pending);
  if (cycle) throw new Error(`循环依赖: ${cycle.join(' -> ')}`);
  cascadeSkip(tasks);
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

/** 恢复中断：将所有 active 任务重置为 pending（支持并行中断恢复） */
export function resumeProgress(data: ProgressData): string | null {
  let firstId: string | null = null;
  for (const t of data.tasks) {
    if (t.status === 'active') {
      t.status = 'pending';
      if (!firstId) firstId = t.id;
    }
  }
  if (firstId) {
    data.current = null;
    data.status = 'running';
    return firstId;
  }
  if (data.status === 'running') return data.current;
  return null;
}

/** 查找所有可并行执行的任务（依赖已满足的pending任务） */
export function findParallelTasks(tasks: TaskEntry[]): TaskEntry[] {
  const pending = tasks.filter(t => t.status === 'pending');
  const cycle = detectCycles(pending);
  if (cycle) throw new Error(`循环依赖: ${cycle.join(' -> ')}`);
  cascadeSkip(tasks);
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
