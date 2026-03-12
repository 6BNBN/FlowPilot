import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  classifyResumeDirtyFiles,
  compareDirtyFilesAgainstBaseline,
  getTaskActivationAge,
  isRuntimeLockStale,
  loadActivationState,
  loadDirtyBaseline,
  loadTaskPulseState,
  parseRuntimeLock,
  recordTaskActivations,
  saveDirtyBaseline,
  saveTaskPulseState,
  loadOwnedFiles,
  loadSetupOwnedFiles,
  recordOwnedFiles,
  recordTaskPulse,
  saveSetupOwnedFiles,
  clearTaskPulse,
  collectOwnedFiles,
  loadSetupInjectionManifest,
  mergeSetupInjectionManifest,
  mergeTaskPulsesIntoProgress,
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

  it('recordTaskPulse persists normalized live phase updates by task', async () => {
    const first = await recordTaskPulse(dir, '001', {
      phase: 'analysis',
      updatedAt: '2026-03-12T10:00:00.000Z',
      note: '  正在阅读 README  ',
    });
    await recordTaskPulse(dir, '002', {
      phase: 'blocked',
      updatedAt: '2026-03-12T10:01:00.000Z',
    });

    expect(first).toEqual({
      byTask: {
        '001': {
          phase: 'analysis',
          updatedAt: '2026-03-12T10:00:00.000Z',
          note: '正在阅读 README',
        },
      },
    });
    await expect(loadTaskPulseState(dir)).resolves.toEqual({
      byTask: {
        '001': {
          phase: 'analysis',
          updatedAt: '2026-03-12T10:00:00.000Z',
          note: '正在阅读 README',
        },
        '002': {
          phase: 'blocked',
          updatedAt: '2026-03-12T10:01:00.000Z',
        },
      },
    });
  });

  it('clearTaskPulse removes a single live phase entry and preserves others', async () => {
    await saveTaskPulseState(dir, {
      byTask: {
        '001': {
          phase: 'implementation',
          updatedAt: '2026-03-12T10:00:00.000Z',
          note: '正在改 service',
        },
        '002': {
          phase: 'verification',
          updatedAt: '2026-03-12T10:05:00.000Z',
        },
      },
    });

    const next = await clearTaskPulse(dir, '001');
    expect(next).toEqual({
      byTask: {
        '002': {
          phase: 'verification',
          updatedAt: '2026-03-12T10:05:00.000Z',
        },
      },
    });
    await expect(loadTaskPulseState(dir)).resolves.toEqual(next);
  });

  it('mergeTaskPulsesIntoProgress overlays persisted live state onto matching tasks only', () => {
    const merged = mergeTaskPulsesIntoProgress({
      name: 'demo',
      status: 'running',
      current: '001',
      tasks: [
        {
          id: '001',
          title: '分析需求',
          description: '',
          type: 'backend',
          status: 'active',
          deps: [],
          summary: '',
          retries: 0,
        },
        {
          id: '002',
          title: '写代码',
          description: '',
          type: 'backend',
          status: 'pending',
          deps: [],
          summary: '',
          retries: 0,
        },
      ],
    }, {
      byTask: {
        '001': {
          phase: 'analysis',
          updatedAt: '2026-03-12T10:00:00.000Z',
          note: '正在阅读 README',
        },
      },
    });

    expect(merged.tasks[0]).toMatchObject({
      phase: 'analysis',
      phaseUpdatedAt: '2026-03-12T10:00:00.000Z',
      phaseNote: '正在阅读 README',
    });
    expect(merged.tasks[1]).not.toHaveProperty('phase');
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

  it('classifyResumeDirtyFiles keeps workflow-period changes ambiguous until ownership is explicit', () => {
    expect(classifyResumeDirtyFiles(
      ['src\\feature.ts', './README.md', '.claude/settings.json'],
      ['README.md'],
      ['.claude/settings.json'],
      [],
    )).toEqual({
      currentFiles: ['README.md', 'src/feature.ts'],
      preservedBaselineFiles: ['README.md'],
      taskOwnedResidueFiles: [],
      ambiguousFiles: ['src/feature.ts'],
    });
  });

  it('classifyResumeDirtyFiles separates explicit task-owned residue from ambiguous files', () => {
    expect(classifyResumeDirtyFiles(
      ['src\\feature.ts', 'docs/note.md', './README.md'],
      ['README.md'],
      [],
      ['src/feature.ts'],
    )).toEqual({
      currentFiles: ['README.md', 'docs/note.md', 'src/feature.ts'],
      preservedBaselineFiles: ['README.md'],
      taskOwnedResidueFiles: ['src/feature.ts'],
      ambiguousFiles: ['docs/note.md'],
    });
  });

  it('classifyResumeDirtyFiles keeps deleted-looking paths ambiguous unless ownership is explicit', () => {
    expect(classifyResumeDirtyFiles(
      ['docs/manual.md', 'src/task-owned.ts'],
      [],
      [],
      ['src/task-owned.ts'],
    )).toEqual({
      currentFiles: ['docs/manual.md', 'src/task-owned.ts'],
      preservedBaselineFiles: [],
      taskOwnedResidueFiles: ['src/task-owned.ts'],
      ambiguousFiles: ['docs/manual.md'],
    });
  });
});
