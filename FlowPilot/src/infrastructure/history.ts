/**
 * @module infrastructure/history
 * @description 历史分析引擎 - 基于历史统计生成建议和推荐参数
 */

import type { WorkflowStats, ProgressData } from '../domain/types';
import { callClaude } from './extractor';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

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
    taskResults: data.tasks.map(t => ({ id: t.id, type: t.type, status: t.status, retries: t.retries })),
    startTime: data.startTime || new Date().toISOString(),
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

/** 实验建议 */
export interface Experiment {
  trigger: string;
  observation: string;
  action: string;
  expected: string;
  target: 'config' | 'protocol';
}

/** 反思报告 */
export interface ReflectReport {
  timestamp: string;
  findings: string[];
  experiments: Experiment[];
}

/** LLM 反思：调用 Claude 分析工作流统计 */
async function llmReflect(stats: WorkflowStats): Promise<ReflectReport | null> {
  const system = `你是工作流反思引擎。分析给定的工作流统计数据，找出失败模式和改进机会。返回 JSON: {"findings": ["发现1", ...], "experiments": [{"trigger":"触发原因","observation":"观察现象","action":"建议行动","expected":"预期效果","target":"config或protocol"}, ...]}。只返回 JSON，不要其他内容。`;
  const result = await callClaude(JSON.stringify(stats), system);
  if (!result) return null;
  try {
    const match = result.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : result);
    if (Array.isArray(parsed.findings) && Array.isArray(parsed.experiments)) {
      return { timestamp: new Date().toISOString(), findings: parsed.findings, experiments: parsed.experiments };
    }
  } catch { /* 降级到规则分析 */ }
  return null;
}

/** 规则分析：从统计数据中提取 findings 和 experiments */
function ruleReflect(stats: WorkflowStats): ReflectReport {
  const findings: string[] = [];
  const experiments: Experiment[] = [];
  const results = stats.taskResults ?? [];

  // 连续失败链检测
  let streak = 0;
  for (const r of results) {
    streak = r.status === 'failed' ? streak + 1 : 0;
    if (streak >= 2) {
      findings.push(`连续失败链：从任务 ${results[results.indexOf(r) - 1].id} 开始连续失败`);
      experiments.push({
        trigger: '连续失败链', observation: `${streak} 个任务连续失败`,
        action: '在失败任务间插入诊断步骤', expected: '打断失败传播', target: 'protocol',
      });
      break;
    }
  }

  // 类型失败集中度
  for (const [type, total] of Object.entries(stats.tasksByType)) {
    const fails = stats.failsByType[type] ?? 0;
    if (total > 0 && fails / total > 0.3) {
      findings.push(`类型 ${type} 失败集中：${fails}/${total}`);
      experiments.push({
        trigger: '类型失败集中', observation: `${type} 失败率 ${((fails / total) * 100).toFixed(0)}%`,
        action: `拆分 ${type} 任务为更小粒度`, expected: '降低单任务失败率', target: 'config',
      });
    }
  }

  // 重试热点
  for (const r of results) {
    if (r.retries > 2) {
      findings.push(`重试热点：任务 ${r.id} 重试 ${r.retries} 次`);
      experiments.push({
        trigger: '重试热点', observation: `任务 ${r.id} 重试 ${r.retries} 次`,
        action: '增加该任务的上下文或前置检查', expected: '减少重试次数', target: 'protocol',
      });
    }
  }

  // 跳过率过高
  if (stats.totalTasks > 0 && stats.skipCount / stats.totalTasks > 0.2) {
    const rate = ((stats.skipCount / stats.totalTasks) * 100).toFixed(0);
    findings.push(`级联跳过严重：跳过率 ${rate}%`);
    experiments.push({
      trigger: '级联跳过', observation: `${stats.skipCount}/${stats.totalTasks} 任务被跳过`,
      action: '减少任务间硬依赖，改用软依赖', expected: '降低跳过率至 10% 以下', target: 'config',
    });
  }

  return { timestamp: new Date().toISOString(), findings, experiments };
}

/** 反思引擎：分析工作流成败模式，输出结构化反思报告 */
export async function reflect(stats: WorkflowStats, basePath: string): Promise<ReflectReport> {
  // 尝试 LLM 路径
  const llmReport = await llmReflect(stats);
  const report = llmReport ?? ruleReflect(stats);

  // 保存反思报告
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const p = join(basePath, '.flowpilot', 'evolution', `reflect-${ts}.json`);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(report, null, 2), 'utf-8');

  return report;
}
