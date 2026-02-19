/**
 * @module interfaces/formatter
 * @description 输出格式化
 */

import type { ProgressData, TaskEntry } from '../domain/types';

const ICON: Record<string, string> = {
  pending: '[ ]', active: '[>]', done: '[x]', skipped: '[-]', failed: '[!]',
};

/** 格式化进度状态 */
export function formatStatus(data: ProgressData): string {
  const done = data.tasks.filter(t => t.status === 'done').length;
  const lines = [
    `=== ${data.name} ===`,
    `状态: ${data.status} | 进度: ${done}/${data.tasks.length}`,
    '',
  ];
  for (const t of data.tasks) {
    lines.push(`${ICON[t.status] ?? '[ ]'} ${t.id} [${t.type}] ${t.title}${t.summary ? ' - ' + t.summary : ''}`);
  }
  return lines.join('\n');
}

/** 格式化单个任务（flow next 输出） */
export function formatTask(task: TaskEntry, context: string): string {
  const lines = [
    `--- 任务 ${task.id} ---`,
    `标题: ${task.title}`,
    `类型: ${task.type}`,
    `依赖: ${task.deps.length ? task.deps.join(', ') : '无'}`,
  ];
  if (context) {
    lines.push('', '--- 上下文 ---', context);
  }
  return lines.join('\n');
}
