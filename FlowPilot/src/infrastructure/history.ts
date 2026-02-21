/**
 * @module infrastructure/history
 * @description 历史分析引擎 - 基于历史统计生成建议和推荐参数
 */

import type { WorkflowStats, ProgressData } from '../domain/types';
import { callClaude } from './extractor';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
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

/** 已应用的实验 */
export interface AppliedExperiment extends Experiment {
  applied: boolean;
  snapshotBefore: string;
}

/** 实验日志 */
export interface ExperimentLog {
  timestamp: string;
  experiments: AppliedExperiment[];
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

/** 安全读取文件，不存在返回 fallback */
async function safeRead(p: string, fallback: string): Promise<string> {
  try { return await readFile(p, 'utf-8'); } catch { return fallback; }
}

/** 已知 config 参数名 */
const KNOWN_PARAMS = ['maxRetries', 'timeout', 'parallelLimit', 'verifyTimeout'] as const;

/** 从 action 文本提取参数名和数值 */
function parseConfigAction(action: string): { key: string; value: number } | null {
  for (const k of KNOWN_PARAMS) {
    if (action.includes(k)) {
      const m = action.match(/(\d+)/);
      if (m) return { key: k, value: Number(m[1]) };
    }
  }
  return null;
}

/** 实验引擎：基于反思报告自动调整配置和协议 */
export async function experiment(
  report: ReflectReport,
  basePath: string,
): Promise<ExperimentLog> {
  const log: ExperimentLog = { timestamp: new Date().toISOString(), experiments: [] };
  if (!report.experiments.length) return log;

  const configPath = join(basePath, '.flowpilot', 'config.json');
  const protocolPath = join(basePath, 'FlowPilot', 'src', 'templates', 'protocol.md');

  for (const exp of report.experiments) {
    const applied: AppliedExperiment = { ...exp, applied: false, snapshotBefore: '' };
    try {
      if (exp.target === 'config') {
        const raw = await safeRead(configPath, '{}');
        applied.snapshotBefore = raw;
        const parsed = parseConfigAction(exp.action);
        if (parsed) {
          const cfg = JSON.parse(raw);
          cfg[parsed.key] = parsed.value;
          await mkdir(dirname(configPath), { recursive: true });
          await writeFile(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
          applied.applied = true;
        }
      } else if (exp.target === 'protocol') {
        const content = await safeRead(protocolPath, '');
        applied.snapshotBefore = content;
        const appendix = `\n<!-- evolution: ${exp.trigger} -->\n> ${exp.action}\n`;
        await mkdir(dirname(protocolPath), { recursive: true });
        await writeFile(protocolPath, content + appendix, 'utf-8');
        applied.applied = true;
      }
    } catch { /* 降级：applied 保持 false */ }
    log.experiments.push(applied);
  }

  // 追加保存实验日志
  const logPath = join(basePath, '.flowpilot', 'evolution', 'experiments.json');
  await mkdir(dirname(logPath), { recursive: true });
  let existing: ExperimentLog[] = [];
  try { existing = JSON.parse(await readFile(logPath, 'utf-8')); } catch { /* 首次创建 */ }
  existing.push(log);
  await writeFile(logPath, JSON.stringify(existing, null, 2), 'utf-8');

  return log;
}

/** 审查检查项 */
export interface ReviewCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/** 审查结果 */
export interface ReviewResult {
  timestamp: string;
  checks: ReviewCheck[];
  rolledBack: boolean;
  rollbackReason?: string;
}

/** 自愈引擎：验证上轮实验效果，指标恶化则回滚 */
export async function review(basePath: string): Promise<ReviewResult> {
  const checks: ReviewCheck[] = [];
  let rolledBack = false;
  let rollbackReason: string | undefined;

  const historyDir = join(basePath, '.flowpilot', 'history');
  const configPath = join(basePath, '.flowpilot', 'config.json');
  const protocolPath = join(basePath, 'FlowPilot', 'src', 'templates', 'protocol.md');
  const expPath = join(basePath, '.flowpilot', 'evolution', 'experiments.json');

  // 1. 加载历史（最近两轮）
  let history: WorkflowStats[] = [];
  try {
    const files = (await readdir(historyDir)).filter(f => f.endsWith('.json')).sort();
    const recent = files.slice(-2);
    for (const f of recent) {
      try { history.push(JSON.parse(await readFile(join(historyDir, f), 'utf-8'))); } catch { /* skip */ }
    }
  } catch { /* 无历史目录 */ }

  // 2. 指标对比
  if (history.length >= 2) {
    const [prev, curr] = [history[history.length - 2], history[history.length - 1]];
    const rate = (s: WorkflowStats, fn: (s: WorkflowStats) => number) =>
      s.totalTasks > 0 ? fn(s) / s.totalTasks : 0;

    const metrics = [
      { name: 'failRate', fn: (s: WorkflowStats) => s.failCount },
      { name: 'skipRate', fn: (s: WorkflowStats) => s.skipCount },
      { name: 'retryRate', fn: (s: WorkflowStats) => s.retryTotal },
    ];

    for (const m of metrics) {
      const prevR = rate(prev, m.fn), currR = rate(curr, m.fn);
      const delta = currR - prevR;
      const passed = delta <= 0.1;
      checks.push({
        name: m.name,
        passed,
        detail: `${(prevR * 100).toFixed(1)}% → ${(currR * 100).toFixed(1)}% (delta ${(delta * 100).toFixed(1)}pp)`,
      });
      if (!passed && !rolledBack) {
        rolledBack = true;
        rollbackReason = `${m.name} 恶化 ${(delta * 100).toFixed(1)} 个百分点`;
      }
    }
  } else {
    checks.push({ name: 'metrics', passed: true, detail: '历史不足两轮，跳过对比' });
  }

  // 3. 完整性检查
  const configRaw = await safeRead(configPath, '');
  if (configRaw) {
    try { JSON.parse(configRaw); checks.push({ name: 'config.json', passed: true, detail: '合法 JSON' }); }
    catch { checks.push({ name: 'config.json', passed: false, detail: 'JSON 解析失败' }); }
  } else {
    checks.push({ name: 'config.json', passed: true, detail: '文件不存在，跳过' });
  }

  const protocolExists = (await safeRead(protocolPath, '')) !== '';
  checks.push({ name: 'protocol.md', passed: protocolExists, detail: protocolExists ? '存在' : '模板文件缺失' });

  const expRaw = await safeRead(expPath, '');
  if (expRaw) {
    try { JSON.parse(expRaw); checks.push({ name: 'experiments.json', passed: true, detail: '可解析' }); }
    catch { checks.push({ name: 'experiments.json', passed: false, detail: '解析失败' }); }
  } else {
    checks.push({ name: 'experiments.json', passed: true, detail: '文件不存在，跳过' });
  }

  // 4. 自动回滚
  if (rolledBack) {
    try {
      const logs: ExperimentLog[] = JSON.parse(await readFile(expPath, 'utf-8'));
      const last = logs[logs.length - 1];
      if (last) {
        for (const exp of last.experiments) {
          if (!exp.applied || !exp.snapshotBefore) continue;
          const target = exp.target === 'config' ? configPath : protocolPath;
          await writeFile(target, exp.snapshotBefore, 'utf-8');
        }
      }
    } catch { /* 无法回滚 */ }
  }

  // 5. 保存审查结果
  const result: ReviewResult = {
    timestamp: new Date().toISOString(),
    checks,
    rolledBack,
    ...(rollbackReason ? { rollbackReason } : {}),
  };
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(basePath, '.flowpilot', 'evolution', `review-${ts}.json`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 2), 'utf-8');

  return result;
}
