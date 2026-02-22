/**
 * @module infrastructure/heartbeat
 * @description 心跳自检 - 定时健康检查（任务超时 / 记忆膨胀 / DF 一致性）
 */

import { log } from './logger';
import { loadMemory, loadDf, saveDf, rebuildDf, compactMemory } from './memory';
import { loadWindow } from './loop-detector';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { ProgressData } from '../domain/types';

export interface ActiveHoursConfig {
  activeHoursStart?: number; // 0-23
  activeHoursEnd?: number;   // 0-23
  activeDays?: number[];     // 0=Sun..6=Sat
  timezone?: string;         // e.g. "Asia/Shanghai"
}

export interface HeartbeatResult {
  warnings: string[];
  actions: string[];
}

const TASK_TIMEOUT_MS = 30 * 60 * 1000;
const MEMORY_COMPACT_THRESHOLD = 100;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** 判断当前是否在活跃时间窗口内 */
export function isWithinActiveHours(cfg?: ActiveHoursConfig): boolean {
  if (!cfg?.activeHoursStart && cfg?.activeHoursStart !== 0) return true;
  const now = cfg.timezone
    ? new Date(new Date().toLocaleString('en-US', { timeZone: cfg.timezone }))
    : new Date();
  const hour = now.getHours();
  const day = now.getDay();
  if (cfg.activeDays?.length && !cfg.activeDays.includes(day)) return false;
  const start = cfg.activeHoursStart;
  const end = cfg.activeHoursEnd ?? 23;
  return start <= end ? hour >= start && hour <= end : hour >= start || hour <= end;
}

/** 单次心跳检查 */
export async function runHeartbeat(basePath: string, config?: ActiveHoursConfig): Promise<HeartbeatResult> {
  if (!isWithinActiveHours(config)) return { warnings: [], actions: [] };
  const warnings: string[] = [];
  const actions: string[] = [];

  // 1. 活跃任务超时
  try {
    const raw = await readFile(join(basePath, '.workflow', 'progress.json'), 'utf-8');
    const data: ProgressData = JSON.parse(raw);
    if (data.status === 'running') {
      const active = data.tasks.filter(t => t.status === 'active');
      if (active.length) {
        const window = await loadWindow(basePath);
        const lastTs = window.length ? new Date(window[window.length - 1].timestamp).getTime() : 0;
        if (lastTs && Date.now() - lastTs > TASK_TIMEOUT_MS) {
          warnings.push(`[TIMEOUT] 任务 ${active.map(t => t.id).join(',')} 超过30分钟无checkpoint`);
        }
      }
    }
  } catch { /* no progress = skip */ }

  // 2. 记忆膨胀
  try {
    const memories = await loadMemory(basePath);
    const activeCount = memories.filter(e => !e.archived).length;
    if (activeCount > MEMORY_COMPACT_THRESHOLD) {
      await compactMemory(basePath);
      actions.push(`compacted memory from ${activeCount} entries`);
      warnings.push(`[MEMORY] 活跃记忆 ${activeCount} 条，已自动压缩`);
    }
  } catch { /* skip */ }

  // 3. DF 完整性
  try {
    const dfStats = await loadDf(basePath);
    if (dfStats.docCount > 0) {
      const memories = await loadMemory(basePath);
      const rebuilt = rebuildDf(memories);
      const diff = Math.abs(dfStats.docCount - rebuilt.docCount) / Math.max(dfStats.docCount, 1);
      if (diff > 0.1) {
        await saveDf(basePath, rebuilt);
        actions.push('rebuilt DF stats');
        warnings.push(`[DF] docCount 偏差 ${(diff * 100).toFixed(0)}%，已重建`);
      }
    }
  } catch { /* skip */ }

  if (warnings.length) log.info(`[heartbeat] ${warnings.join('; ')}`);
  return { warnings, actions };
}

/** 启动定时心跳，返回停止函数 */
export function startHeartbeat(basePath: string, intervalMs = DEFAULT_INTERVAL_MS, config?: ActiveHoursConfig): () => void {
  const timer = setInterval(() => { runHeartbeat(basePath, config).catch(() => {}); }, intervalMs);
  timer.unref();
  log.debug(`[heartbeat] started (interval=${intervalMs}ms)`);
  return () => { clearInterval(timer); log.debug('[heartbeat] stopped'); };
}
