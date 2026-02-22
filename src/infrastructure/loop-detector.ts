/**
 * @module infrastructure/loop-detector
 * @description 循环检测器 - 三策略防护（重复无进展 / 乒乓检测 / 全局熔断）
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { ActiveHoursConfig, isWithinActiveHours } from './heartbeat';

/** 检查点记录 */
export interface CheckpointRecord {
  taskId: string;
  summary: string;
  status: 'done' | 'failed';
  hash: number;
  timestamp: string;
}

/** 检测结果 */
export interface LoopDetection {
  stuck: boolean;
  strategy: string;
  message: string;
}

const WINDOW_SIZE = 20;
const STATE_FILE = 'loop-state.json';

/** 简单字符串 hash（FNV-1a 变体） */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/** 词袋 tokenize（兼容 CJK） */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[a-z0-9_]+|[\u4e00-\u9fff]/g)) {
    tokens.add(m[0]);
  }
  return tokens;
}

/** Jaccard 相似度 */
function similarity(a: string, b: string): number {
  const sa = tokenize(a), sb = tokenize(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function statePath(basePath: string): string {
  return join(basePath, '.workflow', STATE_FILE);
}

/** 加载滑动窗口 */
export async function loadWindow(basePath: string): Promise<CheckpointRecord[]> {
  try {
    return JSON.parse(await readFile(statePath(basePath), 'utf-8'));
  } catch {
    return [];
  }
}

/** 保存滑动窗口 */
async function saveWindow(basePath: string, window: CheckpointRecord[]): Promise<void> {
  const p = statePath(basePath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(window), 'utf-8');
}

/** 策略1: 连续3次相似 summary 且都是 FAILED */
function repeatedNoProgress(window: CheckpointRecord[]): LoopDetection | null {
  if (window.length < 3) return null;
  const last3 = window.slice(-3);
  if (!last3.every(r => r.status === 'failed')) return null;
  const sim01 = similarity(last3[0].summary, last3[1].summary);
  const sim12 = similarity(last3[1].summary, last3[2].summary);
  if (sim01 > 0.8 && sim12 > 0.8) {
    return {
      stuck: true,
      strategy: 'repeatedNoProgress',
      message: `连续3次相似失败（相似度 ${sim01.toFixed(2)}/${sim12.toFixed(2)}），任务可能陷入死循环`,
    };
  }
  return null;
}

/** 策略2: 两个任务交替失败（A→B→A→B） */
function pingPong(window: CheckpointRecord[]): LoopDetection | null {
  if (window.length < 4) return null;
  const last4 = window.slice(-4);
  if (!last4.every(r => r.status === 'failed')) return null;
  if (last4[0].taskId === last4[2].taskId &&
      last4[1].taskId === last4[3].taskId &&
      last4[0].taskId !== last4[1].taskId) {
    return {
      stuck: true,
      strategy: 'pingPong',
      message: `任务 ${last4[0].taskId} 和 ${last4[1].taskId} 交替失败，疑似乒乓循环`,
    };
  }
  return null;
}

/** 策略3: 滑动窗口内失败率 > 60% */
function globalCircuitBreaker(window: CheckpointRecord[]): LoopDetection | null {
  if (window.length < 5) return null;
  const failCount = window.filter(r => r.status === 'failed').length;
  const rate = failCount / window.length;
  if (rate > 0.6) {
    return {
      stuck: true,
      strategy: 'globalCircuitBreaker',
      message: `滑动窗口失败率 ${(rate * 100).toFixed(0)}%（${failCount}/${window.length}），建议暂停工作流排查问题`,
    };
  }
  return null;
}

/**
 * 记录一次 checkpoint 并运行三策略检测
 * @returns 检测结果（null 表示正常）
 */
export async function detect(
  basePath: string,
  taskId: string,
  summary: string,
  failed: boolean,
  activeHours?: ActiveHoursConfig,
): Promise<LoopDetection | null> {
  if (!isWithinActiveHours(activeHours)) return null;
  const window = await loadWindow(basePath);
  const record: CheckpointRecord = {
    taskId,
    summary,
    status: failed ? 'failed' : 'done',
    hash: fnv1a(summary),
    timestamp: new Date().toISOString(),
  };

  const updated = [...window, record].slice(-WINDOW_SIZE);
  await saveWindow(basePath, updated);

  // 按优先级依次检测
  return repeatedNoProgress(updated)
    ?? pingPong(updated)
    ?? globalCircuitBreaker(updated);
}
