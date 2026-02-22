/**
 * @module infrastructure/vector-store
 * @description 文件级 dense vector 存储 - brute-force 余弦相似度检索
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

const DENSE_VECTOR_FILE = 'dense-vectors.json';

/** Dense 向量条目 */
export interface DenseVectorEntry {
  id: string;
  vector: number[];
}

function denseVectorPath(dir: string): string {
  return join(dir, '.flowpilot', DENSE_VECTOR_FILE);
}

/** 加载 dense 向量 */
export async function loadDenseVectors(dir: string): Promise<DenseVectorEntry[]> {
  try {
    return JSON.parse(await readFile(denseVectorPath(dir), 'utf-8'));
  } catch { return []; }
}

/** 保存 dense 向量 */
export async function saveDenseVectors(dir: string, entries: DenseVectorEntry[]): Promise<void> {
  const p = denseVectorPath(dir);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(entries), 'utf-8');
}

/** 余弦相似度（dense float[] 版本） */
function denseCosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Brute-force dense 向量检索，返回 top-K */
export function denseSearch(
  query: number[],
  entries: DenseVectorEntry[],
  topK: number
): { id: string; score: number }[] {
  return entries
    .map(e => ({ id: e.id, score: denseCosineSim(query, e.vector) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
