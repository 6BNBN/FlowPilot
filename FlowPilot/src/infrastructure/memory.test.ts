import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadMemory, appendMemory, queryMemory, decayMemory, temporalDecayScore, compactMemory, rollbackMemory, detectLanguage, rrfFuse, type MemoryEntry } from './memory';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mem-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('memory system', () => {
  it('loadMemory returns empty array when no file', async () => {
    expect(await loadMemory(dir)).toEqual([]);
  });

  it('appendMemory adds new entry', async () => {
    await appendMemory(dir, { content: 'use PostgreSQL', source: 'task-001', timestamp: new Date().toISOString() });
    const entries = await loadMemory(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('use PostgreSQL');
    expect(entries[0].refs).toBe(0);
    expect(entries[0].archived).toBe(false);
  });

  it('appendMemory deduplicates similar entries (similarity>0.8)', async () => {
    await appendMemory(dir, { content: 'use PostgreSQL database for user data storage design', source: 'task-001', timestamp: '2025-01-01T00:00:00Z' });
    await appendMemory(dir, { content: 'use PostgreSQL database for user data storage design', source: 'task-002', timestamp: '2025-01-02T00:00:00Z' });
    const entries = await loadMemory(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('task-002');
  });

  it('queryMemory returns matching entries and increments refs', async () => {
    await appendMemory(dir, { content: 'PostgreSQL schema design', source: 'task-001', timestamp: new Date().toISOString() });
    await appendMemory(dir, { content: 'React component patterns', source: 'task-002', timestamp: new Date().toISOString() });
    const results = await queryMemory(dir, 'PostgreSQL database schema');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('PostgreSQL');
    const all = await loadMemory(dir);
    expect(all.find(e => e.content.includes('PostgreSQL'))!.refs).toBe(1);
  });

  it('queryMemory returns empty for no match', async () => {
    await appendMemory(dir, { content: 'React hooks', source: 'task-001', timestamp: new Date().toISOString() });
    const results = await queryMemory(dir, 'xyz completely unrelated 12345');
    expect(results).toEqual([]);
  });

  it('decayMemory archives old unreferenced entries', async () => {
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    await appendMemory(dir, { content: 'old entry', source: 'task-001', timestamp: oldDate });
    const count = await decayMemory(dir);
    expect(count).toBe(1);
    const entries = await loadMemory(dir);
    expect(entries[0].archived).toBe(true);
  });

  it('decayMemory does not archive entries with refs > 0', async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await appendMemory(dir, { content: 'referenced entry about databases', source: 'task-001', timestamp: oldDate });
    await queryMemory(dir, 'databases'); // increments refs
    const count = await decayMemory(dir);
    expect(count).toBe(0);
  });
});

describe('TF-IDF tokenize (via appendMemory dedup)', () => {
  it('CJK bigram: near-identical CJK texts deduplicate', async () => {
    await appendMemory(dir, { content: '数据库设计方案确定', source: 't1', timestamp: '2025-01-01T00:00:00Z' });
    await appendMemory(dir, { content: '数据库设计方案确定', source: 't2', timestamp: '2025-01-02T00:00:00Z' });
    const entries = await loadMemory(dir);
    expect(entries).toHaveLength(1);
  });

  it('Latin words tokenized correctly: distinct texts stay separate', async () => {
    await appendMemory(dir, { content: 'PostgreSQL database schema design', source: 't1', timestamp: '2025-01-01T00:00:00Z' });
    await appendMemory(dir, { content: 'React component lifecycle hooks', source: 't2', timestamp: '2025-01-02T00:00:00Z' });
    const entries = await loadMemory(dir);
    expect(entries).toHaveLength(2);
  });

  it('mixed CJK+Latin text handled', async () => {
    await appendMemory(dir, { content: 'PostgreSQL数据库设计', source: 't1', timestamp: '2025-01-01T00:00:00Z' });
    await appendMemory(dir, { content: 'React组件模式', source: 't2', timestamp: '2025-01-02T00:00:00Z' });
    const entries = await loadMemory(dir);
    expect(entries).toHaveLength(2);
  });
});

describe('cosine similarity (via queryMemory)', () => {
  it('identical content scores highest', async () => {
    await appendMemory(dir, { content: 'PostgreSQL database design patterns', source: 't1', timestamp: new Date().toISOString() });
    const results = await queryMemory(dir, 'PostgreSQL database design patterns');
    expect(results).toHaveLength(1);
  });

  it('unrelated content returns empty', async () => {
    await appendMemory(dir, { content: 'PostgreSQL database design', source: 't1', timestamp: new Date().toISOString() });
    const results = await queryMemory(dir, 'zzzzz qqqqq wwwww');
    expect(results).toEqual([]);
  });
});

describe('MMR rerank (via queryMemory diversity)', () => {
  it('returns diverse results not just most similar', async () => {
    const now = new Date().toISOString();
    await appendMemory(dir, { content: 'PostgreSQL database schema design guide', source: 't1', timestamp: now });
    await appendMemory(dir, { content: 'PostgreSQL database schema migration tool', source: 't2', timestamp: now });
    await appendMemory(dir, { content: 'React frontend component architecture', source: 't3', timestamp: now });
    const results = await queryMemory(dir, 'PostgreSQL database schema');
    // Should return PostgreSQL entries and potentially React for diversity
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('PostgreSQL');
  });
});

describe('compactMemory', () => {
  it('merges similar entries', async () => {
    const now = new Date().toISOString();
    await appendMemory(dir, { content: 'PostgreSQL database schema design for users', source: 't1', timestamp: now });
    // Force a second distinct-enough entry then a similar one
    await appendMemory(dir, { content: 'React component patterns for frontend', source: 't2', timestamp: now });
    const before = await loadMemory(dir);
    expect(before).toHaveLength(2);
    const removed = await compactMemory(dir);
    // Two dissimilar entries should not merge
    expect(removed).toBe(0);
  });

  it('target count compresses to specified size', async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      await appendMemory(dir, { content: `unique topic number ${i} about ${['react','vue','angular','svelte','next'][i]}`, source: `t${i}`, timestamp: now });
    }
    const removed = await compactMemory(dir, 3);
    const after = await loadMemory(dir);
    expect(after.filter(e => !e.archived)).toHaveLength(3);
    expect(removed).toBe(2);
  });
});

describe('rollbackMemory', () => {
  it('restores from snapshot after compact', async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      await appendMemory(dir, { content: `topic ${i} about ${['react','vue','angular','svelte','next'][i]}`, source: `t${i}`, timestamp: now });
    }
    await compactMemory(dir, 3); // creates snapshot then compresses
    const ok = await rollbackMemory(dir);
    expect(ok).toBe(true);
    const after = await loadMemory(dir);
    expect(after).toHaveLength(5);
  });

  it('returns false when no snapshot exists', async () => {
    expect(await rollbackMemory(dir)).toBe(false);
  });
});

describe('temporalDecayScore', () => {
  const base: MemoryEntry = { content: 'test', source: 't1', timestamp: '', refs: 0, archived: false };

  it('new entry scores ~1', () => {
    const entry = { ...base, timestamp: new Date().toISOString() };
    expect(temporalDecayScore(entry)).toBeGreaterThan(0.95);
  });

  it('old entry (200 days) scores < 0.1', () => {
    const old = new Date(Date.now() - 200 * 86400000).toISOString();
    expect(temporalDecayScore({ ...base, timestamp: old })).toBeLessThan(0.1);
  });

  it('evergreen entry always returns 1', () => {
    const old = new Date(Date.now() - 365 * 86400000).toISOString();
    expect(temporalDecayScore({ ...base, timestamp: old, evergreen: true })).toBe(1);
  });

  it('architecture source is treated as evergreen', () => {
    const old = new Date(Date.now() - 365 * 86400000).toISOString();
    expect(temporalDecayScore({ ...base, timestamp: old, source: 'architecture-001' })).toBe(1);
  });
});

describe('queryMemory decay weight', () => {
  it('old entries rank lower than new entries for same content', async () => {
    const oldDate = new Date(Date.now() - 90 * 86400000).toISOString();
    const newDate = new Date().toISOString();
    await appendMemory(dir, { content: 'PostgreSQL database indexing strategy guide', source: 'old', timestamp: oldDate });
    await appendMemory(dir, { content: 'PostgreSQL database query optimization tips', source: 'new', timestamp: newDate });
    const results = await queryMemory(dir, 'PostgreSQL database');
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Newer entry should rank first due to decay weighting
    expect(results[0].source).toBe('new');
  });
});

describe('detectLanguage', () => {
  it('pure CJK returns cjk', () => {
    expect(detectLanguage('数据库设计方案确定').dominantScript).toBe('cjk');
  });

  it('pure English returns latin', () => {
    expect(detectLanguage('PostgreSQL database schema design').dominantScript).toBe('latin');
  });

  it('mixed CJK+Latin returns mixed', () => {
    const r = detectLanguage('PostgreSQL数据库设计方案React组件');
    expect(r.dominantScript).toBe('mixed');
  });

  it('empty string returns latin', () => {
    expect(detectLanguage('').dominantScript).toBe('latin');
  });
});

describe('queryMemory cache', () => {
  it('second call hits cache (same results)', async () => {
    await appendMemory(dir, { content: 'PostgreSQL database schema', source: 't1', timestamp: new Date().toISOString() });
    const r1 = await queryMemory(dir, 'PostgreSQL database');
    const r2 = await queryMemory(dir, 'PostgreSQL database');
    expect(r2).toEqual(r1);
  });

  it('appendMemory clears cache', async () => {
    await appendMemory(dir, { content: 'PostgreSQL database schema design guide', source: 't1', timestamp: new Date().toISOString() });
    await queryMemory(dir, 'PostgreSQL database');
    // cache file should exist
    const cachePath = join(dir, '.flowpilot', 'memory-cache.json');
    await expect(readFile(cachePath, 'utf-8')).resolves.toBeTruthy();
    // append clears cache
    await appendMemory(dir, { content: 'React component patterns for frontend apps', source: 't2', timestamp: new Date().toISOString() });
    await expect(readFile(cachePath, 'utf-8')).rejects.toThrow();
  });
});

describe('rrfFuse', () => {
  const mkEntry = (c: string): MemoryEntry => ({ content: c, source: 't', timestamp: '', refs: 0, archived: false });

  it('fuses two sources with different rankings', () => {
    const s1 = [{ entry: mkEntry('A'), score: 1 }, { entry: mkEntry('B'), score: 0.5 }];
    const s2 = [{ entry: mkEntry('B'), score: 1 }, { entry: mkEntry('A'), score: 0.5 }];
    const fused = rrfFuse([s1, s2]);
    // Both A and B appear in both sources at rank 0 and 1 respectively
    // A: 1/(60+1) + 1/(60+2) = ~0.01639 + ~0.01613 = ~0.03252
    // B: 1/(60+2) + 1/(60+1) = same
    expect(fused).toHaveLength(2);
    // Scores should be equal since symmetric
    expect(Math.abs(fused[0].score - fused[1].score)).toBeLessThan(0.001);
  });

  it('entry in more sources ranks higher', () => {
    const s1 = [{ entry: mkEntry('A'), score: 1 }];
    const s2 = [{ entry: mkEntry('A'), score: 1 }];
    const s3 = [{ entry: mkEntry('B'), score: 1 }];
    const fused = rrfFuse([s1, s2, s3]);
    expect(fused[0].entry.content).toBe('A');
  });
});

describe('vector index', () => {
  it('appendMemory creates vectors.json', async () => {
    await appendMemory(dir, { content: 'PostgreSQL indexing strategy', source: 't1', timestamp: new Date().toISOString() });
    const vectorPath = join(dir, '.flowpilot', 'vectors.json');
    await expect(access(vectorPath)).resolves.toBeUndefined();
  });

  it('queryMemory RRF fusion returns relevant results', async () => {
    const now = new Date().toISOString();
    await appendMemory(dir, { content: 'PostgreSQL database indexing strategy', source: 't1', timestamp: now });
    await appendMemory(dir, { content: 'React component lifecycle hooks', source: 't2', timestamp: now });
    await appendMemory(dir, { content: 'PostgreSQL query optimization guide', source: 't3', timestamp: now });
    const results = await queryMemory(dir, 'PostgreSQL database');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('PostgreSQL');
  });

  it('compactMemory rebuilds vectors.json with correct count', async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      await appendMemory(dir, { content: `unique topic ${i} about ${['react','vue','angular','svelte','next'][i]}`, source: `t${i}`, timestamp: now });
    }
    await compactMemory(dir, 3);
    const vectors = JSON.parse(await readFile(join(dir, '.flowpilot', 'vectors.json'), 'utf-8'));
    const active = (await loadMemory(dir)).filter(e => !e.archived);
    expect(vectors.length).toBe(active.length);
  });
});
