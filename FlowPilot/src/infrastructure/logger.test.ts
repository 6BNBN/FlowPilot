import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { log, configureLogger, setWorkflowName, exportTrace, exportTaskTrace } from './logger';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'log-test-'));
  configureLogger(dir);
  setWorkflowName('test-wf');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  configureLogger('');
  setWorkflowName('');
});

describe('logger.step', () => {
  it('persists structured log entry to JSONL', () => {
    log.step('task_started', 'starting task', { taskId: '001' });
    const entries = exportTrace('test-wf');
    expect(entries).toHaveLength(1);
    expect(entries[0].step).toBe('task_started');
    expect(entries[0].message).toBe('starting task');
    expect(entries[0].taskId).toBe('001');
  });

  it('includes optional fields when provided', () => {
    log.step('task_completed', 'done', { taskId: '002', durationMs: 500, data: { key: 'val' } });
    const entries = exportTrace('test-wf');
    expect(entries[0].durationMs).toBe(500);
    expect(entries[0].data).toEqual({ key: 'val' });
  });

  it('defaults level to info', () => {
    log.step('workflow_init', 'init');
    const entries = exportTrace('test-wf');
    expect(entries[0].level).toBe('info');
  });
});

describe('JSONL persistence', () => {
  it('multiple steps append to same file', () => {
    log.step('task_started', 'a', { taskId: '001' });
    log.step('task_completed', 'b', { taskId: '001' });
    const entries = exportTrace('test-wf');
    expect(entries).toHaveLength(2);
    expect(entries[0].step).toBe('task_started');
    expect(entries[1].step).toBe('task_completed');
  });
});

describe('exportTrace / exportTaskTrace', () => {
  it('exportTrace returns empty for nonexistent workflow', () => {
    expect(exportTrace('nonexistent')).toEqual([]);
  });

  it('exportTaskTrace filters by taskId', () => {
    log.step('task_started', 'a', { taskId: '001' });
    log.step('task_started', 'b', { taskId: '002' });
    log.step('task_completed', 'c', { taskId: '001' });
    const trace = exportTaskTrace('001');
    expect(trace).toHaveLength(2);
    expect(trace.every(e => e.taskId === '001')).toBe(true);
  });
});
