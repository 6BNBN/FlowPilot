/**
 * @module domain/task-store
 * @description 任务存储 - 管理任务状态与进度持久化（不可变实现）
 */

import type { TaskEntry, TaskStatus, ProgressData, WorkflowStatus } from './types';

/** 构建 id → TaskEntry 索引 */
function buildIndex(tasks: readonly TaskEntry[]): Map<string, TaskEntry> {
  const m = new Map<string, TaskEntry>();
  for (const t of tasks) m.set(t.id, t);
  return m;
}

/** 生成三位数任务ID */
export function makeTaskId(n: number): string {
  return String(n).padStart(3, '0');
}

/** 级联跳过：返回新数组，被跳过的任务是新对象（纯函数，不修改输入） */
export function cascadeSkip(tasks: readonly TaskEntry[]): TaskEntry[] {
  let result = tasks.map(t => ({ ...t }));
  let changed = true;
  while (changed) {
    changed = false;
    const idx = buildIndex(result);
    for (let i = 0; i < result.length; i++) {
      const t = result[i];
      if (t.status !== 'pending') continue;
      const blocked = t.deps.some(d => {
        const dep = idx.get(d);
        return dep && (dep.status === 'failed' || dep.status === 'skipped');
      });
      if (blocked) {
        result[i] = { ...t, status: 'skipped', summary: '依赖任务失败，已跳过' };
        changed = true;
      }
    }
  }
  return result;
}

/** 检测任务依赖中的循环引用 */
export function detectCycles(tasks: readonly TaskEntry[]): string[] | null {
  const idx = buildIndex(tasks);
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const parent = new Map<string, string>();

  function dfs(id: string): string[] | null {
    visited.add(id);
    inStack.add(id);
    const task = idx.get(id);
    if (task) {
      for (const dep of task.deps) {
        if (!visited.has(dep)) {
          parent.set(dep, id);
          const cycle = dfs(dep);
          if (cycle) return cycle;
        } else if (inStack.has(dep)) {
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

/** 查找下一个待执行任务（纯查询，不触发cascadeSkip，调用方需先cascade） */
export function findNextTask(tasks: readonly TaskEntry[]): TaskEntry | null {
  const pending = tasks.filter(t => t.status === 'pending');
  const cycle = detectCycles(pending);
  if (cycle) throw new Error(`循环依赖: ${cycle.join(' -> ')}`);
  const idx = buildIndex(tasks);
  for (const t of tasks) {
    if (t.status !== 'pending') continue;
    if (t.deps.every(d => idx.get(d)?.status === 'done')) return t;
  }
  return null;
}

/** 标记任务完成（返回新 ProgressData，不修改原对象） */
export function completeTask(
  data: ProgressData, id: string, summary: string,
): ProgressData {
  const idx = buildIndex(data.tasks);
  if (!idx.has(id)) throw new Error(`任务 ${id} 不存在`);
  return {
    ...data,
    current: null,
    tasks: data.tasks.map(t => t.id === id ? { ...t, status: 'done' as const, summary } : t),
  };
}

/** 标记任务失败（返回新 ProgressData + 结果，不修改原对象） */
export function failTask(data: ProgressData, id: string): { result: 'retry' | 'skip'; data: ProgressData } {
  const idx = buildIndex(data.tasks);
  if (!idx.has(id)) throw new Error(`任务 ${id} 不存在`);
  const old = idx.get(id)!;
  const retries = old.retries + 1;
  if (retries >= 3) {
    return {
      result: 'skip',
      data: { ...data, current: null, tasks: data.tasks.map(t => t.id === id ? { ...t, retries, status: 'failed' as const } : t) },
    };
  }
  return {
    result: 'retry',
    data: { ...data, current: null, tasks: data.tasks.map(t => t.id === id ? { ...t, retries, status: 'pending' as const } : t) },
  };
}

/** 恢复中断：返回新 ProgressData，将 active 任务重置为 pending（不修改原对象） */
export function resumeProgress(data: ProgressData): { data: ProgressData; resetId: string | null } {
  const hasActive = data.tasks.some(t => t.status === 'active');
  if (!hasActive) {
    return { data, resetId: data.status === 'running' ? data.current : null };
  }
  let firstId: string | null = null;
  const tasks = data.tasks.map(t => {
    if (t.status === 'active') {
      if (!firstId) firstId = t.id;
      return { ...t, status: 'pending' as const };
    }
    return t;
  });
  return { data: { ...data, current: null, status: 'running', tasks }, resetId: firstId };
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
