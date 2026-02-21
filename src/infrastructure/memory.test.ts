import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadMemory, appendMemory, queryMemory, decayMemory } from './memory';

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

  it('appendMemory deduplicates similar entries', async () => {
    await appendMemory(dir, { content: 'use PostgreSQL database', source: 'task-001', timestamp: '2025-01-01T00:00:00Z' });
    await appendMemory(dir, { content: 'use PostgreSQL database system', source: 'task-002', timestamp: '2025-01-02T00:00:00Z' });
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
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
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
