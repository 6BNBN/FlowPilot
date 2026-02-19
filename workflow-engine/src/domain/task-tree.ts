/**
 * @module domain/task-tree
 * @description 任务树 - 只读派生视图 (DDD Read Model / Projection)
 * 从运行时状态纯函数派生，不可变，不含副作用
 */

import { StepId, StepStatus } from './types';
import { StepDefinition } from './workflow';
import { WorkflowRuntime } from './runtime';

/** 任务节点 - 值对象，任务树中的单个可见节点 */
export interface TaskNode {
  readonly stepId: StepId;
  readonly title: string;
  readonly status: StepStatus;
  readonly children: TaskNode[];
  /** 关联的子工作流名称（分子节点） */
  readonly subWorkflow?: string;
}

/** 从单个步骤定义构建任务节点 */
function buildNode(step: StepDefinition, runtime: WorkflowRuntime): TaskNode {
  const state = runtime.stepStates.get(step.id);
  const status: StepStatus = state?.status ?? 'pending';
  const children = step.children
    ? step.children.map(c => buildNode(c, runtime))
    : [];
  const subWorkflow = runtime.subWorkflows.get(step.id);
  return { stepId: step.id, title: step.title, status, children, subWorkflow };
}

/**
 * 从运行时状态派生任务树 (纯函数)
 * 返回已完成的任务 + 从当前位置到下一个 loop/branch 的可见任务
 */
export function deriveTaskTree(runtime: WorkflowRuntime): TaskNode[] {
  const visibleIds = new Set(runtime.getVisibleSteps());
  const nodes: TaskNode[] = [];

  for (const step of runtime.definition.steps) {
    const state = runtime.stepStates.get(step.id);
    const isDone = state && (state.status === 'done' || state.status === 'skipped' || state.status === 'failed');
    if (isDone || visibleIds.has(step.id)) {
      nodes.push(buildNode(step, runtime));
    }
  }
  return nodes;
}
