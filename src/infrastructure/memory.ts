/**
 * @module infrastructure/memory
 * @description 永久记忆系统 - 跨工作流知识积累（TF-IDF + 余弦相似度 + MMR）
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { log } from './logger';

/** 记忆条目 */
export interface MemoryEntry {
  content: string;
  source: string;
  timestamp: string;
  refs: number;
  archived: boolean;
  evergreen?: boolean;
}

/** DF 统计持久化结构 */
interface DfStats {
  docCount: number;
  df: Record<string, number>;
}

const MEMORY_FILE = 'memory.json';
const DF_FILE = 'memory-df.json';
const EVERGREEN_SOURCES = ['architecture', 'identity', 'decision'];

/** 指数衰减评分：score = exp(-ln2/halfLife * ageDays)，evergreen 条目恒为 1 */
export function temporalDecayScore(entry: MemoryEntry, halfLifeDays = 30): number {
  if (entry.evergreen || EVERGREEN_SOURCES.some(s => entry.source.includes(s))) return 1;
  const ageDays = (Date.now() - new Date(entry.timestamp).getTime()) / (24 * 60 * 60 * 1000);
  return Math.exp(-Math.LN2 / halfLifeDays * ageDays);
}

function memoryPath(basePath: string): string {
  return join(basePath, '.flowpilot', MEMORY_FILE);
}

function dfPath(basePath: string): string {
  return join(basePath, '.flowpilot', DF_FILE);
}

/** 多语言分词：CJK 单字+双字gram、拉丁词、数字、下划线标识符 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  // 拉丁词、数字、下划线标识符
  for (const m of lower.matchAll(/[a-z0-9_]{2,}|[a-z]/g)) {
    tokens.push(m[0]);
  }
  // CJK 单字 + 双字 bigram
  const cjk = [...lower.matchAll(/[\u4e00-\u9fff\u3400-\u4dbf]/g)].map(m => m[0]);
  for (let i = 0; i < cjk.length; i++) {
    tokens.push(cjk[i]);
    if (i + 1 < cjk.length) tokens.push(cjk[i] + cjk[i + 1]);
  }
  return tokens;
}

/** 计算词频向量 */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** 加载 DF 统计 */
async function loadDf(basePath: string): Promise<DfStats> {
  try {
    return JSON.parse(await readFile(dfPath(basePath), 'utf-8'));
  } catch {
    return { docCount: 0, df: {} };
  }
}

/** 保存 DF 统计 */
async function saveDf(basePath: string, stats: DfStats): Promise<void> {
  const p = dfPath(basePath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(stats), 'utf-8');
}

/** 从记忆条目重建 DF 统计 */
function rebuildDf(entries: MemoryEntry[]): DfStats {
  const active = entries.filter(e => !e.archived);
  const df: Record<string, number> = {};
  for (const e of active) {
    const unique = new Set(tokenize(e.content));
    for (const t of unique) df[t] = (df[t] ?? 0) + 1;
  }
  return { docCount: active.length, df };
}

/** 生成 TF-IDF 向量 */
function tfidfVector(tokens: string[], stats: DfStats): Map<string, number> {
  const tf = termFrequency(tokens);
  const vec = new Map<string, number>();
  const N = Math.max(stats.docCount, 1);
  for (const [term, freq] of tf) {
    const docFreq = stats.df[term] ?? 0;
    const idf = Math.log(1 + N / (1 + docFreq));
    vec.set(term, freq * idf);
  }
  return vec;
}

/** 余弦相似度 */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  for (const [k, v] of a) {
    normA += v * v;
    const bv = b.get(k);
    if (bv !== undefined) dot += v * bv;
  }
  for (const v of b.values()) normB += v * v;
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 加载所有记忆条目 */
export async function loadMemory(basePath: string): Promise<MemoryEntry[]> {
  try {
    return JSON.parse(await readFile(memoryPath(basePath), 'utf-8'));
  } catch {
    return [];
  }
}

async function saveMemory(basePath: string, entries: MemoryEntry[]): Promise<void> {
  const p = memoryPath(basePath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(entries, null, 2), 'utf-8');
}

/** 追加记忆条目（TF-IDF 余弦相似度>0.8则更新而非新增） */
export async function appendMemory(basePath: string, entry: Omit<MemoryEntry, 'refs' | 'archived'>): Promise<void> {
  const entries = await loadMemory(basePath);
  const stats = rebuildDf(entries);
  const queryTokens = tokenize(entry.content);
  const queryVec = tfidfVector(queryTokens, stats);

  const idx = entries.findIndex(e => {
    if (e.archived) return false;
    const vec = tfidfVector(tokenize(e.content), stats);
    return cosineSimilarity(queryVec, vec) > 0.8;
  });

  if (idx >= 0) {
    const updated = entries.map((e, i) =>
      i === idx ? { ...e, content: entry.content, timestamp: entry.timestamp, source: entry.source } : e
    );
    log.debug(`memory: 更新已有条目 (相似度>0.8)`);
    await saveMemory(basePath, updated);
  } else {
    const newEntries = [...entries, { ...entry, refs: 0, archived: false }];
    log.debug(`memory: 新增条目, 总计 ${newEntries.length}`);
    await saveMemory(basePath, newEntries);
  }
  await saveDf(basePath, rebuildDf(await loadMemory(basePath)));
}

/** MMR 重排序：平衡相关性与多样性 (lambda=0.7) */
function mmrRerank(
  candidates: { entry: MemoryEntry; score: number; vec: Map<string, number> }[],
  k: number,
  lambda = 0.7
): { entry: MemoryEntry; score: number }[] {
  const selected: typeof candidates = [];
  const remaining = [...candidates];
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const rel = remaining[i].score;
      let maxSim = 0;
      for (const s of selected) {
        maxSim = Math.max(maxSim, cosineSimilarity(remaining[i].vec, s.vec));
      }
      const mmr = lambda * rel - (1 - lambda) * maxSim;
      if (mmr > bestScore) { bestScore = mmr; bestIdx = i; }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }
  return selected.map(s => ({ entry: s.entry, score: s.score }));
}

/** 查询与任务描述相关的记忆（TF-IDF + 余弦相似度 + MMR），命中条目 refs++ */
export async function queryMemory(basePath: string, taskDescription: string): Promise<MemoryEntry[]> {
  const entries = await loadMemory(basePath);
  const active = entries.filter(e => !e.archived);
  if (!active.length) return [];

  const stats = await loadDf(basePath);
  const fallback = stats.docCount > 0 ? stats : rebuildDf(entries);
  const queryVec = tfidfVector(tokenize(taskDescription), fallback);

  const candidates = active.map(e => {
    const vec = tfidfVector(tokenize(e.content), fallback);
    return { entry: e, score: cosineSimilarity(queryVec, vec) * temporalDecayScore(e), vec };
  }).filter(s => s.score > 0.05);

  const reranked = mmrRerank(candidates, 5);

  if (reranked.length) {
    const hitSet = new Set(reranked.map(s => s.entry));
    const updated = entries.map(e => hitSet.has(e) ? { ...e, refs: e.refs + 1 } : e);
    await saveMemory(basePath, updated);
    log.debug(`memory: 查询命中 ${reranked.length} 条`);
  }
  return reranked.map(s => ({ ...s.entry, refs: s.entry.refs + 1 }));
}

/** 衰减归档：衰减系数 < 0.1 且 refs=0 的条目标记 archived（immutable） */
export async function decayMemory(basePath: string): Promise<number> {
  const entries = await loadMemory(basePath);
  let count = 0;
  const updated = entries.map(e => {
    if (!e.archived && e.refs === 0 && temporalDecayScore(e) < 0.1) {
      count++;
      return { ...e, archived: true };
    }
    return e;
  });
  if (count) {
    await saveMemory(basePath, updated);
    log.debug(`memory: 衰减归档 ${count} 条`);
  }
  return count;
}
