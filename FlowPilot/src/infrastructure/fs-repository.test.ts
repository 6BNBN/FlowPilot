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

  it('ensureClaudeWorktreesIgnored 创建缺失的 .gitignore', async () => {
    const changed = await repo.ensureClaudeWorktreesIgnored();

    expect(changed).toBe(true);
    expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('.claude/worktrees/\n');
  });

  it('ensureClaudeWorktreesIgnored 追加规则且不覆盖原内容', async () => {
    await writeFile(join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');

    const changed = await repo.ensureClaudeWorktreesIgnored();

    expect(changed).toBe(true);
    expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('node_modules/\n.claude/worktrees/\n');
  });

  it('ensureClaudeWorktreesIgnored 在无尾换行时正确追加', async () => {
    await writeFile(join(dir, '.gitignore'), 'node_modules/', 'utf-8');

    const changed = await repo.ensureClaudeWorktreesIgnored();

    expect(changed).toBe(true);
    expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('node_modules/\n.claude/worktrees/\n');
  });

  it('ensureClaudeWorktreesIgnored 幂等且不重复追加规则', async () => {
    await writeFile(join(dir, '.gitignore'), 'node_modules/\n.claude/worktrees/\n', 'utf-8');

    const changed = await repo.ensureClaudeWorktreesIgnored();

    expect(changed).toBe(false);
    expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('node_modules/\n.claude/worktrees/\n');
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

  it('cleanupInjections 不移除 hooks', async () => {
    await repo.ensureHooks();
    await repo.cleanupInjections();
    const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(3);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('TaskCreate');
  });

  it('history 保存和加载', async () => {
    const stats: WorkflowStats = {
      name: 'test', totalTasks: 3, doneCount: 2, skipCount: 1, failCount: 0,
      retryTotal: 0, tasksByType: { backend: 3 }, failsByType: {},
      taskResults: [], startTime: '', endTime: new Date().toISOString(),
    };
    await repo.saveHistory(stats);
    const loaded = await repo.loadHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('test');
  });

  it('ensureHooks 写入 settings.json', async () => {
    const wrote = await repo.ensureHooks();
    expect(wrote).toBe(true);
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);
    const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(3);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('TaskCreate');
  });

  it('ensureHooks 幂等追加 hooks', async () => {
    await repo.ensureHooks();
    const wrote = await repo.ensureHooks();
    expect(wrote).toBe(false);
    const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(3);
  });

  it('ensureHooks 保留已有配置并仅补齐缺失 hooks', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify({
      model: 'opus',
      hooks: {
        PreToolUse: [
          { matcher: 'TaskCreate', hooks: [{ type: 'prompt', prompt: 'existing task create hook' }] },
          { matcher: 'OtherTool', hooks: [{ type: 'prompt', prompt: 'keep me' }] },
        ],
      },
    }, null, 2), 'utf-8');

    const wrote = await repo.ensureHooks();
    expect(wrote).toBe(true);

    const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf-8'));
    const preToolUse = settings.hooks.PreToolUse as Array<{ matcher: string }>;
    expect(settings.model).toBe('opus');
    expect(preToolUse.map(entry => entry.matcher)).toEqual(['TaskCreate', 'OtherTool', 'TaskUpdate', 'TaskList']);
    expect(preToolUse.filter(entry => entry.matcher === 'TaskCreate')).toHaveLength(1);
  });

  it('lock/unlock 基本流程', async () => {
    await repo.lock();
    await repo.unlock();
    // 解锁后可以再次获取锁
    await repo.lock();
    await repo.unlock();
  });
});
