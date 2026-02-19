/**
 * @module infrastructure/repository
 * @description 工作流仓储接口 (DDD Port) - 定义持久化契约
 */

import { WorkflowDefinition } from '../domain/workflow';
import { WorkflowRuntime } from '../domain/runtime';

/** 活跃工作流指针 */
export interface ActivePointer {
  readonly workflow: string | null;
}

/** 工作流仓储接口 - 端口，不依赖具体存储实现 */
export interface WorkflowRepository {
  /** 保存工作流定义（Markdown 格式） */
  saveDefinition(name: string, markdown: string): Promise<void>;
  /** 加载工作流定义原始 Markdown */
  loadDefinitionRaw(name: string): Promise<string>;
  /** 删除工作流（定义 + 运行时 + 制品） */
  deleteWorkflow(name: string): Promise<void>;
  /** 列出所有工作流名称 */
  listWorkflows(): Promise<string[]>;

  /** 保存运行时状态 */
  saveRuntime(name: string, runtime: WorkflowRuntime): Promise<void>;
  /** 加载运行时状态，不存在则返回 null */
  loadRuntime(name: string): Promise<WorkflowRuntime | null>;
  /** 删除运行时状态 */
  deleteRuntime(name: string): Promise<void>;

  /** 保存派生任务树（只读，自动生成） */
  saveTaskTree(name: string, tree: unknown): Promise<void>;

  /** 获取当前活跃工作流 */
  getActive(): Promise<ActivePointer>;
  /** 设置当前活跃工作流 */
  setActive(name: string | null): Promise<void>;
}
