/**
 * @module infrastructure/memory
 * @description 永久记忆系统 - 跨工作流知识积累（BM25 + 余弦相似度 + MMR）
 */

import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
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
export interface DfStats {
  docCount: number;
  df: Record<string, number>;
  avgDocLen: number;
}

/** BM25 参数 */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

const MEMORY_FILE = 'memory.json';
const DF_FILE = 'memory-df.json';
const SNAPSHOT_FILE = 'memory-snapshot.json';
const VECTOR_FILE = 'vectors.json';

/** 向量存储条目 */
interface VectorEntry {
  content: string;
  vector: Record<string, number>;
}
const COMPACT_THRESHOLD = 50;
const EVERGREEN_SOURCES = ['architecture', 'identity', 'decision'];

/** 查询缓存条目 */
interface CacheEntry {
  results: MemoryEntry[];
  timestamp: string;
}
/** 查询缓存结构 */
interface QueryCache {
  entries: Record<string, CacheEntry>;
}
const CACHE_FILE = 'memory-cache.json';
const CACHE_MAX = 50;
const CACHE_PRUNE_RATIO = 0.1;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function cachePath(basePath: string): string {
  return join(basePath, '.flowpilot', CACHE_FILE);
}

async function loadCache(basePath: string): Promise<QueryCache> {
  try {
    return JSON.parse(await readFile(cachePath(basePath), 'utf-8'));
  } catch {
    return { entries: {} };
  }
}

async function saveCache(basePath: string, cache: QueryCache): Promise<void> {
  const p = cachePath(basePath);
  await mkdir(dirname(p), { recursive: true });
  // LRU 淘汰
  const keys = Object.keys(cache.entries);
  if (keys.length > CACHE_MAX) {
    const sorted = keys.sort((a, b) =>
      cache.entries[a].timestamp.localeCompare(cache.entries[b].timestamp)
    );
    const pruneCount = Math.ceil(keys.length * CACHE_PRUNE_RATIO);
    for (const k of sorted.slice(0, pruneCount)) delete cache.entries[k];
  }
  await writeFile(p, JSON.stringify(cache), 'utf-8');
}

async function clearCache(basePath: string): Promise<void> {
  try { await unlink(cachePath(basePath)); } catch { /* ignore */ }
}

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

function snapshotPath(basePath: string): string {
  return join(basePath, '.flowpilot', SNAPSHOT_FILE);
}

function vectorFilePath(basePath: string): string {
  return join(basePath, '.flowpilot', VECTOR_FILE);
}

/** 加载所有向量 */
async function loadVectors(basePath: string): Promise<VectorEntry[]> {
  try {
    return JSON.parse(await readFile(vectorFilePath(basePath), 'utf-8'));
  } catch { return []; }
}

/** 保存向量（原子写入） */
async function saveVectors(basePath: string, vectors: VectorEntry[]): Promise<void> {
  const p = vectorFilePath(basePath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(vectors), 'utf-8');
}

/** 向量检索：余弦相似度 top-k */
function vectorSearch(
  queryVec: Map<string, number>,
  vectors: VectorEntry[],
  entries: MemoryEntry[],
  k: number
): { entry: MemoryEntry; score: number }[] {
  const contentMap = new Map(entries.map(e => [e.content, e]));
  return vectors
    .map(v => {
      const stored = new Map(Object.entries(v.vector));
      const entry = contentMap.get(v.content);
      if (!entry) return null;
      return { entry, score: cosineSimilarity(queryVec, stored) };
    })
    .filter((x): x is { entry: MemoryEntry; score: number } => x !== null && x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** 重建向量索引：只保留活跃条目 */
async function rebuildVectorIndex(basePath: string, active: MemoryEntry[], stats: DfStats): Promise<void> {
  const vectors: VectorEntry[] = active.map(e => ({
    content: e.content,
    vector: Object.fromEntries(bm25Vector(tokenize(e.content), stats)),
  }));
  await saveVectors(basePath, vectors);
}

/** CJK 全范围：中文 + 日文平假名/片假名 + 韩文 */
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;

/** 多语言分词：CJK 单字+双字gram、拉丁词、数字、下划线标识符 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  for (const m of lower.matchAll(/[a-z0-9_]{2,}|[a-z]/g)) {
    tokens.push(m[0]);
  }
  const cjk = [...lower.matchAll(CJK_RE)].map(m => m[0]);
  for (let i = 0; i < cjk.length; i++) {
    tokens.push(cjk[i]);
    if (i + 1 < cjk.length) tokens.push(cjk[i] + cjk[i + 1]);
  }
  return tokens;
}

/** 检测文本的 CJK 比例，返回 { cjkRatio, dominantScript } */
export function detectLanguage(text: string): { cjkRatio: number; dominantScript: 'cjk' | 'latin' | 'mixed' } {
  const sample = text.slice(0, 300);
  if (!sample.length) return { cjkRatio: 0, dominantScript: 'latin' };
  const cjkCount = (sample.match(CJK_RE) || []).length;
  const cjkRatio = cjkCount / sample.length;
  return { cjkRatio, dominantScript: cjkRatio > 0.5 ? 'cjk' : cjkRatio < 0.1 ? 'latin' : 'mixed' };
}

/** 计算词频向量 */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** 加载 DF 统计 */
export async function loadDf(basePath: string): Promise<DfStats> {
  try {
    return JSON.parse(await readFile(dfPath(basePath), 'utf-8'));
  } catch {
    return { docCount: 0, df: {}, avgDocLen: 0 };
  }
}

/** 保存 DF 统计 */
export async function saveDf(basePath: string, stats: DfStats): Promise<void> {
  const p = dfPath(basePath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(stats), 'utf-8');
}

/** 从记忆条目重建 DF 统计（含 avgDocLen） */
export function rebuildDf(entries: MemoryEntry[]): DfStats {
  const active = entries.filter(e => !e.archived);
  const df: Record<string, number> = {};
  let totalLen = 0;
  for (const e of active) {
    const tokens = tokenize(e.content);
    totalLen += tokens.length;
    const unique = new Set(tokens);
    for (const t of unique) df[t] = (df[t] ?? 0) + 1;
  }
  return { docCount: active.length, df, avgDocLen: active.length ? totalLen / active.length : 0 };
}

/** 生成 BM25 加权向量 (k1=1.2, b=0.75) */
function bm25Vector(tokens: string[], stats: DfStats): Map<string, number> {
  const tf = termFrequency(tokens);
  const vec = new Map<string, number>();
  const N = Math.max(stats.docCount, 1);
  const avgDl = stats.avgDocLen || 1;
  const docLen = tokens.length;
  for (const [term, freq] of tf) {
    const dfVal = stats.df[term] ?? 0;
    const idf = Math.log(1 + (N - dfVal + 0.5) / (dfVal + 0.5));
    const tfNorm = (freq * (BM25_K1 + 1)) / (freq + BM25_K1 * (1 - BM25_B + BM25_B * docLen / avgDl));
    vec.set(term, tfNorm * idf);
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

/** 追加记忆条目（BM25 余弦相似度>0.8则更新而非新增） */
export async function appendMemory(basePath: string, entry: Omit<MemoryEntry, 'refs' | 'archived'>): Promise<void> {
  const entries = await loadMemory(basePath);
  const stats = rebuildDf(entries);
  const queryTokens = tokenize(entry.content);
  const queryVec = bm25Vector(queryTokens, stats);

  const idx = entries.findIndex(e => {
    if (e.archived) return false;
    const vec = bm25Vector(tokenize(e.content), stats);
    return cosineSimilarity(queryVec, vec) > 0.8;
  });

  if (idx >= 0) {
    const oldContent = entries[idx].content;
    const updated = entries.map((e, i) =>
      i === idx ? { ...e, content: entry.content, timestamp: entry.timestamp, source: entry.source } : e
    );
    log.debug(`memory: 更新已有条目 (相似度>0.8)`);
    await saveMemory(basePath, updated);
    // 清除旧 content 的向量残留
    const vectors = await loadVectors(basePath);
    await saveVectors(basePath, vectors.filter(v => v.content !== oldContent));
  } else {
    const newEntries = [...entries, { ...entry, refs: 0, archived: false }];
    log.debug(`memory: 新增条目, 总计 ${newEntries.length}`);
    await saveMemory(basePath, newEntries);
  }
  const saved = await loadMemory(basePath);
  const newStats = rebuildDf(saved);
  await saveDf(basePath, newStats);

  // 向量索引：追加/更新当前条目的 BM25 向量
  const vec = bm25Vector(tokenize(entry.content), newStats);
  const vecRecord: Record<string, number> = Object.fromEntries(vec);
  const vectors = await loadVectors(basePath);
  const vi = vectors.findIndex(v => v.content === entry.content);
  const newVectors = vi >= 0
    ? vectors.map((v, i) => i === vi ? { content: entry.content, vector: vecRecord } : v)
    : [...vectors, { content: entry.content, vector: vecRecord }];
  await saveVectors(basePath, newVectors);

  await clearCache(basePath);
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

/** RRF 多源融合：score = Σ 1/(k + rank_i)，k=60 */
export function rrfFuse(sources: { entry: MemoryEntry; score: number }[][]): { entry: MemoryEntry; score: number }[] {
  const RRF_K = 60;
  const scores = new Map<string, { entry: MemoryEntry; score: number }>();
  for (const source of sources) {
    for (let rank = 0; rank < source.length; rank++) {
      const { entry } = source[rank];
      const key = entry.content;
      const prev = scores.get(key);
      const rrfScore = 1 / (RRF_K + rank + 1);
      scores.set(key, {
        entry,
        score: (prev?.score ?? 0) + rrfScore,
      });
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

/** 查询与任务描述相关的记忆（BM25 文本检索 + 向量余弦检索 → RRF 双源融合 + MMR 重排序），命中条目 refs++，含 SHA-256 + LRU 缓存 */
export async function queryMemory(basePath: string, taskDescription: string): Promise<MemoryEntry[]> {
  const cacheKey = sha256(taskDescription);
  const cache = await loadCache(basePath);
  if (cache.entries[cacheKey]) {
    log.debug('memory: 缓存命中');
    return cache.entries[cacheKey].results;
  }

  const entries = await loadMemory(basePath);
  const active = entries.filter(e => !e.archived);
  if (!active.length) return [];

  const stats = await loadDf(basePath);
  const fallback = stats.docCount > 0 ? stats : rebuildDf(entries);
  const queryVec = bm25Vector(tokenize(taskDescription), fallback);

  // Source 1: BM25 + 余弦相似度 + 时间衰减
  const source1 = active.map(e => {
    const vec = bm25Vector(tokenize(e.content), fallback);
    return { entry: e, score: cosineSimilarity(queryVec, vec) * temporalDecayScore(e), vec };
  }).filter(s => s.score > 0.05);

  // Source 2: 向量余弦检索
  const vectors = await loadVectors(basePath);
  const source2 = vectorSearch(queryVec, vectors, active, 10);

  // RRF 双源融合
  const fused = rrfFuse([
    source1.map(s => ({ entry: s.entry, score: s.score })),
    source2,
  ]);

  // 从 fused 结果恢复 vec 用于 MMR 重排序
  const candidates = fused.map(f => {
    const vec = bm25Vector(tokenize(f.entry.content), fallback);
    return { entry: f.entry, score: f.score, vec };
  });

  const reranked = mmrRerank(candidates, 5);

  if (reranked.length) {
    const hitSet = new Set(reranked.map(s => s.entry));
    const updated = entries.map(e => hitSet.has(e) ? { ...e, refs: e.refs + 1 } : e);
    await saveMemory(basePath, updated);
    log.debug(`memory: 查询命中 ${reranked.length} 条`);
  }
  const results = reranked.map(s => ({ ...s.entry, refs: s.entry.refs + 1 }));
  cache.entries[cacheKey] = { results, timestamp: new Date().toISOString() };
  await saveCache(basePath, cache);
  return results;
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

/** 保存记忆快照（压缩前备份） */
async function saveSnapshot(basePath: string, entries: MemoryEntry[]): Promise<void> {
  const p = snapshotPath(basePath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(entries, null, 2), 'utf-8');
}

/** 记忆压缩：合并语义相似(>0.7)条目，可选目标数量压缩 */
export async function compactMemory(basePath: string, targetCount?: number): Promise<number> {
  const entries = await loadMemory(basePath);
  const active = entries.filter(e => !e.archived);
  if (active.length <= 1) return 0;

  // 压缩前保存快照
  await saveSnapshot(basePath, entries);

  const stats = rebuildDf(entries);
  const vecs = active.map(e => bm25Vector(tokenize(e.content), stats));
  const merged = new Set<number>();
  const result: MemoryEntry[] = [...entries.filter(e => e.archived)];

  for (let i = 0; i < active.length; i++) {
    if (merged.has(i)) continue;
    let current = active[i];
    for (let j = i + 1; j < active.length; j++) {
      if (merged.has(j)) continue;
      if (cosineSimilarity(vecs[i], vecs[j]) > 0.7) {
        // 合并策略：保留较新内容，refs 取较大值
        const newer = new Date(active[j].timestamp) > new Date(current.timestamp) ? active[j] : current;
        current = { ...newer, refs: Math.max(current.refs, active[j].refs) };
        merged.add(j);
      }
    }
    result.push(current);
  }

  // 目标数量压缩：按 refs 升序 + 时间升序 淘汰多余条目
  const activeResult = result.filter(e => !e.archived);
  if (targetCount && activeResult.length > targetCount) {
    const sorted = [...activeResult].sort((a, b) =>
      a.refs !== b.refs ? a.refs - b.refs : new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const toRemove = new Set(sorted.slice(0, activeResult.length - targetCount));
    const final = result.filter(e => !toRemove.has(e));
    await saveMemory(basePath, final);
    const finalStats = rebuildDf(final);
    await saveDf(basePath, finalStats);
    await rebuildVectorIndex(basePath, final.filter(e => !e.archived), finalStats);
    await clearCache(basePath);
    log.debug(`memory: 压缩 ${entries.length} → ${final.length} 条`);
    return entries.length - final.length;
  }

  await saveMemory(basePath, result);
  const resultStats = rebuildDf(result);
  await saveDf(basePath, resultStats);
  await rebuildVectorIndex(basePath, result.filter(e => !e.archived), resultStats);
  await clearCache(basePath);
  const removed = entries.length - result.length;
  if (removed) log.debug(`memory: 压缩合并 ${removed} 条`);
  return removed;
}

/** 从快照回滚记忆 */
export async function rollbackMemory(basePath: string): Promise<boolean> {
  try {
    const snapshot = JSON.parse(await readFile(snapshotPath(basePath), 'utf-8')) as MemoryEntry[];
    await saveMemory(basePath, snapshot);
    await saveDf(basePath, rebuildDf(snapshot));
    log.debug(`memory: 从快照回滚 ${snapshot.length} 条`);
    return true;
  } catch {
    return false;
  }
}
