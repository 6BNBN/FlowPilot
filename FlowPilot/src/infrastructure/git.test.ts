import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { __testables, autoCommit, listChangedFiles } from './git';
import { FsWorkflowRepository } from './fs-repository';

describe('git runtime path filtering', () => {
  it('filters FlowPilot runtime artifacts from commit files', () => {
    expect(__testables.filterCommitFiles([
      './src/main.ts',
      '.workflow/progress.md',
      '.flowpilot/history/2026-01-01.json',
      '.claude/settings.json',
      'src/main.ts',
      'docs/readme.md',
    ])).toEqual(['src/main.ts', 'docs/readme.md']);
  });

  it('detects runtime paths after normalization', () => {
    expect(__testables.isFlowPilotRuntimePath('./.workflow/tasks.md')).toBe(true);
    expect(__testables.isFlowPilotRuntimePath('\\.flowpilot\\memory.json')).toBe(true);
    expect(__testables.isFlowPilotRuntimePath('./.claude/settings.json')).toBe(true);
    expect(__testables.isFlowPilotRuntimePath('src/app.ts')).toBe(false);
  });

  it('returns skipped/no-files when files are omitted', () => {
    expect(autoCommit('001', 'test', 'summary')).toEqual({ status: 'skipped', reason: 'no-files' });
  });

  it('returns skipped/no-files when files list is empty', () => {
    expect(autoCommit('001', 'test', 'summary', [])).toEqual({ status: 'skipped', reason: 'no-files' });
  });

  it('returns skipped/runtime-only when only runtime files are provided', () => {
    expect(autoCommit('001', 'test', 'summary', [
      '.workflow/progress.md',
      '.flowpilot/history/run.json',
      '.claude/settings.json',
    ])).toEqual({ status: 'skipped', reason: 'runtime-only' });
  });

  it('returns skipped/no-staged-changes for a real tracked file in a temp repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-git-autocommit-'));
    const trackedFile = 'tracked.txt';

    try {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'FlowPilot Test'], { cwd: dir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'flowpilot@example.com'], { cwd: dir, stdio: 'pipe' });

      await writeFile(join(dir, trackedFile), 'base\n', 'utf-8');
      execFileSync('git', ['add', '--', trackedFile], { cwd: dir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });

      expect(autoCommit('001', 'test', 'summary', [trackedFile], dir)).toEqual({
        status: 'skipped',
        reason: 'no-staged-changes',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('collects staged, unstaged and untracked business files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-git-'));

    try {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'FlowPilot Test'], { cwd: dir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'flowpilot@example.com'], { cwd: dir, stdio: 'pipe' });

      await writeFile(join(dir, 'tracked.txt'), 'base\n', 'utf-8');
      await writeFile(join(dir, 'staged.txt'), 'base\n', 'utf-8');
      execFileSync('git', ['add', '--', 'tracked.txt', 'staged.txt'], { cwd: dir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });

      await writeFile(join(dir, 'tracked.txt'), 'base\nchanged\n', 'utf-8');
      await writeFile(join(dir, 'staged.txt'), 'base\nstaged\n', 'utf-8');
      await writeFile(join(dir, 'untracked.txt'), 'new\n', 'utf-8');
      execFileSync('git', ['add', '--', 'staged.txt'], { cwd: dir, stdio: 'pipe' });

      expect(listChangedFiles(dir)).toEqual(['staged.txt', 'tracked.txt', 'untracked.txt']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('collects dirty submodule files so finish can pass real changed files to commit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-git-submodule-'));
    const rootDir = join(dir, 'root');
    const submoduleSourceDir = join(dir, 'submodule-source');
    const submodulePath = join(rootDir, 'vendor', 'lib');
    const trackedFile = 'tracked.txt';

    try {
      await mkdir(rootDir, { recursive: true });
      await mkdir(submoduleSourceDir, { recursive: true });

      execFileSync('git', ['init'], { cwd: submoduleSourceDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'FlowPilot Test'], { cwd: submoduleSourceDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'flowpilot@example.com'], { cwd: submoduleSourceDir, stdio: 'pipe' });
      await writeFile(join(submoduleSourceDir, trackedFile), 'base\n', 'utf-8');
      execFileSync('git', ['add', '--', trackedFile], { cwd: submoduleSourceDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'init submodule'], { cwd: submoduleSourceDir, stdio: 'pipe' });

      execFileSync('git', ['init'], { cwd: rootDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'FlowPilot Test'], { cwd: rootDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'flowpilot@example.com'], { cwd: rootDir, stdio: 'pipe' });
      execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', submoduleSourceDir, 'vendor/lib'], { cwd: rootDir, stdio: 'pipe' });
      execFileSync('git', ['add', '--', '.'], { cwd: rootDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'init root'], { cwd: rootDir, stdio: 'pipe' });

      await writeFile(join(submodulePath, trackedFile), 'base\nchanged\n', 'utf-8');

      const repo = new FsWorkflowRepository(rootDir);
      expect(repo.listChangedFiles()).toEqual(['vendor/lib/tracked.txt']);
      expect(listChangedFiles(rootDir)).toEqual(['vendor/lib/tracked.txt']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns the submodule path when only the gitlink changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-git-submodule-gitlink-'));
    const rootDir = join(dir, 'root');
    const submoduleSourceDir = join(dir, 'submodule-source');
    const submodulePath = join(rootDir, 'vendor', 'lib');
    const trackedFile = 'tracked.txt';

    try {
      await mkdir(rootDir, { recursive: true });
      await mkdir(submoduleSourceDir, { recursive: true });

      execFileSync('git', ['init'], { cwd: submoduleSourceDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'FlowPilot Test'], { cwd: submoduleSourceDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'flowpilot@example.com'], { cwd: submoduleSourceDir, stdio: 'pipe' });
      await writeFile(join(submoduleSourceDir, trackedFile), 'base\n', 'utf-8');
      execFileSync('git', ['add', '--', trackedFile], { cwd: submoduleSourceDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'init submodule'], { cwd: submoduleSourceDir, stdio: 'pipe' });

      execFileSync('git', ['init'], { cwd: rootDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'FlowPilot Test'], { cwd: rootDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'flowpilot@example.com'], { cwd: rootDir, stdio: 'pipe' });
      execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', submoduleSourceDir, 'vendor/lib'], { cwd: rootDir, stdio: 'pipe' });
      execFileSync('git', ['add', '--', '.'], { cwd: rootDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'init root'], { cwd: rootDir, stdio: 'pipe' });

      execFileSync('git', ['config', 'user.name', 'FlowPilot Test'], { cwd: submodulePath, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'flowpilot@example.com'], { cwd: submodulePath, stdio: 'pipe' });
      await writeFile(join(submodulePath, trackedFile), 'base\nadvanced\n', 'utf-8');
      execFileSync('git', ['add', '--', trackedFile], { cwd: submodulePath, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'advance submodule'], { cwd: submodulePath, stdio: 'pipe' });

      const repo = new FsWorkflowRepository(rootDir);
      expect(repo.listChangedFiles()).toEqual(['vendor/lib']);
      expect(listChangedFiles(rootDir)).toEqual(['vendor/lib']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses repository base for tag rollback and cleanTags when process cwd differs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-git-tag-cwd-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'flow-git-outside-'));

    try {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'FlowPilot Test'], { cwd: dir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'flowpilot@example.com'], { cwd: dir, stdio: 'pipe' });

      await writeFile(join(dir, 'tracked.txt'), 'base\n', 'utf-8');
      execFileSync('git', ['add', '--', 'tracked.txt'], { cwd: dir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(outsideDir);
      try {
        const repo = new FsWorkflowRepository(dir);
        expect(repo.tag('009')).toBeNull();
        expect(execFileSync('git', ['tag', '--list', 'flowpilot/task-009'], { cwd: dir, stdio: 'pipe', encoding: 'utf-8' }).trim()).toBe('flowpilot/task-009');

        await writeFile(join(dir, 'tracked.txt'), 'base\nchanged\n', 'utf-8');
        execFileSync('git', ['add', '--', 'tracked.txt'], { cwd: dir, stdio: 'pipe' });
        execFileSync('git', ['commit', '-m', 'change'], { cwd: dir, stdio: 'pipe' });

        expect(repo.rollback('009')).toBeNull();
        expect(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: dir, stdio: 'pipe', encoding: 'utf-8' }).trim()).toBe('rollback: revert to task-009');
        expect((await readFile(join(dir, 'tracked.txt'), 'utf-8'))).toBe('base\n');

        repo.cleanTags();
        expect(execFileSync('git', ['tag', '--list', 'flowpilot/*'], { cwd: dir, stdio: 'pipe', encoding: 'utf-8' }).trim()).toBe('');
      } finally {
        cwdSpy.mockRestore();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
