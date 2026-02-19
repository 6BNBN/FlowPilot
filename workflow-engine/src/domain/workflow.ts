/**
 * @module domain/workflow
 * @description 工作流定义 - 简化为任务列表描述
 */

import type { TaskType } from './types';

/** 任务定义（从文档解析出的原始结构） */
export interface TaskDefinition {
  title: string;
  type: TaskType;
  deps: string[];
  description: string;
}

/** 工作流定义 */
export interface WorkflowDefinition {
  name: string;
  description: string;
  tasks: TaskDefinition[];
}
