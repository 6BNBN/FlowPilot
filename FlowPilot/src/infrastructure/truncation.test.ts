import { describe, it, expect } from 'vitest';
import { estimateCharsPerToken, truncateHeadTail, computeMaxChars } from './truncation';

describe('estimateCharsPerToken', () => {
  it('pure CJK ≈ 1.5', () => {
    const r = estimateCharsPerToken('数据库设计方案确定使用关系型数据库');
    expect(r).toBeCloseTo(1.5, 1);
  });

  it('pure English ≈ 3.5', () => {
    const r = estimateCharsPerToken('PostgreSQL database schema design patterns guide');
    expect(r).toBeCloseTo(3.5, 1);
  });

  it('mixed text between 1.5 and 3.5', () => {
    const r = estimateCharsPerToken('PostgreSQL数据库设计React组件模式');
    expect(r).toBeGreaterThan(1.5);
    expect(r).toBeLessThan(3.5);
  });
});

describe('truncateHeadTail', () => {
  it('short text returned as-is', () => {
    expect(truncateHeadTail('hello', 100)).toBe('hello');
  });

  it('long text preserves head + tail with truncation marker', () => {
    const text = 'A'.repeat(100);
    const result = truncateHeadTail(text, 50);
    expect(result).toContain('[...truncated');
    expect(result.startsWith('A')).toBe(true);
    expect(result.endsWith('A')).toBe(true);
  });

  it('head is ~70% and tail is ~20% of maxChars', () => {
    const text = 'X'.repeat(200);
    const result = truncateHeadTail(text, 100);
    const head = result.split('\n\n[...truncated')[0];
    const tail = result.split('...]\n\n')[1];
    expect(head.length).toBe(70);
    expect(tail.length).toBe(20);
  });
});

describe('computeMaxChars', () => {
  it('default params: 128k * 0.3 * 3.5', () => {
    expect(computeMaxChars()).toBe(Math.floor(128_000 * 0.3 * 3.5));
  });

  it('custom contextWindow', () => {
    expect(computeMaxChars(64_000)).toBe(Math.floor(64_000 * 0.3 * 3.5));
  });

  it('with CJK sample uses lower charsPerToken', () => {
    const cjk = computeMaxChars(128_000, '数据库设计方案');
    const latin = computeMaxChars(128_000, 'database schema design');
    expect(cjk).toBeLessThan(latin);
  });
});
