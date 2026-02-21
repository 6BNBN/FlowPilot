/**
 * @module infrastructure/history
 * @description 历史分析引擎 - 基于历史统计生成建议和推荐参数
 */

import type { WorkflowStats, ProgressData } from '../domain/types';

/** 分析结果 */
export interface HistoryAnalysis {
  /** 建议字符串列表 */
  suggestions: string[];
  /** 推荐参数覆盖 */
  recommendedConfig: Record<string, unknown>;
}

/** 从 ProgressData 收集统计数据 */
export function collectStats(data: ProgressData): WorkflowStats {
  const tasksByType: Record<string, number> = {};
  const failsByType: Record<string, number> = {};
  let retryTotal = 0, doneCount = 0, skipCount = 0, failCount = 0;

  for (const t of data.tasks) {
    tasksByType[t.type] = (tasksByType[t.type] ?? 0) + 1;
    retryTotal += t.retries;
    if (t.status === 'done') doneCount++;
    else if (t.status === 'skipped') skipCount++;
    else if (t.status === 'failed') {
      failCount++;
      failsByType[t.type] = (failsByType[t.type] ?? 0) + 1;
    }
  }

  return {
    name: data.name,
    totalTasks: data.tasks.length,
    doneCount, skipCount, failCount, retryTotal,
    tasksByType, failsByType,
    startTime: '', // 由调用方填充
    endTime: new Date().toISOString(),
  };
}

/** 分析历史统计，生成建议和推荐参数 */
export function analyzeHistory(history: WorkflowStats[]): HistoryAnalysis {
  if (!history.length) return { suggestions: [], recommendedConfig: {} };

  const suggestions: string[] = [];
  const recommendedConfig: Record<string, unknown> = {};

  // 按类型汇总
  const typeTotal: Record<string, number> = {};
  const typeFails: Record<string, number> = {};
  let totalRetries = 0, totalTasks = 0;

  for (const h of history) {
    totalTasks += h.totalTasks;
    totalRetries += h.retryTotal;
    for (const [t, n] of Object.entries(h.tasksByType)) {
      typeTotal[t] = (typeTotal[t] ?? 0) + n;
    }
    for (const [t, n] of Object.entries(h.failsByType)) {
      typeFails[t] = (typeFails[t] ?? 0) + n;
    }
  }

  // 按类型失败率建议
  for (const [type, total] of Object.entries(typeTotal)) {
    const fails = typeFails[type] ?? 0;
    const rate = fails / total;
    if (rate > 0.2 && total >= 3) {
      suggestions.push(`${type} 类型任务历史失败率 ${(rate * 100).toFixed(0)}%（${fails}/${total}），建议拆分更细`);
    }
  }

  // 平均 retry 率建议
  if (totalTasks > 0) {
    const avgRetry = totalRetries / totalTasks;
    if (avgRetry > 1) {
      suggestions.push(`平均重试次数 ${avgRetry.toFixed(1)}，建议增加 retry 上限`);
      recommendedConfig.maxRetries = Math.min(Math.ceil(avgRetry) + 2, 8);
    }
  }

  // 跳过率建议
  const totalSkips = history.reduce((s, h) => s + h.skipCount, 0);
  if (totalTasks > 0 && totalSkips / totalTasks > 0.15) {
    suggestions.push(`历史跳过率 ${((totalSkips / totalTasks) * 100).toFixed(0)}%，建议减少任务间依赖`);
  }

  return { suggestions, recommendedConfig };
}
