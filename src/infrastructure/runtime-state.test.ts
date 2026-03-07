import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  compareDirtyFilesAgainstBaseline,
  getTaskActivationAge,
  isRuntimeLockStale,
  loadActivationState,
  loadDirtyBaseline,
  parseRuntimeLock,
  recordTaskActivations,
  saveDirtyBaseline,
  loadOwnedFiles,
  loadSetupOwnedFiles,
  recordOwnedFiles,
  saveSetupOwnedFiles,
  collectOwnedFiles,
  loadSetupInjectionManifest,
  mergeSetupInjectionManifest,
} from './runtime-state';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runtime-state-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runtime-state lock metadata', () => {
  it('parseRuntimeLock marks malformed payload as invalid', () => {
    expect(parseRuntimeLock('{bad json')).toEqual({
      valid: false,
      reason: 'invalid-json',
    });
  });

  it('isRuntimeLockStale refuses fresh malformed lock files', () => {
    const result = isRuntimeLockStale({
      parsed: { valid: false, reason: 'invalid-json' },
      fileAgeMs: 1_000,
      staleAfterMs: 30_000,
      isProcessAlive: () => false,
      currentHostname: 'host-a',
    });

    expect(result).toMatchObject({
      stale: false,
      reason: 'invalid-lock-payload',
    });
  });

  it('isRuntimeLockStale refuses reclaim when hostname matches but locality is not provable', () => {
    const parsed = parseRuntimeLock(JSON.stringify({
      pid: 4242,
      hostname: 'host-a',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    }));

    const result = isRuntimeLockStale({
      parsed,
      fileAgeMs: 60_000,
      staleAfterMs: 30_000,
      isProcessAlive: () => false,
      currentHostname: 'host-a',
      currentLocalityToken: 'machine-a',
    });

    expect(result).toMatchObject({
      stale: false,
      reason: 'unverified-locality',
    });
  });
});

describe('runtime-state shared metadata', () => {
  it('mergeSetupInjectionManifest stores exact cleanup ownership details', async () => {
    const first = await mergeSetupInjectionManifest(dir, {
      claudeMd: {
        created: true,
        block: '<!-- flowpilot:start -->\nblock\n<!-- flowpilot:end -->',
        scaffold: '# Project\n\n',
      },
      hooks: {
        created: true,
        preToolUse: [
          { matcher: 'TaskCreate', hooks: [{ type: 'prompt', prompt: 'create hook' }] },
          { matcher: 'TaskUpdate', hooks: [{ type: 'prompt', prompt: 'update hook' }] },
        ],
        settingsBaseline: {
          exists: true,
          rawContent: '{"model":"opus"}\n',
        },
      },
      gitignore: {
        created: false,
        rules: ['.claude/settings.json', '.claude/worktrees/', '.flowpilot/', '.workflow/'],
        baseline: {
          exists: true,
          rawContent: 'node_modules/\n',
        },
      },
    });

    const second = await mergeSetupInjectionManifest(dir, {
      hooks: {
        created: false,
        preToolUse: [
          { matcher: 'TaskList', hooks: [{ type: 'prompt', prompt: 'list hook' }] },
        ],
        settingsBaseline: {
          exists: false,
        },
      },
    });

    expect(first).toEqual({
      claudeMd: {
        created: true,
        block: '<!-- flowpilot:start -->\nblock\n<!-- flowpilot:end -->',
        scaffold: '# Project\n\n',
      },
      hooks: {
        created: true,
        preToolUse: [
          { matcher: 'TaskCreate', hooks: [{ type: 'prompt', prompt: 'create hook' }] },
          { matcher: 'TaskUpdate', hooks: [{ type: 'prompt', prompt: 'update hook' }] },
        ],
        settingsBaseline: {
          exists: true,
          rawContent: '{"model":"opus"}\n',
        },
      },
      gitignore: {
        created: false,
        rules: ['.claude/settings.json', '.claude/worktrees/', '.flowpilot/', '.workflow/'],
        baseline: {
          exists: true,
          rawContent: 'node_modules/\n',
        },
      },
    });
    expect(second).toEqual({
      claudeMd: {
        created: true,
        block: '<!-- flowpilot:start -->\nblock\n<!-- flowpilot:end -->',
        scaffold: '# Project\n\n',
      },
      hooks: {
        created: true,
        preToolUse: [
          { matcher: 'TaskCreate', hooks: [{ type: 'prompt', prompt: 'create hook' }] },
          { matcher: 'TaskList', hooks: [{ type: 'prompt', prompt: 'list hook' }] },
          { matcher: 'TaskUpdate', hooks: [{ type: 'prompt', prompt: 'update hook' }] },
        ],
        settingsBaseline: {
          exists: true,
          rawContent: '{"model":"opus"}\n',
        },
      },
      gitignore: {
        created: false,
        rules: ['.claude/settings.json', '.claude/worktrees/', '.flowpilot/', '.workflow/'],
        baseline: {
          exists: true,
          rawContent: 'node_modules/\n',
        },
      },
    });
    await expect(loadSetupInjectionManifest(dir)).resolves.toEqual(second);
  });

  it('recordOwnedFiles persists normalized checkpoint-owned files by task', async () => {
    const first = await recordOwnedFiles(dir, '001', [
      './src/app.ts',
      'src\\app.ts',
      '/README.md',
      '.workflow/progress.md',
      '.flowpilot/history/latest.json',
      '.claude/settings.json',
    ]);
    await recordOwnedFiles(dir, '002', [
      './docs/guide.md',
      'README.md',
    ]);

    expect(first).toEqual({
      byTask: {
        '001': ['README.md', 'src/app.ts'],
      },
    });
    await expect(loadOwnedFiles(dir)).resolves.toEqual({
      byTask: {
        '001': ['README.md', 'src/app.ts'],
        '002': ['README.md', 'docs/guide.md'],
      },
    });
    expect(collectOwnedFiles(await loadOwnedFiles(dir))).toEqual([
      'README.md',
      'docs/guide.md',
      'src/app.ts',
    ]);
  });

  it('saveSetupOwnedFiles persists explainable setup-owned files separately from checkpoint-owned files', async () => {
    const first = await saveSetupOwnedFiles(dir, [
      'CLAUDE.md',
      './.gitignore',
      '.claude/settings.json',
      '.workflow/progress.md',
    ]);

    expect(first).toEqual({
      files: ['.gitignore', 'CLAUDE.md'],
    });
    await expect(loadSetupOwnedFiles(dir)).resolves.toEqual({
      files: ['.gitignore', 'CLAUDE.md'],
    });
    await expect(loadOwnedFiles(dir)).resolves.toEqual({ byTask: {} });
  });

  it('recordTaskActivations persists activation metadata for later readers', async () => {
    await recordTaskActivations(dir, ['001'], 1_000, 111);
    await recordTaskActivations(dir, ['002'], 4_000, 222);

    expect(await loadActivationState(dir)).toEqual({
      '001': { time: 1_000, pid: 111 },
      '002': { time: 4_000, pid: 222 },
    });
    await expect(getTaskActivationAge(dir, '002', 999, 10_000)).resolves.toBe(6_000);
    await expect(getTaskActivationAge(dir, '002', 222, 10_000)).resolves.toBe(6_000);
  });

  it('loadDirtyBaseline falls back safely when older workflows have no baseline file', async () => {
    await expect(loadDirtyBaseline(dir)).resolves.toBeNull();
  });

  it('saveDirtyBaseline normalizes dirty files and excludes runtime metadata paths', async () => {
    const baseline = await saveDirtyBaseline(
      dir,
      [
        './src/app.ts',
        '.workflow/progress.md',
        'src\\app.ts',
        '/README.md',
        '.flowpilot/config.json',
        '.claude/settings.json',
      ],
      '2026-03-07T00:00:00.000Z',
    );

    expect(baseline).toEqual({
      capturedAt: '2026-03-07T00:00:00.000Z',
      files: ['README.md', 'src/app.ts'],
    });
    await expect(loadDirtyBaseline(dir)).resolves.toEqual(baseline);
  });

  it('compareDirtyFilesAgainstBaseline distinguishes preserved baseline files from interrupted residue', () => {
    expect(compareDirtyFilesAgainstBaseline(
      ['src\\feature.ts', './README.md', '.workflow/progress.md'],
      ['/README.md'],
    )).toEqual({
      currentFiles: ['README.md', 'src/feature.ts'],
      preservedBaselineFiles: ['README.md'],
      newDirtyFiles: ['src/feature.ts'],
    });
  });

  it('compareDirtyFilesAgainstBaseline excludes FlowPilot-managed runtime dirt from both sides', () => {
    expect(compareDirtyFilesAgainstBaseline(
      ['.claude/settings.json', '.workflow/progress.md', 'src\\feature.ts', './README.md'],
      ['.claude/settings.json', '/README.md', '.flowpilot/history/latest.json'],
    )).toEqual({
      currentFiles: ['README.md', 'src/feature.ts'],
      preservedBaselineFiles: ['README.md'],
      newDirtyFiles: ['src/feature.ts'],
    });
  });
});
