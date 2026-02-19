/**
 * @module domain/types
 * @description 领域值对象与枚举 (DDD Value Objects & Enums)
 */

/** 步骤类型 - 值对象，定义工作流节点的控制流语义 */
export type StepType = 'sequence' | 'parallel' | 'loop' | 'branch' | 'factory';

/** 步骤状态 - 值对象，表示运行时单步的生命周期 */
export type StepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

/** 工作流状态 - 值对象，表示整个工作流的生命周期 */
export type WorkflowStatus = 'draft' | 'running' | 'paused' | 'completed' | 'aborted';

/** 品牌类型 - 防止原始字符串混用 (DDD Identity) */
export type StepId = string & { readonly __brand: 'StepId' };
export type WorkflowId = string & { readonly __brand: 'WorkflowId' };

/** 构造品牌类型的工厂函数 */
export const StepId = (id: string): StepId => id as StepId;
export const WorkflowId = (id: string): WorkflowId => id as WorkflowId;

/** 制品 - 值对象，步骤产出的文件或资源 */
export interface Artifact {
  /** 制品路径 */
  readonly path: string;
  /** 制品描述 */
  readonly description: string;
}
