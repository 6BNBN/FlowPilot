/**
 * @module domain/workflow
 * @description 工作流定义聚合根 (DDD Aggregate Root - Definition State)
 * 静态结构，描述工作流的步骤拓扑，不含运行时状态
 */

import { StepId, StepType } from './types';
import { isValidCapability } from './capabilities';

/** 步骤定义 - 实体，工作流拓扑中的单个节点 */
export interface StepDefinition {
  readonly id: StepId;
  readonly type: StepType;
  readonly title: string;
  readonly description: string;
  /** 原子操作名（叶子节点必须引用能力清单中的操作） */
  readonly capability?: string;
  /** parallel/loop/branch 的子步骤 */
  readonly children?: StepDefinition[];
  /** loop/branch 的条件表达式 */
  readonly condition?: string;
  /** factory 类型的延迟生成提示 */
  readonly factoryHint?: string;
}

/** 工作流定义 - 聚合根，完整的工作流静态描述 */
export interface WorkflowDefinition {
  readonly name: string;
  readonly description: string;
  readonly steps: StepDefinition[];
}

/** 验证步骤定义的结构完整性 */
function validateStep(step: StepDefinition): string[] {
  const errors: string[] = [];
  if (!step.id) errors.push(`步骤缺少 id`);
  if (!step.title) errors.push(`步骤 ${step.id} 缺少 title`);

  if ((step.type === 'loop' || step.type === 'branch') && !step.condition) {
    errors.push(`步骤 ${step.id} 类型为 ${step.type}，需要 condition`);
  }
  if (step.type === 'factory' && !step.factoryHint) {
    errors.push(`步骤 ${step.id} 类型为 factory，需要 factoryHint`);
  }
  if (step.type === 'parallel' && (!step.children || step.children.length < 2)) {
    errors.push(`步骤 ${step.id} 类型为 parallel，至少需要 2 个子步骤`);
  }
  // 叶子节点（无 children）必须指定 capability
  const isLeaf = !step.children || step.children.length === 0;
  if (isLeaf && step.type === 'sequence' && !step.capability) {
    errors.push(`步骤 ${step.id} 是叶子节点，必须标记 {capability}（如 {write-file}）或声明为分子节点`);
  }
  // 指定了 capability 必须在清单中
  if (step.capability && !isValidCapability(step.capability)) {
    errors.push(`步骤 ${step.id} 引用了未知能力: ${step.capability}`);
  }
  if (step.children) {
    for (const child of step.children) {
      errors.push(...validateStep(child));
    }
  }
  return errors;
}

/** 验证工作流定义的结构完整性 */
export function validateWorkflow(def: WorkflowDefinition): string[] {
  const errors: string[] = [];
  if (!def.name) errors.push('工作流缺少 name');
  if (def.steps.length === 0) errors.push('工作流至少需要一个步骤');

  const ids = new Set<string>();
  const collectIds = (steps: StepDefinition[]) => {
    for (const s of steps) {
      if (ids.has(s.id)) errors.push(`步骤 id 重复: ${s.id}`);
      ids.add(s.id);
      if (s.children) collectIds(s.children);
    }
  };
  collectIds(def.steps);

  for (const step of def.steps) {
    errors.push(...validateStep(step));
  }
  return errors;
}
