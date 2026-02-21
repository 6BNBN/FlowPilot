import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { FsWorkflowRepository } from './fs-repository';
import type { ProgressData, WorkflowStats } from '../domain/types';

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

  it('config 读写', async () => {
    expect(await repo.loadConfig()).toEqual({});
    await repo.saveConfig({ verify: { timeout: 60 } });
    const cfg = await repo.loadConfig();
    expect(cfg.verify).toEqual({ timeout: 60 });
  });

  it('clearContext 清理 context 目录', async () => {
    await repo.saveTaskContext('001', 'data');
    await repo.clearContext();
    expect(await repo.loadTaskContext('001')).toBeNull();
  });

  it('clearAll 清理整个 .workflow 目录', async () => {
    await repo.saveProgress(makeData());
    await repo.clearAll();
    expect(await repo.loadProgress()).toBeNull();
  });

  it('cleanupInjections 移除 CLAUDE.md 协议块', async () => {
    await repo.ensureClaudeMd();
    await repo.cleanupInjections();
    const content = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(content).not.toContain('flowpilot:start');
  });

  it('cleanupInjections 移除 hooks', async () => {
    await repo.ensureHooks();
    await repo.cleanupInjections();
    const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks?.PreToolUse).toBeUndefined();
  });

  it('history 保存和加载', async () => {
    const stats: WorkflowStats = {
      name: 'test', totalTasks: 3, doneCount: 2, skipCount: 1, failCount: 0,
      retryTotal: 0, tasksByType: { backend: 3 }, failsByType: {},
      startTime: '', endTime: new Date().toISOString(),
    };
    await repo.saveHistory(stats);
    const loaded = await repo.loadHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('test');
  });

  it('ensureHooks 写入 settings.json', async () => {
    const wrote = await repo.ensureHooks();
    expect(wrote).toBe(true);
    const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(3);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('TaskCreate');
  });

  it('lock/unlock 基本流程', async () => {
    await repo.lock();
    await repo.unlock();
    // 解锁后可以再次获取锁
    await repo.lock();
    await repo.unlock();
  });
});
