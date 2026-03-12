/**
 * @module interfaces/formatter
 * @description 输出格式化 - Claude 风格
 */

import type { ProgressData, TaskEntry } from '../domain/types';

// ═══ 统一符号系统 ═══
const ICON: Record<string, string> = {
  pending: '○',
  active: '⏳',
  done: '✓',
  skipped: '⊘',
  failed: '✗',
};

type TaskLike = TaskEntry & Record<string, unknown>;

// ═══ 视觉增强工具 ═══
function section(title: string, lines: Array<string | null | undefined>): string {
  const body = lines.filter((line): line is string => Boolean(line && line.trim()));
  return body.length 
    ? `**═══ ${title} ═══**\n${body.join('\n')}` 
    : `**═══ ${title} ═══**`;
}

function bullet(label: string, value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  return `${label}: ${value}`;
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
  
  const parts = [
    done === data.tasks.length ? '✓ 全部完成' : `${done}/${data.tasks.length} 已完成`,
    active ? `⏳ ${active} 进行中` : '',
    pending ? `○ ${pending} 待执行` : '',
    skipped ? `⊘ ${skipped} 跳过` : '',
    failed ? `✗ ${failed} 失败` : '',
  ].filter(Boolean);
  
  return parts.join(' | ');
}

function readLiveValue(task: TaskLike, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = task[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** 计算激活时长 */
function calcActiveDuration(activatedAt: number | undefined): string | null {
  if (!activatedAt) return null;
  const elapsed = Date.now() - activatedAt;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  if (mins === 0) return `⏱️ ${secs}秒`;
  return `⏱️ ${mins}分${secs}秒`;
}

/** 判断是否超时 (>5分钟) */
function isTimeout(activatedAt: number | undefined): boolean {
  if (!activatedAt) return false;
  return Date.now() - activatedAt > 5 * 60 * 1000;
}

function formatTaskMeta(task: TaskLike): string | null {
  const stage = readLiveValue(task, ['stage', 'phase', 'liveStage']);
  const recent = readLiveValue(task, ['recentActivity', 'lastActivityText', 'activityAge']);
  const progress = readLiveValue(task, ['progressText', 'latestProgress', 'activitySummary']);
  const activatedAt = typeof task.activatedAt === 'number' ? task.activatedAt : undefined;
  const activeDuration = task.status === 'active' ? calcActiveDuration(activatedAt) : null;
  const timeoutWarning = task.status === 'active' && isTimeout(activatedAt) ? '⚠️ 超时' : '';
  
  const parts = [
    stage ? `📍 ${stage}` : '',
    recent ? `🕐 ${recent}` : '',
    progress ? `📈 ${progress}` : '',
    activeDuration ? activeDuration : '',
    timeoutWarning,
  ].filter(Boolean);
  return parts.length ? `   ${parts.join(' · ')}` : null;
}

function formatTaskLine(task: TaskLike): string[] {
  const icon = ICON[task.status] ?? '○';
  const typeTag = `[${task.type}]`;
  const summary = task.summary ? ` — ${task.summary}` : '';
  const lines = [`${icon} ${task.id} ${typeTag} ${task.title}${summary}`];
  const meta = formatTaskMeta(task);
  if (meta) lines.push(meta);
  return lines;
}

/** 格式化进度状态 */
export function formatStatus(data: ProgressData): string {
  const activeTasks = data.tasks.filter(task => task.status === 'active');
  const blockedTasks = data.tasks.filter(task => readLiveValue(task as TaskLike, ['stage', 'phase', 'liveStage']) === 'blocked');
  
  const statusEmoji = data.status === 'running' ? '🔄' : data.status === 'finishing' ? '🏁' : '⏸';
  
  const lines = [
    `**═══ 工作流状态 ═══**`,
    `${statusEmoji} ${workflowName(data.name)} · ${data.status}`,
    `📊 ${summarizeCounts(data)}`,
    '',
    '**═══ 任务进度 ═══**',
    ...data.tasks.flatMap(task => formatTaskLine(task as TaskLike)),
  ];
  
  const nextSteps = [
    activeTasks.length ? `⏳ 继续跟进进行中的任务 (${activeTasks.map(task => task.id).join(', ')})` : '',
    blockedTasks.length ? `⚠️ 优先处理阻塞任务 (${blockedTasks.map(task => task.id).join(', ')})` : '',
    !activeTasks.length && !blockedTasks.length && data.tasks.some(task => task.status === 'pending')
      ? '💡 运行 `node flow.js next` 获取下一批任务'
      : '',
  ].filter(Boolean);
  
  if (nextSteps.length) {
    lines.push('', '**═══ 下一步 ═══**', ...nextSteps.map(step => `- ${step}`));
  }
  
  return lines.join('\n');
}

/** 格式化单个任务（flow next 输出） */
export function formatTask(task: TaskEntry, context: string): string {
  const icon = ICON[task.status] ?? '○';
  const typeIcon = task.type === 'frontend' ? '🎨' : task.type === 'backend' ? '⚙️' : '📋';
  
  const lines = [
    `**═══ 任务 ${task.id} ═══**`,
    `${icon} **${task.title}**`,
    '',
    `${typeIcon} 类型: ${task.type}`,
    `📎 依赖: ${task.deps.length ? task.deps.join(', ') : '无'}`,
    `🎯 目标: ${task.description || '未提供额外描述'}`,
    '',
    '**Checkpoint 指令**',
    '```',
    `echo '一句话摘要' | node flow.js checkpoint ${task.id} --files <file1> <file2>`,
    '```',
  ];
  
  if (context) {
    lines.push('', '**═══ 上下文 ═══**', context);
  }
  
  return lines.join('\n');
}

/** 格式化多个并行任务（flow next --batch 输出） */
export function formatBatch(items: { task: TaskEntry; context: string }[]): string {
  const lines = [
    '**═══ 并行任务批次 ═══**',
    `📦 本轮共 ${items.length} 个独立任务`,
    '⚡ 要求: 在同一条消息中并行派发全部任务',
    '💡 提示: 可把这一批当作同一轮并行前沿，一次派完再统一汇总',
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
  
  const stats = [
    `✓ ${done} 完成`,
    skipped ? `⊘ ${skipped} 跳过` : '',
    failed ? `✗ ${failed} 失败` : '',
    pending ? `○ ${pending} 未完成` : '',
  ].filter(Boolean).join(' · ');
  
  return [
    '**═══ 最终总结 ═══**',
    `📋 工作流: ${workflowName(data.name)}`,
    `📊 统计: ${stats}`,
    '',
    '**═══ 任务列表 ═══**',
    ...data.tasks.flatMap(task => formatTaskLine(task as TaskLike)),
  ].join('\n');
}
