/**
 * @module infrastructure/history
 * @description 历史分析引擎 - 基于历史统计生成建议和推荐参数
 */

import type { WorkflowStats, ProgressData } from '../domain/types';
import { callClaude } from './extractor';
import { log } from './logger';
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
    taskResults: data.tasks.map(t => ({ id: t.id, type: t.type, status: t.status, retries: t.retries, summary: t.summary || undefined })),
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
  target: 'config' | 'protocol' | 'claude-md';
}

/** 反思报告 */
export interface ReflectReport {
  timestamp: string;
  findings: string[];
  experiments: Experiment[];
}

/** LLM 反思：调用 Claude 分析工作流统计 */
async function llmReflect(stats: WorkflowStats): Promise<ReflectReport | null> {
  const system = `你是工作流反思引擎。分析给定的工作流统计数据，找出失败模式和改进机会。返回 JSON: {"findings": ["发现1", ...], "experiments": [{"trigger":"触发原因","observation":"观察现象","action":"建议行动","expected":"预期效果","target":"config或protocol或claude-md"}, ...]}。target=claude-md 表示修改 CLAUDE.md 协议区域。只返回 JSON，不要其他内容。`;
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

/** 四维模式挖掘：从 checkpoint summary 中提取模式 */
function fourDimensionAnalysis(stats: WorkflowStats): { findings: string[]; experiments: Experiment[] } {
  const findings: string[] = [];
  const experiments: Experiment[] = [];
  const results = stats.taskResults ?? [];
  const FAIL_RE = /fail|error|timeout|FAILED|异常|超时/i;

  // friction: 失败任务 summary 中的失败原因模式
  const failedWithSummary = results.filter(r => r.status === 'failed' && r.summary);
  const frictionPatterns = new Map<string, number>();
  for (const r of failedWithSummary) {
    const matches = r.summary!.match(FAIL_RE);
    if (matches) {
      const key = matches[0].toLowerCase();
      frictionPatterns.set(key, (frictionPatterns.get(key) ?? 0) + 1);
    }
  }
  for (const [pattern, count] of frictionPatterns) {
    if (count >= 2) {
      findings.push(`[friction] 失败模式 "${pattern}" 出现 ${count} 次`);
      experiments.push({
        trigger: `重复失败模式: ${pattern}`, observation: `${count} 个任务因 "${pattern}" 失败`,
        action: `在子Agent提示模板中添加 "${pattern}" 预防检查`, expected: '减少同类失败',
        target: 'claude-md',
      });
    }
  }

  // delight: 一次通过、无重试的高效任务
  const efficient = results.filter(r => r.status === 'done' && r.retries === 0);
  if (efficient.length > 0 && stats.totalTasks > 0) {
    const rate = ((efficient.length / stats.totalTasks) * 100).toFixed(0);
    findings.push(`[delight] ${efficient.length}/${stats.totalTasks} 任务一次通过 (${rate}%)`);
  }

  // patterns: 任务类型分布 + summary 关键词
  const typeEntries = Object.entries(stats.tasksByType);
  if (typeEntries.length > 0) {
    findings.push(`[patterns] 类型分布: ${typeEntries.map(([t, n]) => `${t}=${n}`).join(', ')}`);
  }
  const keywords = new Map<string, number>();
  for (const r of results) {
    if (!r.summary) continue;
    for (const w of r.summary.split(/\s+/).filter(w => w.length > 2)) {
      keywords.set(w, (keywords.get(w) ?? 0) + 1);
    }
  }
  const topKw = [...keywords.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topKw.length) {
    findings.push(`[patterns] 高频关键词: ${topKw.map(([w, c]) => `${w}(${c})`).join(', ')}`);
  }

  // gaps: 被跳过的任务 + 级联失败链
  const skipped = results.filter(r => r.status === 'skipped');
  if (skipped.length) {
    findings.push(`[gaps] ${skipped.length} 个任务被跳过: ${skipped.map(r => r.id).join(',')}`);
  }
  let chain = 0, maxChain = 0;
  for (const r of results) {
    chain = r.status === 'failed' ? chain + 1 : 0;
    maxChain = Math.max(maxChain, chain);
  }
  if (maxChain >= 2) {
    findings.push(`[gaps] 最长连续失败链: ${maxChain} 个任务`);
  }

  return { findings, experiments };
}

/** 规则分析：从统计数据中提取 findings 和 experiments */
function ruleReflect(stats: WorkflowStats): ReflectReport {
  const findings: string[] = [];
  const experiments: Experiment[] = [];
  const results = stats.taskResults ?? [];

  // 四维模式挖掘
  const fourD = fourDimensionAnalysis(stats);
  findings.push(...fourD.findings);
  experiments.push(...fourD.experiments);

  // 连续失败链检测
  let streak = 0;
  for (let i = 0; i < results.length; i++) {
    streak = results[i].status === 'failed' ? streak + 1 : 0;
    if (streak >= 2) {
      findings.push(`连续失败链：从任务 ${results[i - streak + 1].id} 开始连续失败`);
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
  status: 'completed' | 'failed' | 'skipped';
  snapshotFile?: string;
}

/** 文件快照（参考 Memoh-v2 files_snapshot） */
export interface FilesSnapshot {
  timestamp: string;
  files: Record<string, string>;
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
    const re = new RegExp(k + '\\D*(\\d+)');
    const m = action.match(re);
    if (m) return { key: k, value: Number(m[1]) };
  }
  return null;
}

/** 保存预快照 */
async function saveSnapshot(basePath: string, files: Record<string, string>): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const p = join(basePath, '.flowpilot', 'evolution', `snapshot-${ts}.json`);
  const snapshot: FilesSnapshot = { timestamp: new Date().toISOString(), files };
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(snapshot, null, 2), 'utf-8');
  return p;
}

/** 加载最近的快照 */
async function loadLatestSnapshot(basePath: string): Promise<FilesSnapshot | null> {
  const dir = join(basePath, '.flowpilot', 'evolution');
  try {
    const files = (await readdir(dir)).filter(f => f.startsWith('snapshot-') && f.endsWith('.json')).sort();
    if (!files.length) return null;
    return JSON.parse(await readFile(join(dir, files[files.length - 1]), 'utf-8'));
  } catch { return null; }
}

/** 追加 EXPERIMENTS.md 人类可读日志 */
async function appendExperimentsMd(basePath: string, expLog: ExperimentLog, report: ReflectReport): Promise<void> {
  const mdPath = join(basePath, '.flowpilot', 'EXPERIMENTS.md');
  const existing = await safeRead(mdPath, '# Evolution Experiments\n');
  const date = new Date().toISOString().slice(0, 10);
  const applied = expLog.experiments.filter(e => e.applied);
  if (!applied.length) return;

  const entries = applied.map(e =>
    `### [${date}] ${e.trigger}\n` +
    `**触发**: ${e.trigger}\n` +
    `**观察**: ${e.observation}\n` +
    `**行动**: ${e.action} (target: ${e.target})\n` +
    `**预期效果**: ${e.expected}\n` +
    `**状态**: ${expLog.status}\n`
  ).join('\n');

  await mkdir(dirname(mdPath), { recursive: true });
  await writeFile(mdPath, existing.trimEnd() + '\n\n' + entries, 'utf-8');
}

/** 实验引擎：基于反思报告自动调整配置和协议 */
export async function experiment(
  report: ReflectReport,
  basePath: string,
): Promise<ExperimentLog> {
  const log: ExperimentLog = { timestamp: new Date().toISOString(), experiments: [], status: 'completed' };
  if (!report.experiments.length) return log;

  const configPath = join(basePath, '.flowpilot', 'config.json');
  const protocolPath = join(basePath, 'FlowPilot', 'src', 'templates', 'protocol.md');
  const claudeMdPath = join(basePath, 'CLAUDE.md');

  // 预快照：实验前保存完整文件内容（参考 Memoh-v2 files_snapshot）
  const configSnapshot = await safeRead(configPath, '{}');
  const protocolSnapshot = await safeRead(protocolPath, '');
  const claudeMdSnapshot = await safeRead(claudeMdPath, '');
  const snapshotFile = await saveSnapshot(basePath, { 'config.json': configSnapshot, 'protocol.md': protocolSnapshot, 'CLAUDE.md': claudeMdSnapshot });
  log.snapshotFile = snapshotFile;

  try {
    let configObj = JSON.parse(configSnapshot);
    let protocolContent = protocolSnapshot;
    let claudeMdContent = claudeMdSnapshot;

    let claudeMdExpCount = 0;

    for (const exp of report.experiments) {
      const applied: AppliedExperiment = { ...exp, applied: false, snapshotBefore: '' };
      try {
        if (exp.target === 'config') {
          applied.snapshotBefore = configSnapshot;
          const parsed = parseConfigAction(exp.action);
          if (parsed) {
            configObj = { ...configObj, [parsed.key]: parsed.value };
            applied.applied = true;
          }
        } else if (exp.target === 'protocol') {
          applied.snapshotBefore = protocolSnapshot;
          const appendix = `\n<!-- evolution: ${exp.trigger} -->\n> ${exp.action}\n`;
          protocolContent += appendix;
          applied.applied = true;
        } else if (exp.target === 'claude-md') {
          applied.snapshotBefore = claudeMdSnapshot;
          if (claudeMdExpCount >= 3) { /* max 3 claude-md experiments per cycle */ }
          else {
            const stripComments = (s: string) => s.replace(/<!--/g, '').replace(/-->/g, '');
            const safeTrigger = stripComments(exp.trigger);
            const safeAction = stripComments(exp.action);
            const endTag = '<!-- flowpilot:end -->';
            const idx = claudeMdContent.indexOf(endTag);
            if (idx >= 0) {
              const insertion = `\n<!-- evolution: ${safeTrigger} -->\n> ${safeAction}\n`;
              const startTag = '<!-- flowpilot:start -->';
              const startIdx = claudeMdContent.indexOf(startTag);
              const regionSize = (idx + endTag.length) - (startIdx >= 0 ? startIdx : 0) + insertion.length;
              if (regionSize <= 10_240) {
                claudeMdContent = claudeMdContent.slice(0, idx) + insertion + claudeMdContent.slice(idx);
                applied.applied = true;
                claudeMdExpCount++;
              }
            }
          }
        }
      } catch { /* 降级：applied 保持 false */ }
      log.experiments.push(applied);
    }

    // 循环结束后一次性写入
    if (log.experiments.some(e => e.applied && e.target === 'config')) {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, JSON.stringify(configObj, null, 2), 'utf-8');
    }
    if (log.experiments.some(e => e.applied && e.target === 'protocol')) {
      await mkdir(dirname(protocolPath), { recursive: true });
      await writeFile(protocolPath, protocolContent, 'utf-8');
    }
    if (log.experiments.some(e => e.applied && e.target === 'claude-md')) {
      await writeFile(claudeMdPath, claudeMdContent, 'utf-8');
    }
  } catch {
    log.status = 'failed';
  }

  // 追加保存实验日志
  const logPath = join(basePath, '.flowpilot', 'evolution', 'experiments.json');
  await mkdir(dirname(logPath), { recursive: true });
  let existing: ExperimentLog[] = [];
  try { existing = JSON.parse(await readFile(logPath, 'utf-8')); } catch { /* 首次创建 */ }
  existing.push(log);
  await writeFile(logPath, JSON.stringify(existing, null, 2), 'utf-8');

  // 追加 EXPERIMENTS.md 人类可读日志
  await appendExperimentsMd(basePath, log, report);

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
  const claudeMdPath = join(basePath, 'CLAUDE.md');
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

  // CLAUDE.md 完整性：协议标记必须成对存在
  const claudeMdRaw = await safeRead(claudeMdPath, '');
  if (claudeMdRaw) {
    const hasStart = claudeMdRaw.includes('<!-- flowpilot:start -->');
    const hasEnd = claudeMdRaw.includes('<!-- flowpilot:end -->');
    const intact = hasStart && hasEnd;
    checks.push({ name: 'CLAUDE.md', passed: intact, detail: intact ? '协议标记完整' : '协议标记缺失或损坏' });
    if (!intact && !rolledBack) {
      rolledBack = true;
      rollbackReason = 'CLAUDE.md 协议标记损坏';
    }
  }

  // 4. 自动回滚：从实验日志中记录的快照精确恢复
  if (rolledBack) {
    try {
      const logs: ExperimentLog[] = JSON.parse(await readFile(expPath, 'utf-8'));
      const firstExp = logs.find(l => l.snapshotFile);
      let snapshot: FilesSnapshot | null = null;
      if (firstExp?.snapshotFile) {
        try { snapshot = JSON.parse(await readFile(firstExp.snapshotFile, 'utf-8')); } catch { /* fallback below */ }
      }
      if (!snapshot) snapshot = await loadLatestSnapshot(basePath);
      if (snapshot) {
        if (snapshot.files['config.json']) await writeFile(configPath, snapshot.files['config.json'], 'utf-8');
        if (snapshot.files['protocol.md']) await writeFile(protocolPath, snapshot.files['protocol.md'], 'utf-8');
        if (snapshot.files['CLAUDE.md']) await writeFile(claudeMdPath, snapshot.files['CLAUDE.md'], 'utf-8');
      }
      // 标记最近实验为 skipped
      if (logs.length) {
        logs[logs.length - 1].status = 'skipped';
        await writeFile(expPath, JSON.stringify(logs, null, 2), 'utf-8');
      }
    } catch (e) { log.warn(`[review] rollback failed: ${e}`); }
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
