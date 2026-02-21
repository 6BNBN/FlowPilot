/**
 * @module domain/repository
 * @description 仓储接口 - 持久化契约
 */

import type { ProgressData } from './types';

/** 验证结果 */
export interface VerifyResult {
  passed: boolean;
  scripts: string[];
  error?: string;
}

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
  /** 保存任务树定义 */
  saveTasks(content: string): Promise<void>;
  loadTasks(): Promise<string | null>;
  /** 确保CLAUDE.md包含工作流协议 */
  ensureClaudeMd(): Promise<boolean>;
  /** 确保.claude/settings.json包含hooks */
  ensureHooks(): Promise<boolean>;
  /** 清理 context/ 目录（finish后释放上下文） */
  clearContext(): Promise<void>;
  /** 清理整个 .workflow/ 目录 */
  clearAll(): Promise<void>;
  /** 项目根目录 */
  projectRoot(): string;
  /** 文件锁 */
  lock(maxWait?: number): Promise<void>;
  unlock(): Promise<void>;
  /** Git自动提交，返回错误信息或null */
  commit(taskId: string, title: string, summary: string, files?: string[]): string | null;
  /** Git清理未提交变更（resume时调用），用stash保留而非丢弃 */
  cleanup(): void;
  /** 执行项目验证（build/test/lint） */
  verify(): VerifyResult;
}
