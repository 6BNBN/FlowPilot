import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { detect, loadWindow } from './loop-detector';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loop-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('repeatedNoProgress', () => {
  it('detects 3 consecutive similar failures', async () => {
    // Jaccard needs >0.8 for all pairs: use nearly identical long strings
    await detect(dir, '001', 'build failed cannot find module react dom render', true);
    await detect(dir, '001', 'build failed cannot find module react dom render', true);
    const result = await detect(dir, '001', 'build failed cannot find module react dom render', true);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('repeatedNoProgress');
    expect(result!.stuck).toBe(true);
  });

  it('no detection with < 3 failures', async () => {
    await detect(dir, '001', 'build failed', true);
    const result = await detect(dir, '001', 'build failed again', true);
    expect(result).toBeNull();
  });
});

describe('pingPong', () => {
  it('detects A-B-A-B alternating failures', async () => {
    await detect(dir, '001', 'fail A', true);
    await detect(dir, '002', 'fail B', true);
    await detect(dir, '001', 'fail A again', true);
    const result = await detect(dir, '002', 'fail B again', true);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('pingPong');
  });
});

describe('globalCircuitBreaker', () => {
  it('detects high failure rate (>60%) in window', async () => {
    // 5 failures, 0 successes = 100% fail rate
    for (let i = 0; i < 5; i++) {
      await detect(dir, `t${i}`, `different fail ${i}`, true);
    }
    const window = await loadWindow(dir);
    expect(window.length).toBe(5);
    // The 5th detect should have triggered globalCircuitBreaker
    // Let's add one more to check
    const result = await detect(dir, 't5', 'another different fail', true);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('globalCircuitBreaker');
  });
});

describe('no false positives', () => {
  it('success checkpoints do not trigger detection', async () => {
    for (let i = 0; i < 10; i++) {
      const result = await detect(dir, `t${i}`, `completed task ${i}`, false);
      expect(result).toBeNull();
    }
  });

  it('mixed success/fail below threshold is fine', async () => {
    // 3 success + 2 fail = 40% fail rate, below 60%
    await detect(dir, 't1', 'ok1', false);
    await detect(dir, 't2', 'fail1', true);
    await detect(dir, 't3', 'ok2', false);
    await detect(dir, 't4', 'ok3', false);
    const result = await detect(dir, 't5', 'fail2', true);
    expect(result).toBeNull();
  });
});
