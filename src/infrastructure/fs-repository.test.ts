import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, utimes } from 'fs/promises';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir, hostname } from 'os';
import { existsSync } from 'fs';
import { FsWorkflowRepository } from './fs-repository';
import type { ProgressData, WorkflowStats } from '../domain/types';

vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    closeSync: vi.fn(actual.closeSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

let dir: string;
let repo: FsWorkflowRepository;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-test-'));
  repo = new FsWorkflowRepository(dir);
});

afterEach(async () => {
  vi.restoreAllMocks();
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
    expect(await readFile(join(dir, '.flowpilot', 'config.json'), 'utf-8')).toContain('"timeout": 60');
  });

  it('loadConfig 兼容读取旧的 .workflow/config.json 并迁移到 .flowpilot', async () => {
    await mkdir(join(dir, '.workflow'), { recursive: true });
    await writeFile(
      join(dir, '.workflow', 'config.json'),
      JSON.stringify({ verify: { timeout: 30 }, maxRetries: 2 }, null, 2) + '\n',
      'utf-8'
    );

    const cfg = await repo.loadConfig();

    expect(cfg).toEqual({ verify: { timeout: 30 }, maxRetries: 2 });
    expect(await readFile(join(dir, '.flowpilot', 'config.json'), 'utf-8')).toContain('"timeout": 30');
    expect(await readFile(join(dir, '.workflow', 'config.json'), 'utf-8')).toContain('"timeout": 30');
  });

  it('clearAll 不删除持久配置', async () => {
    await repo.saveProgress(makeData());
    await repo.saveConfig({ parallelLimit: 4 });

    await repo.clearAll();

    expect(await repo.loadProgress()).toBeNull();
    expect(await repo.loadConfig()).toEqual({ parallelLimit: 4 });
    expect(existsSync(join(dir, '.flowpilot', 'config.json'))).toBe(true);
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
    await writeFile(join(dir, 'CLAUDE.md'), '# Custom\n\n', 'utf-8');
    await repo.ensureClaudeMd();
    await repo.cleanupInjections();
    const content = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(content).toBe('# Custom\n');
    expect(content).not.toContain('flowpilot:start');
  });

  it('cleanupInjections 在注入块被编辑后保持 CLAUDE.md 不变', async () => {
    await writeFile(join(dir, 'CLAUDE.md'), '# Custom\n\n', 'utf-8');
    await repo.ensureClaudeMd();
    const path = join(dir, 'CLAUDE.md');
    const original = await readFile(path, 'utf-8');
    const edited = original.replace('FlowPilot Workflow Protocol', 'FlowPilot Workflow Protocol (edited)');
    expect(edited).not.toBe(original);
    await writeFile(path, edited, 'utf-8');

    await repo.cleanupInjections();

    expect(await readFile(path, 'utf-8')).toBe(edited);
    expect(await readFile(path, 'utf-8')).toContain('flowpilot:start');
  });

  it('cleanupInjections 在缺少 hook manifest 时保留现有 settings.json', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    const original = JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'TaskCreate', hooks: [{ type: 'prompt', prompt: 'user task create hook' }] },
          { matcher: 'TaskUpdate', hooks: [{ type: 'prompt', prompt: 'user task update hook' }] },
          { matcher: 'TaskList', hooks: [{ type: 'prompt', prompt: 'user task list hook' }] },
        ],
      },
    }, null, 2) + '\n';
    await writeFile(join(dir, '.claude', 'settings.json'), original, 'utf-8');

    await repo.cleanupInjections();

    expect(await readFile(join(dir, '.claude', 'settings.json'), 'utf-8')).toBe(original);
  });

  it('cleanupInjections 不移除 hooks', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'OtherTool', hooks: [{ type: 'prompt', prompt: 'keep me' }] },
        ],
      },
    }, null, 2) + '\n', 'utf-8');
    await repo.ensureHooks();
    await repo.cleanupInjections();
    const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('OtherTool');
  });

  it('cleanupInjections 仅移除完全匹配的 hook 条目并保留同 matcher 的自定义 hook', async () => {
    await repo.ensureHooks();
    const settingsPath = join(dir, '.claude', 'settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.map((entry: { matcher: string; hooks: Array<{ type: string; prompt: string }> }) => (
      entry.matcher === 'TaskCreate'
        ? { matcher: 'TaskCreate', hooks: [{ type: 'prompt', prompt: 'user customized create hook' }] }
        : entry
    ));
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

    await repo.cleanupInjections();

    expect(JSON.parse(await readFile(settingsPath, 'utf-8'))).toEqual({
      hooks: {
        PreToolUse: [
          { matcher: 'TaskCreate', hooks: [{ type: 'prompt', prompt: 'user customized create hook' }] },
        ],
      },
    });
  });

  it('cleanupInjections 删除由 FlowPilot 创建且无用户内容的文件', async () => {
    await repo.ensureClaudeMd();
    await repo.ensureHooks();
    await repo.ensureClaudeWorktreesIgnored();

    await repo.cleanupInjections();

    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);
    expect(existsSync(join(dir, '.claude'))).toBe(false);
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });

  it('cleanupInjections 仅移除预存文件中的 FlowPilot 注入内容', async () => {
    await writeFile(join(dir, 'CLAUDE.md'), '# Custom\n\nKeep me.\n', 'utf-8');
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify({
      model: 'opus',
      hooks: {
        PreToolUse: [
          { matcher: 'OtherTool', hooks: [{ type: 'prompt', prompt: 'keep me' }] },
        ],
      },
    }, null, 2) + '\n', 'utf-8');
    await writeFile(join(dir, '.gitignore'), 'node_modules/\ncustom.log\n', 'utf-8');

    await repo.ensureClaudeMd();
    await repo.ensureHooks();
    await repo.ensureClaudeWorktreesIgnored();
    await repo.cleanupInjections();

    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('# Custom\n\nKeep me.\n');
    expect(JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf-8'))).toEqual({
      model: 'opus',
      hooks: {
        PreToolUse: [
          { matcher: 'OtherTool', hooks: [{ type: 'prompt', prompt: 'keep me' }] },
        ],
      },
    });
    expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('node_modules/\ncustom.log\n');
  });

  it('cleanupInjections 仅在无用户内容时删除 FlowPilot 创建的文件', async () => {
    await repo.ensureClaudeMd();
    await repo.ensureHooks();
    await repo.ensureClaudeWorktreesIgnored();

    await writeFile(join(dir, 'CLAUDE.md'), `${await readFile(join(dir, 'CLAUDE.md'), 'utf-8')}User note\n`, 'utf-8');
    const settingsPath = join(dir, '.claude', 'settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
    await writeFile(settingsPath, JSON.stringify({
      ...settings,
      model: 'sonnet',
      hooks: {
        ...settings.hooks,
        PreToolUse: [
          ...settings.hooks.PreToolUse,
          { matcher: 'OtherTool', hooks: [{ type: 'prompt', prompt: 'user hook' }] },
        ],
      },
    }, null, 2) + '\n', 'utf-8');
    await writeFile(join(dir, '.gitignore'), `${await readFile(join(dir, '.gitignore'), 'utf-8')}dist/\n`, 'utf-8');

    await repo.cleanupInjections();

    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf-8')).toContain('User note');
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf-8')).not.toContain('flowpilot:start');
    expect(JSON.parse(await readFile(settingsPath, 'utf-8'))).toEqual({
      model: 'sonnet',
      hooks: {
        PreToolUse: [
          { matcher: 'OtherTool', hooks: [{ type: 'prompt', prompt: 'user hook' }] },
        ],
      },
    });
    expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('dist/\n');
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

  it('ensureHooks records the earliest exact settings baseline and cleanup compares against it', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    const settingsPath = join(dir, '.claude', 'settings.json');
    const baselineContent = '{"model":"opus","theme":"dark"}\n';
    await writeFile(settingsPath, baselineContent, 'utf-8');

    await repo.ensureHooks();
    await writeFile(settingsPath, JSON.stringify({ model: 'sonnet' }, null, 2) + '\n', 'utf-8');
    await repo.ensureHooks();
    await repo.cleanupInjections();

    expect(await readFile(settingsPath, 'utf-8')).toBe('{\n  "model": "sonnet"\n}\n');
    await expect(repo.doesSettingsResidueMatchBaseline()).resolves.toBe(false);

    await writeFile(settingsPath, baselineContent, 'utf-8');
    await expect(repo.doesSettingsResidueMatchBaseline()).resolves.toBe(true);
  });

  it('lock/unlock 基本流程', async () => {
    await repo.lock();
    await repo.unlock();
    await repo.lock();
    await repo.unlock();
  });

  it('live-owner lock cannot be reclaimed after timeout', async () => {
    const lockDir = join(dir, '.workflow');
    const localityToken = (await readFile('/proc/sys/kernel/random/boot_id', 'utf-8')).trim();
    await mkdir(lockDir, { recursive: true });
    await writeFile(join(lockDir, '.lock'), JSON.stringify({
      pid: process.pid,
      hostname: hostname(),
      localityToken,
      createdAt: new Date().toISOString(),
    }), 'utf-8');

    const otherRepo = new FsWorkflowRepository(dir);
    await expect(otherRepo.lock(10)).rejects.toThrow(/锁.*pid/i);
  });

  it('same-host dead lock without locality proof cannot be reclaimed', async () => {
    const lockDir = join(dir, '.workflow');
    const lockPath = join(lockDir, '.lock');
    await mkdir(lockDir, { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      pid: 999999,
      hostname: hostname(),
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    }), 'utf-8');

    await expect(repo.lock(10)).rejects.toThrow(/安全回收条件|无法获取文件锁/);
    expect(JSON.parse(await readFile(lockPath, 'utf-8'))).toMatchObject({ pid: 999999 });
  });

  it('stale lock with dead PID can be reclaimed when locality is provable', async () => {
    const lockDir = join(dir, '.workflow');
    const localityToken = (await readFile('/proc/sys/kernel/random/boot_id', 'utf-8')).trim();
    await mkdir(lockDir, { recursive: true });
    await writeFile(join(lockDir, '.lock'), JSON.stringify({
      pid: 999999,
      hostname: hostname(),
      localityToken,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    }), 'utf-8');

    await repo.lock(10);

    const payload = JSON.parse(await readFile(join(lockDir, '.lock'), 'utf-8')) as { pid: number; hostname: string; localityToken?: string };
    expect(payload.pid).toBe(process.pid);
    expect(payload.hostname).toBe(hostname());

    await repo.unlock();
  });

  it('malformed lock payload can be treated as stale only after explicit validation failure', async () => {
    const lockDir = join(dir, '.workflow');
    const lockPath = join(lockDir, '.lock');
    await mkdir(lockDir, { recursive: true });
    await writeFile(lockPath, '{bad json', 'utf-8');
    const oldTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, oldTime, oldTime);

    await repo.lock(10);

    const payload = JSON.parse(await readFile(lockPath, 'utf-8')) as { pid: number };
    expect(payload.pid).toBe(process.pid);

    await repo.unlock();
  });

  it('unlock does not remove a lock owned by another PID', async () => {
    const lockDir = join(dir, '.workflow');
    const lockPath = join(lockDir, '.lock');
    await mkdir(lockDir, { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      pid: process.pid + 1000,
      hostname: hostname(),
      createdAt: new Date().toISOString(),
    }), 'utf-8');

    await repo.unlock();

    expect(JSON.parse(await readFile(lockPath, 'utf-8'))).toMatchObject({ pid: process.pid + 1000 });
  });

  it('lock surfaces metadata write failures instead of treating them as contention', async () => {
    const lockPath = join(dir, '.workflow', '.lock');
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('disk full'), { code: 'EIO' });
    });

    await expect(repo.lock(10)).rejects.toThrow(/disk full/);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('lock surfaces close failures and removes the partial lock file', async () => {
    const lockPath = join(dir, '.workflow', '.lock');
    vi.mocked(fs.closeSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('close failed'), { code: 'EIO' });
    });

    await expect(repo.lock(10)).rejects.toThrow(/close failed/);
    expect(existsSync(lockPath)).toBe(false);
  });
});
