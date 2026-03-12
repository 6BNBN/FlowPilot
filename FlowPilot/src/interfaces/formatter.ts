/**
 * @module interfaces/formatter
 * @description 输出格式化
 */

import type { ProgressData, TaskEntry } from '../domain/types';

const ICON: Record<string, string> = {
  pending: '[ ]',
  active: '[>]',
  done: '[x]',
  skipped: '[-]',
  failed: '[!]',
};

type TaskLike = TaskEntry & Record<string, unknown>;

function section(title: string, lines: Array<string | null | undefined>): string {
  const body = lines.filter((line): line is string => Boolean(line && line.trim()));
  return body.length ? `**${title}**\n${body.join('\n')}` : `**${title}**`;
}

function workflowName(name: string): string {
  return name?.trim() ? name : '未命名工作流';
}

function summarizeCounts(data: ProgressData): string {
  const done = data.tasks.filter(t => t.status === 'done').length;
  const active = data.tasks.filter(t => t.status === 'active').length;
  const pending = data.tasks.filter(t => t.status === 'pending').length;
  const skipped = data.tasks.filter(t => t.status === 'skipped').length;
  const failed = data.tasks.filter(t => t.status === 'failed').length;
  const extras = [
    active ? `${active} 进行中` : '',
    pending ? `${pending} 待执行` : '',
    skipped ? `${skipped} 跳过` : '',
    failed ? `${failed} 失败` : '',
  ].filter(Boolean).join(' | ');
  return `${done}/${data.tasks.length} 已完成${extras ? ` | ${extras}` : ''}`;
}

function readLiveValue(task: TaskLike, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = task[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function formatTaskMeta(task: TaskLike): string | null {
  const stage = readLiveValue(task, ['stage', 'phase', 'liveStage']);
  const recent = readLiveValue(task, ['recentActivity', 'lastActivityText', 'activityAge']);
  const progress = readLiveValue(task, ['progressText', 'latestProgress', 'activitySummary']);
  const parts = [
    stage ? `阶段: ${stage}` : '',
    recent ? `最近活动: ${recent}` : '',
    progress ? `进展: ${progress}` : '',
  ].filter(Boolean);
  return parts.length ? `   ${parts.join(' | ')}` : null;
}

function formatTaskLine(task: TaskLike): string[] {
  const lines = [`${ICON[task.status] ?? '[ ]'} ${task.id} [${task.type}] ${task.title}${task.summary ? ` - ${task.summary}` : ''}`];
  const meta = formatTaskMeta(task);
  if (meta) lines.push(meta);
  return lines;
}

/** 格式化进度状态 */
export function formatStatus(data: ProgressData): string {
  const lines = [
    section('当前状态', [
      `工作流: ${workflowName(data.name)}`,
      `状态: ${data.status}`,
      `进度: ${summarizeCounts(data)}`,
    ]),
    '',
    section('任务进度', data.tasks.flatMap(task => formatTaskLine(task as TaskLike))),
  ];
  return lines.join('\n');
}

/** 格式化单个任务（flow next 输出） */
export function formatTask(task: TaskEntry, context: string): string {
  const lines = [
    section(`任务 ${task.id}`, [
      `标题: ${task.title}`,
      `类型: ${task.type}`,
      `依赖: ${task.deps.length ? task.deps.join(', ') : '无'}`,
      task.description ? `描述: ${task.description}` : null,
    ]),
    '',
    section('Checkpoint 指令', [
      `完成时: echo '一句话摘要' | node flow.js checkpoint ${task.id} --files <changed-file-1> <changed-file-2>`,
      `失败时: echo 'FAILED' | node flow.js checkpoint ${task.id}`,
    ]),
  ];
  if (context) {
    lines.push('', section('上下文', [context]));
  }
  return lines.join('\n');
}

/** 格式化多个并行任务（flow next --batch 输出） */
export function formatBatch(items: { task: TaskEntry; context: string }[]): string {
  const lines = [
    section('并行任务批次', [
      `本轮共 ${items.length} 个任务`,
      '要求: 必须在同一条消息中并行派发全部任务；不要为了保守而降成串行。',
    ]),
    '',
  ];
  for (const { task, context } of items) {
    lines.push(formatTask(task, context), '');
  }
  return lines.join('\n');
}

/** 格式化 finish 收尾前的最终任务总结 */
export function formatFinalSummary(data: ProgressData): string {
  const done = data.tasks.filter(t => t.status === 'done').length;
  const skipped = data.tasks.filter(t => t.status === 'skipped').length;
  const failed = data.tasks.filter(t => t.status === 'failed').length;
  const pending = data.tasks.filter(t => t.status === 'pending' || t.status === 'active').length;
  const stats = `${done} 完成${skipped ? `, ${skipped} 跳过` : ''}${failed ? `, ${failed} 失败` : ''}${pending ? `, ${pending} 未完成` : ''}`;
  return [
    '最终总结:',
    section('完成情况', [
      `工作流: ${workflowName(data.name)}`,
      `统计: ${stats}`,
    ]),
    '',
    section('任务列表', data.tasks.flatMap(task => formatTaskLine(task as TaskLike))),
  ].join('\n');
}
