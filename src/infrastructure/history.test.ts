import { describe, it, expect } from 'vitest';
import { collectStats, analyzeHistory } from './history';
import type { ProgressData, WorkflowStats } from '../domain/types';

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
    failsByType: { frontend: 2 }, startTime: '', endTime: '',
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
