import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ProgressData } from '../domain/types';
import type { CheckpointRecord } from './loop-detector';
import { FsWorkflowRepository } from './fs-repository';
import { runHeartbeat } from './heartbeat';
import { recordTaskActivations } from './runtime-state';

let dir: string;
let repo: FsWorkflowRepository;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'heartbeat-test-'));
  repo = new FsWorkflowRepository(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeData(activeIds: string[] = ['001']): ProgressData {
  return {
    name: '测试项目',
    status: 'running',
    current: '001',
    tasks: [
      {
        id: '001',
        title: '修复解析',
        description: '让 heartbeat 读取真实进度源',
        type: 'backend',
        status: activeIds.includes('001') ? 'active' : 'pending',
        deps: [],
        summary: '',
        retries: 0,
      },
      {
        id: '002',
        title: '补充测试',
        description: '',
        type: 'backend',
        status: activeIds.includes('002') ? 'active' : 'pending',
        deps: ['001'],
        summary: '',
        retries: 0,
      },
    ],
  };
}

describe('runHeartbeat', () => {
  it('在首个活跃任务还没有 loop history 时优先使用 activation metadata 判定超时', async () => {
    const now = Date.now();
    await repo.saveProgress(makeData());
    await recordTaskActivations(dir, ['001'], now - 31 * 60 * 1000, 111);

    const result = await runHeartbeat(dir);

    expect(result.warnings).toEqual([
      '[TIMEOUT] 任务 001 超过30分钟无checkpoint',
    ]);
    expect(result.actions).toEqual([]);
  });

  it('多个活跃任务时只警告真正过期的 activation metadata', async () => {
    const now = Date.now();
    await repo.saveProgress(makeData(['001', '002']));
    await recordTaskActivations(dir, ['001'], now - 31 * 60 * 1000, 111);
    await recordTaskActivations(dir, ['002'], now - 10 * 60 * 1000, 222);

    const result = await runHeartbeat(dir);

    expect(result.warnings).toEqual([
      '[TIMEOUT] 任务 001 超过30分钟无checkpoint',
    ]);
    expect(result.actions).toEqual([]);
  });

  it('缺少 activation metadata 时仍回退到 loop history 判定超时', async () => {
    await repo.saveProgress(makeData());
    await mkdir(join(dir, '.workflow'), { recursive: true });

    const window: CheckpointRecord[] = [
      {
        taskId: '001',
        summary: 'still working',
        status: 'done',
        hash: 1,
        timestamp: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      },
    ];
    await writeFile(join(dir, '.workflow', 'loop-state.json'), JSON.stringify(window), 'utf-8');

    const result = await runHeartbeat(dir);

    expect(result.warnings).toEqual([
      '[TIMEOUT] 任务 001 超过30分钟无checkpoint',
    ]);
    expect(result.actions).toEqual([]);
  });

  it('stale loop history + fresh activation 时不应误报超时', async () => {
    const now = Date.now();
    await repo.saveProgress(makeData());
    await recordTaskActivations(dir, ['001'], now - 10 * 60 * 1000, 111);
    await mkdir(join(dir, '.workflow'), { recursive: true });

    const window: CheckpointRecord[] = [
      {
        taskId: '001',
        summary: 'old checkpoint',
        status: 'done',
        hash: 1,
        timestamp: new Date(now - 31 * 60 * 1000).toISOString(),
      },
    ];
    await writeFile(join(dir, '.workflow', 'loop-state.json'), JSON.stringify(window), 'utf-8');

    const result = await runHeartbeat(dir);

    expect(result.warnings).toEqual([]);
    expect(result.actions).toEqual([]);
  });

  it('fresh loop history + stale activation 时仍应按 activation metadata 报警', async () => {
    const now = Date.now();
    await repo.saveProgress(makeData());
    await recordTaskActivations(dir, ['001'], now - 31 * 60 * 1000, 111);
    await mkdir(join(dir, '.workflow'), { recursive: true });

    const window: CheckpointRecord[] = [
      {
        taskId: '001',
        summary: 'recent checkpoint',
        status: 'done',
        hash: 1,
        timestamp: new Date(now - 10 * 60 * 1000).toISOString(),
      },
    ];
    await writeFile(join(dir, '.workflow', 'loop-state.json'), JSON.stringify(window), 'utf-8');

    const result = await runHeartbeat(dir);

    expect(result.warnings).toEqual([
      '[TIMEOUT] 任务 001 超过30分钟无checkpoint',
    ]);
    expect(result.actions).toEqual([]);
  });
});
