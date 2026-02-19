/**
 * @module infrastructure/repository
 * @description 仓储接口 - 持久化契约
 */

import type { ProgressData } from '../domain/types';

/** 仓储接口 */
export interface WorkflowRepository {
  /** 保存进度数据到 progress.md */
  saveProgress(data: ProgressData): Promise<void>;
  /** 加载进度数据 */
  loadProgress(): Promise<ProgressData | null>;
  /** 保存任务详细产出 */
  saveTaskContext(taskId: string, content: string): Promise<void>;
  /** 加载任务详细产出 */
  loadTaskContext(taskId: string): Promise<string | null>;
  /** 保存/加载滚动摘要 */
  saveSummary(content: string): Promise<void>;
  loadSummary(): Promise<string>;
  /** 保存协议文件 */
  saveProtocol(content: string): Promise<void>;
  /** 保存任务树定义 */
  saveTasks(content: string): Promise<void>;
  loadTasks(): Promise<string | null>;
  /** 确保CLAUDE.md引用了protocol */
  ensureClaudeMd(): Promise<boolean>;
}
