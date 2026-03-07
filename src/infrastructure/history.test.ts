import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { collectStats, analyzeHistory, reflect, experiment, review } from './history';
import type { ReflectReport } from './history';
import type { ProgressData, WorkflowStats } from '../domain/types';

let savedApiKey: string | undefined;
let savedAuthToken: string | undefined;

beforeAll(() => {
  savedApiKey = process.env.ANTHROPIC_API_KEY;
  savedAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

afterAll(() => {
  if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
  if (savedAuthToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = savedAuthToken;
});

function makeProgress(overrides?: Partial<ProgressData>): ProgressData {
  return {
    name: 'test', status: 'running', current: null,
    tasks: [
      { id: '001', title: 'A', description: '', type: 'backend', status: 'done', deps: [], summary: 'ok', retries: 0 },
      { id: '002', title: 'B', description: '', type: 'frontend', status: 'failed', deps: [], summary: '', retries: 3 },
      { id: '003', title: 'C', description: '', type: 'general', status: 'skipped', deps: ['002'], summary: '', retries: 0 },
    ],
    ...overrides,
  };
}

function makeStats(overrides?: Partial<WorkflowStats>): WorkflowStats {
  return {
    name: 'test', totalTasks: 10, doneCount: 7, skipCount: 1, failCount: 2,
    retryTotal: 5, tasksByType: { backend: 5, frontend: 5 },
    failsByType: { frontend: 2 }, taskResults: [], startTime: '', endTime: '',
    ...overrides,
  };
}

describe('collectStats', () => {
  it('correctly counts done/skip/fail/retries', () => {
    const stats = collectStats(makeProgress());
    expect(stats.totalTasks).toBe(3);
    expect(stats.doneCount).toBe(1);
    expect(stats.failCount).toBe(1);
    expect(stats.skipCount).toBe(1);
    expect(stats.retryTotal).toBe(3);
  });

  it('uses startTime from ProgressData when present', () => {
    const stats = collectStats(makeProgress({ startTime: '2025-06-01T00:00:00Z' }));
    expect(stats.startTime).toBe('2025-06-01T00:00:00Z');
  });

  it('falls back to current time when startTime missing', () => {
    const before = new Date().toISOString();
    const stats = collectStats(makeProgress({ startTime: undefined }));
    expect(stats.startTime >= before).toBe(true);
  });

  it('groups tasks by type', () => {
    const stats = collectStats(makeProgress());
    expect(stats.tasksByType).toEqual({ backend: 1, frontend: 1, general: 1 });
    expect(stats.failsByType).toEqual({ frontend: 1 });
  });
});

describe('analyzeHistory', () => {
  it('empty history returns no suggestions', () => {
    const { suggestions, recommendedConfig } = analyzeHistory([]);
    expect(suggestions).toEqual([]);
    expect(recommendedConfig).toEqual({});
  });

  it('high fail rate triggers suggestion', () => {
    const stats = makeStats({ tasksByType: { frontend: 5 }, failsByType: { frontend: 2 } });
    const { suggestions } = analyzeHistory([stats]);
    expect(suggestions.some(s => s.includes('frontend') && s.includes('失败率'))).toBe(true);
  });

  it('high retry rate triggers maxRetries recommendation', () => {
    const stats = makeStats({ totalTasks: 5, retryTotal: 10 });
    const { suggestions, recommendedConfig } = analyzeHistory([stats]);
    expect(suggestions.some(s => s.includes('重试'))).toBe(true);
    expect(recommendedConfig.maxRetries).toBeGreaterThan(2);
  });

  it('high skip rate triggers suggestion', () => {
    const stats = makeStats({ totalTasks: 10, skipCount: 3 });
    const { suggestions } = analyzeHistory([stats]);
    expect(suggestions.some(s => s.includes('跳过率'))).toBe(true);
  });
});

describe('reflect', () => {
  let base: string;
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'fp-reflect-')); });

  it('degrades to rule analysis without ANTHROPIC_API_KEY', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const stats = makeStats({ taskResults: [
      { id: '001', type: 'backend', status: 'failed', retries: 0 },
      { id: '002', type: 'backend', status: 'failed', retries: 0 },
    ], tasksByType: { backend: 4 }, failsByType: { backend: 2 } });
    const report = await reflect(stats, base);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.experiments.length).toBeGreaterThan(0);
  });

  it('detects consecutive failure chain', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const stats = makeStats({ taskResults: [
      { id: '001', type: 'backend', status: 'failed', retries: 0 },
      { id: '002', type: 'backend', status: 'failed', retries: 0 },
    ] });
    const report = await reflect(stats, base);
    expect(report.findings.some(f => f.includes('连续失败链'))).toBe(true);
  });

  it('detects type failure concentration > 30%', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const stats = makeStats({
      tasksByType: { frontend: 3 }, failsByType: { frontend: 2 },
      taskResults: [],
    });
    const report = await reflect(stats, base);
    expect(report.findings.some(f => f.includes('类型') && f.includes('失败集中'))).toBe(true);
  });

  it('returns empty findings when no failures', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const stats = makeStats({
      failCount: 0, skipCount: 0, retryTotal: 0,
      tasksByType: { backend: 5 }, failsByType: {},
      taskResults: [
        { id: '001', type: 'backend', status: 'done', retries: 0 },
      ],
    });
    const report = await reflect(stats, base);
    expect(report.findings.every(f => !f.includes('失败') && !f.includes('重试热点'))).toBe(true);
  });
});

describe('experiment', () => {
  let base: string;
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'fp-exp-')); });

  it('empty experiments returns empty log', async () => {
    const report: ReflectReport = { timestamp: '', findings: [], experiments: [] };
    const log = await experiment(report, base);
    expect(log.experiments).toEqual([]);
  });

  it('config target modifies known param (maxRetries)', async () => {
    mkdirSync(join(base, '.flowpilot'), { recursive: true });
    writeFileSync(join(base, '.flowpilot', 'config.json'), '{"maxRetries":2}');
    const report: ReflectReport = {
      timestamp: '', findings: [],
      experiments: [{ trigger: 't', observation: 'o', action: '设置 maxRetries 为 5', expected: 'e', target: 'config' }],
    };
    const log = await experiment(report, base);
    const cfg = JSON.parse(readFileSync(join(base, '.flowpilot', 'config.json'), 'utf-8'));
    expect(cfg.maxRetries).toBe(5);
    const snapshot = JSON.parse(readFileSync(log.snapshotFile!, 'utf-8'));
    expect(snapshot.files['.flowpilot/config.json']).toBe('{"maxRetries":2}');
  });

  it('appends experiment log to experiments.json', async () => {
    const report: ReflectReport = {
      timestamp: '', findings: [],
      experiments: [{ trigger: 't', observation: 'o', action: 'noop', expected: 'e', target: 'config' }],
    };
    await experiment(report, base);
    await experiment(report, base);
    const logs = JSON.parse(readFileSync(join(base, '.flowpilot', 'evolution', 'experiments.json'), 'utf-8'));
    expect(logs.length).toBe(2);
  });
});

describe('review', () => {
  let base: string;
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'fp-review-')); });

  it('no history data: all checks pass', async () => {
    const result = await review(base);
    expect(result.rolledBack).toBe(false);
    expect(result.checks.every(c => c.passed)).toBe(true);
  });

  it('metric degradation triggers rollback', async () => {
    const histDir = join(base, '.flowpilot', 'history');
    mkdirSync(histDir, { recursive: true });
    const good: WorkflowStats = makeStats({ totalTasks: 10, failCount: 1, skipCount: 0, retryTotal: 1 });
    const bad: WorkflowStats = makeStats({ totalTasks: 10, failCount: 5, skipCount: 0, retryTotal: 1 });
    writeFileSync(join(histDir, '001.json'), JSON.stringify(good));
    writeFileSync(join(histDir, '002.json'), JSON.stringify(bad));

    const evoDir = join(base, '.flowpilot', 'evolution');
    mkdirSync(evoDir, { recursive: true });
    const configPath = join(base, '.flowpilot', 'config.json');
    mkdirSync(join(base, '.flowpilot'), { recursive: true });
    writeFileSync(configPath, '{"maxRetries":5}');
    const snapshotPath = join(evoDir, 'snapshot-2024-01-01T00-00-00-000Z.json');
    writeFileSync(snapshotPath, JSON.stringify({ timestamp: '', files: { '.flowpilot/config.json': '{"maxRetries":2}' } }));
    const expLog = [{ timestamp: '', snapshotFile: snapshotPath, experiments: [
      { trigger: 't', observation: 'o', action: 'a', expected: 'e', target: 'config' as const, applied: true, snapshotBefore: '{"maxRetries":2}' },
    ] }];
    writeFileSync(join(evoDir, 'experiments.json'), JSON.stringify(expLog));

    const result = await review(base);
    expect(result.rolledBack).toBe(true);
    expect(result.rollbackReason).toBeDefined();
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(cfg.maxRetries).toBe(2);
  });

  it('review rollback keeps compatibility with legacy snapshot config key', async () => {
    const histDir = join(base, '.flowpilot', 'history');
    mkdirSync(histDir, { recursive: true });
    const good: WorkflowStats = makeStats({ totalTasks: 10, failCount: 0, skipCount: 0, retryTotal: 0 });
    const bad: WorkflowStats = makeStats({ totalTasks: 10, failCount: 4, skipCount: 0, retryTotal: 0 });
    writeFileSync(join(histDir, '001.json'), JSON.stringify(good));
    writeFileSync(join(histDir, '002.json'), JSON.stringify(bad));

    const evoDir = join(base, '.flowpilot', 'evolution');
    mkdirSync(evoDir, { recursive: true });
    const configPath = join(base, '.flowpilot', 'config.json');
    mkdirSync(join(base, '.flowpilot'), { recursive: true });
    writeFileSync(configPath, '{"maxRetries":6}');
    const snapshotPath = join(evoDir, 'snapshot-2024-01-01T00-00-00-000Z.json');
    writeFileSync(snapshotPath, JSON.stringify({ timestamp: '', files: { 'config.json': '{"maxRetries":3}' } }));
    writeFileSync(join(evoDir, 'experiments.json'), JSON.stringify([
      { timestamp: '', snapshotFile: snapshotPath, experiments: [] },
    ]));

    const result = await review(base);
    expect(result.rolledBack).toBe(true);
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(cfg.maxRetries).toBe(3);
  });

  it('review rollback restores the latest experiment snapshot when multiple snapshots exist', async () => {
    const histDir = join(base, '.flowpilot', 'history');
    mkdirSync(histDir, { recursive: true });
    const good: WorkflowStats = makeStats({ totalTasks: 10, failCount: 0, skipCount: 0, retryTotal: 0 });
    const bad: WorkflowStats = makeStats({ totalTasks: 10, failCount: 4, skipCount: 0, retryTotal: 0 });
    writeFileSync(join(histDir, '001.json'), JSON.stringify(good));
    writeFileSync(join(histDir, '002.json'), JSON.stringify(bad));

    const evoDir = join(base, '.flowpilot', 'evolution');
    mkdirSync(evoDir, { recursive: true });
    const configPath = join(base, '.flowpilot', 'config.json');
    mkdirSync(join(base, '.flowpilot'), { recursive: true });
    writeFileSync(configPath, '{"maxRetries":9}');

    const olderSnapshotPath = join(evoDir, 'snapshot-2024-01-01T00-00-00-000Z.json');
    writeFileSync(olderSnapshotPath, JSON.stringify({
      timestamp: '',
      files: { '.flowpilot/config.json': '{"maxRetries":2}' },
    }));

    const newerSnapshotPath = join(evoDir, 'snapshot-2024-01-02T00-00-00-000Z.json');
    writeFileSync(newerSnapshotPath, JSON.stringify({
      timestamp: '',
      files: { '.flowpilot/config.json': '{"maxRetries":4}' },
    }));

    writeFileSync(join(evoDir, 'experiments.json'), JSON.stringify([
      { timestamp: '2024-01-01T00:00:00.000Z', snapshotFile: olderSnapshotPath, experiments: [] },
      { timestamp: '2024-01-02T00:00:00.000Z', snapshotFile: newerSnapshotPath, experiments: [] },
    ]));

    const result = await review(base);
    expect(result.rolledBack).toBe(true);
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(cfg.maxRetries).toBe(4);
  });

  it('invalid config.json fails check', async () => {
    mkdirSync(join(base, '.flowpilot'), { recursive: true });
    writeFileSync(join(base, '.flowpilot', 'config.json'), '{broken json!!!');
    const result = await review(base);
    const configCheck = result.checks.find(c => c.name === 'config.json');
    expect(configCheck?.passed).toBe(false);
  });
});
