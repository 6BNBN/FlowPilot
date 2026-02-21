/**
 * @module infrastructure/memory
 * @description 永久记忆系统 - 跨工作流知识积累
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
}

const MEMORY_FILE = 'memory.json';

function memoryPath(basePath: string): string {
  return join(basePath, '.flowpilot', MEMORY_FILE);
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

/** 追加记忆条目（相似度>0.8则更新而非新增） */
export async function appendMemory(basePath: string, entry: Omit<MemoryEntry, 'refs' | 'archived'>): Promise<void> {
  const entries = await loadMemory(basePath);
  const idx = entries.findIndex(e => !e.archived && similarity(e.content, entry.content) > 0.8);
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
}

/** 查询与任务描述相关的记忆（关键词匹配），命中条目 refs++ */
export async function queryMemory(basePath: string, taskDescription: string): Promise<MemoryEntry[]> {
  const entries = await loadMemory(basePath);
  const active = entries.filter(e => !e.archived);
  if (!active.length) return [];

  const scored = active
    .map(e => ({ entry: e, score: similarity(e.content, taskDescription) }))
    .filter(s => s.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (scored.length) {
    const hitIds = new Set(scored.map(s => s.entry));
    const updated = entries.map(e => hitIds.has(e) ? { ...e, refs: e.refs + 1 } : e);
    await saveMemory(basePath, updated);
    log.debug(`memory: 查询命中 ${scored.length} 条`);
  }
  return scored.map(s => ({ ...s.entry, refs: s.entry.refs + 1 }));
}

/** 衰减归档：refs=0 且超过 30 天的条目标记 archived */
export async function decayMemory(basePath: string): Promise<number> {
  const entries = await loadMemory(basePath);
  const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const e of entries) {
    if (!e.archived && e.refs === 0 && new Date(e.timestamp).getTime() < threshold) {
      e.archived = true;
      count++;
    }
  }
  if (count) {
    await saveMemory(basePath, entries);
    log.debug(`memory: 衰减归档 ${count} 条`);
  }
  return count;
}
