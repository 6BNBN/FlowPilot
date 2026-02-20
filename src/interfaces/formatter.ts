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
  if (task.description) {
    lines.push(`描述: ${task.description}`);
  }
  lines.push('', '--- checkpoint指令（必须包含在sub-agent prompt中） ---');
  lines.push(`完成时: echo '一句话摘要' | node flow.js checkpoint ${task.id} --files <changed-file-1> <changed-file-2>`);
  lines.push(`失败时: echo 'FAILED' | node flow.js checkpoint ${task.id}`);
  if (context) {
    lines.push('', '--- 上下文 ---', context);
  }
  return lines.join('\n');
}

/** 格式化多个并行任务（flow next --batch 输出） */
export function formatBatch(items: { task: TaskEntry; context: string }[]): string {
  const lines = [`=== 并行任务批次 (${items.length}个) ===`, ''];
  for (const { task, context } of items) {
    lines.push(formatTask(task, context), '');
  }
  return lines.join('\n');
}
