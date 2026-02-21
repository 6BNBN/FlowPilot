/**
 * @module infrastructure/logger
 * @description 结构化日志模块 - verbose stderr 输出 + JSONL 持久化 + trace 导出
 */

import { appendFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

/** 日志步骤类型枚举 */
export type StepType =
  | 'task_started' | 'task_completed' | 'task_failed'
  | 'checkpoint_saved'
  | 'memory_searched' | 'memory_stored' | 'memory_compacted'
  | 'workflow_init' | 'workflow_finished'
  | 'evolution_applied' | 'loop_detected';

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn';

/** 结构化日志条目 */
export interface LogEntry {
  timestamp: string;
  step: StepType;
  level: LogLevel;
  taskId?: string;
  message: string;
  data?: unknown;
  durationMs?: number;
}

/** step() 可选参数 */
export interface StepOpts {
  level?: LogLevel;
  taskId?: string;
  data?: unknown;
  durationMs?: number;
}

let verbose = process.env.FLOWPILOT_VERBOSE === '1';
let basePath: string | null = null;
let workflowName: string | null = null;

/** 启用 verbose 模式 */
export function enableVerbose(): void {
  verbose = true;
  process.env.FLOWPILOT_VERBOSE = '1';
}

/** 配置日志持久化路径 */
export function configureLogger(projectPath: string): void {
  basePath = projectPath;
}

/** 设置当前工作流名称（用于日志文件命名） */
export function setWorkflowName(name: string): void {
  workflowName = name;
}

/** 获取日志文件路径 */
function logFilePath(): string | null {
  if (!basePath || !workflowName) return null;
  return join(basePath, '.flowpilot', 'logs', `${workflowName}.jsonl`);
}

/** 持久化一条日志到 JSONL 文件 */
function persist(entry: LogEntry): void {
  const p = logFilePath();
  if (!p) return;
  try {
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(entry) + '\n', 'utf-8');
  } catch { /* 日志写入失败不应中断主流程 */ }
}

export const log = {
  debug(msg: string): void {
    if (verbose) process.stderr.write(`[DEBUG] ${msg}\n`);
  },
  info(msg: string): void {
    process.stderr.write(`[INFO] ${msg}\n`);
  },
  warn(msg: string): void {
    process.stderr.write(`[WARN] ${msg}\n`);
  },
  /** 记录结构化日志条目 */
  step(step: StepType, message: string, opts?: StepOpts): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      step,
      level: opts?.level ?? 'info',
      message,
      ...(opts?.taskId != null && { taskId: opts.taskId }),
      ...(opts?.data != null && { data: opts.data }),
      ...(opts?.durationMs != null && { durationMs: opts.durationMs }),
    };
    persist(entry);
    if (verbose) {
      process.stderr.write(`[STEP:${step}] ${message}\n`);
    }
  },
};

/** 导出完整日志链（指定工作流或当前工作流） */
export function exportTrace(wfName?: string): LogEntry[] {
  const name = wfName ?? workflowName;
  if (!basePath || !name) return [];
  const p = join(basePath, '.flowpilot', 'logs', `${name}.jsonl`);
  try {
    return readFileSync(p, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as LogEntry);
  } catch {
    return [];
  }
}

/** 导出指定任务的日志链 */
export function exportTaskTrace(taskId: string): LogEntry[] {
  return exportTrace().filter(e => e.taskId === taskId);
}
