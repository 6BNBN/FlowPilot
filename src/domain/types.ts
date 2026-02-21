/**
 * @module domain/types
 * @description 领域值对象与枚举
 */

/** 任务类型 - 决定子Agent调用哪个插件 */
export type TaskType = 'frontend' | 'backend' | 'general';

/** 任务状态 */
export type TaskStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

/** 工作流状态 */
export type WorkflowStatus = 'idle' | 'running' | 'finishing' | 'completed' | 'aborted';

/** 单个任务条目 */
export interface TaskEntry {
  /** 三位数编号如 "001" */
  id: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  /** 依赖的前置任务ID列表 */
  deps: string[];
  /** 完成摘要 */
  summary: string;
  /** 失败重试次数 */
  retries: number;
}

/** 工作流全局状态 */
export interface ProgressData {
  name: string;
  status: WorkflowStatus;
  current: string | null;
  tasks: TaskEntry[];
}

/** 工作流历史统计 */
export interface WorkflowStats {
  /** 工作流名称 */
  name: string;
  /** 总任务数 */
  totalTasks: number;
  /** 完成数 */
  doneCount: number;
  /** 跳过数 */
  skipCount: number;
  /** 失败数 */
  failCount: number;
  /** 总重试次数 */
  retryTotal: number;
  /** 按类型分布 { frontend: 3, backend: 5, general: 2 } */
  tasksByType: Record<string, number>;
  /** 按类型统计失败数 */
  failsByType: Record<string, number>;
  /** 工作流开始时间 ISO */
  startTime: string;
  /** 工作流结束时间 ISO */
  endTime: string;
}
