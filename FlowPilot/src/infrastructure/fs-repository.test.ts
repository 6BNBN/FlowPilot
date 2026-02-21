import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FsWorkflowRepository } from './fs-repository';
import type { ProgressData } from '../domain/types';

let dir: string;
let repo: FsWorkflowRepository;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-test-'));
  repo = new FsWorkflowRepository(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeData(): ProgressData {
  return {
    name: '测试项目', status: 'running', current: '001',
    tasks: [
      { id: '001', title: '设计数据库', description: '用PostgreSQL', type: 'backend', status: 'active', deps: [], summary: '', retries: 0 },
      { id: '002', title: '创建页面', description: '', type: 'frontend', status: 'pending', deps: ['001'], summary: '', retries: 0 },
    ],
  };
}

describe('FsWorkflowRepository', () => {
  it('progress.md 往返一致', async () => {
    const data = makeData();
    await repo.saveProgress(data);
    const loaded = await repo.loadProgress();
    expect(loaded?.name).toBe('测试项目');
    expect(loaded?.status).toBe('running');
    expect(loaded?.tasks).toHaveLength(2);
    expect(loaded?.tasks[0].id).toBe('001');
    expect(loaded?.tasks[0].deps).toEqual([]);
    expect(loaded?.tasks[1].deps).toEqual(['001']);
  });

  it('无文件时loadProgress返回null', async () => {
    expect(await repo.loadProgress()).toBeNull();
  });

  it('taskContext 读写', async () => {
    await repo.saveTaskContext('001', '# 产出\n详细内容');
    expect(await repo.loadTaskContext('001')).toBe('# 产出\n详细内容');
    expect(await repo.loadTaskContext('999')).toBeNull();
  });

  it('summary 读写', async () => {
    await repo.saveSummary('# 摘要');
    expect(await repo.loadSummary()).toBe('# 摘要');
  });

  it('ensureClaudeMd 首次创建', async () => {
    const wrote = await repo.ensureClaudeMd();
    expect(wrote).toBe(true);
    const content = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('flowpilot:start');
  });

  it('ensureClaudeMd 幂等', async () => {
    await repo.ensureClaudeMd();
    const wrote = await repo.ensureClaudeMd();
    expect(wrote).toBe(false);
  });
});
