/**
 * @module interfaces/formatter
 * @description 输出格式化 - 将领域数据转换为 AI 可读的结构化文本
 */

import type { TaskNode } from '../domain/task-tree';
import type { WorkflowState, WorkflowSummary } from '../application/workflow-service';
import { CAPABILITIES } from '../domain/capabilities';

const STATUS_ICON: Record<string, string> = {
  pending: '[ ]', active: '[>]', done: '[x]', skipped: '[-]', failed: '[!]',
};

function formatNode(node: TaskNode, indent: number): string {
  const prefix = '  '.repeat(indent);
  const icon = STATUS_ICON[node.status] ?? '[ ]';
  const sub = node.subWorkflow ? ` → [${node.subWorkflow}]` : '';
  const line = `${prefix}${icon} ${node.title}${sub}`;
  const childLines = node.children.map(c => formatNode(c, indent + 1));
  return [line, ...childLines].join('\n');
}

/** 格式化任务树 */
export function formatTaskTree(tree: TaskNode[]): string {
  if (tree.length === 0) return '(无任务)';
  return tree.map(n => formatNode(n, 0)).join('\n');
}

/** 格式化工作流完整状态 */
export function formatStatus(state: WorkflowState): string {
  const { definition, runtime, taskTree } = state;
  return [
    `=== 工作流: ${definition.name} ===`,
    `状态: ${runtime.status}`,
    `当前步骤: ${runtime.currentStepId ?? '(无)'}`,
    '',
    '--- 任务树 ---',
    formatTaskTree(taskTree),
  ].join('\n');
}

/** 格式化原子能力清单 */
export function formatCapabilities(): string {
  const header = `原子能力清单 (共 ${CAPABILITIES.length} 项):\n`;
  const lines = CAPABILITIES.map(c => {
    const se = c.hasSideEffect ? '⚡' : '👁';
    return `  ${se} {${c.name}} - ${c.description}  [${c.params.join(', ')}]`;
  });
  return header + lines.join('\n') + '\n\n工作流中使用 {能力名} 标记原子步骤';
}
export function formatList(workflows: WorkflowSummary[]): string {
  if (workflows.length === 0) return '(无工作流)';
  const header = `共 ${workflows.length} 个工作流:\n`;
  const lines = workflows.map(w => `  ${w.name} [${w.status}]`);
  return header + lines.join('\n');
}
