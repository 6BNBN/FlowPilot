/**
 * @module e2e/operational-readiness
 * @description operational readiness smoke tests for clean, dirty, resume, and submodule flows
 */

import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FLOW_CLI = '/home/zzz/桌面/2026开发/tools/FlowPilot/dist/flow.js';
const TASK_MARKDOWN = `# Clean Repo Smoke\n\n1. [backend] add tracked file\n  create one tracked file in a clean repo\n`;
const SUBMODULE_TASK_MARKDOWN = `# Submodule Smoke\n\n1. [backend] advance submodule gitlink\n  advance a submodule commit and checkpoint the gitlink path\n`;

function runGit(repoDir: string, args: string[], encoding: 'utf-8' | 'buffer' = 'utf-8'): string {
  return execFileSync('git', args, {
    cwd: repoDir,
    encoding,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString().trim();
}

function initGitRepo(repoDir: string): void {
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'FlowPilot Test'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'flowpilot@example.com'], { cwd: repoDir, stdio: 'pipe' });
}

function runFlow(repoDir: string, args: string[], input?: string): string {
  return execFileSync('node', [FLOW_CLI, ...args], {
    cwd: repoDir,
    input,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('operational readiness smoke tests', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('runs init -> next/checkpoint -> review -> finish and commits only workflow-owned files', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'flow-operational-smoke-'));
    tempDirs.push(repoDir);

    initGitRepo(repoDir);

    const initOutput = runFlow(repoDir, ['init'], TASK_MARKDOWN);
    expect(initOutput).toContain('已初始化工作流: Clean Repo Smoke (1 个任务)');

    const nextOutput = runFlow(repoDir, ['next']);
    expect(nextOutput).toContain('--- 任务 001 ---');

    await writeFile(join(repoDir, 'app.txt'), 'hello smoke\n', 'utf-8');

    const checkpointOutput = runFlow(
      repoDir,
      ['checkpoint', '001', '--files', 'app.txt'],
      '[REMEMBER] clean repo smoke writes exactly one tracked file',
    );

    expect(checkpointOutput).toContain('任务 001 完成 (1/1)');
    expect(checkpointOutput).toContain('全部任务已完成，请执行 node flow.js finish 进行收尾');
    expect(checkpointOutput).toContain('[已自动提交]');

    const reviewOutput = runFlow(repoDir, ['review']);
    expect(reviewOutput).toContain('代码审查已通过，请执行 node flow.js finish 完成收尾');

    const finishOutput = runFlow(repoDir, ['finish']);
    expect(finishOutput).toContain('验证结果: 未发现可执行的验证命令');
    expect(finishOutput).toContain('1 done');
    expect(finishOutput).toContain('未提交最终commit');
    expect(finishOutput).toContain('工作流回到待命状态');
    expect(finishOutput).toContain('等待下一个需求');

    await expect(access(join(repoDir, '.workflow'))).rejects.toThrow();
    await expect(access(join(repoDir, '.gitignore'))).rejects.toThrow();
    await expect(access(join(repoDir, '.claude'))).rejects.toThrow();
    await expect(access(join(repoDir, '.claude', 'settings.json'))).rejects.toThrow();
    await expect(access(join(repoDir, 'CLAUDE.md'))).rejects.toThrow();

    const status = runGit(repoDir, ['status', '--short']).split('\n').filter(Boolean);
    expect(status).toEqual(['?? .flowpilot/']);

    const flowpilotEntries = (await readdir(join(repoDir, '.flowpilot'))).sort();
    expect(flowpilotEntries).toContain('history');
    expect(flowpilotEntries).not.toContain('.workflow');
    expect((await readdir(join(repoDir, '.flowpilot', 'history'))).length).toBe(1);

    const commitCount = runGit(repoDir, ['rev-list', '--count', 'HEAD']);
    expect(commitCount).toBe('1');

    const committedFiles = runGit(repoDir, ['show', '--pretty=', '--name-only', 'HEAD']).split('\n').filter(Boolean);
    expect(committedFiles).toEqual(['app.txt']);

    expect((await stat(join(repoDir, 'app.txt'))).isFile()).toBe(true);
    expect(await readFile(join(repoDir, 'app.txt'), 'utf-8')).toBe('hello smoke\n');
  });

  it('refuses finish in a dirty-start repo when unexplained dirty files cross the workflow boundary', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'flow-operational-dirty-start-'));
    tempDirs.push(repoDir);

    initGitRepo(repoDir);
    await writeFile(join(repoDir, 'baseline.txt'), 'baseline\n', 'utf-8');
    execFileSync('git', ['add', '--', 'baseline.txt'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init baseline'], { cwd: repoDir, stdio: 'pipe' });
    await writeFile(join(repoDir, 'baseline.txt'), 'baseline\ndirty before init\n', 'utf-8');

    const initOutput = runFlow(repoDir, ['init'], TASK_MARKDOWN);
    expect(initOutput).toContain('已初始化工作流: Clean Repo Smoke (1 个任务)');

    runFlow(repoDir, ['next']);
    await writeFile(join(repoDir, 'app.txt'), 'hello smoke\n', 'utf-8');

    const checkpointOutput = runFlow(
      repoDir,
      ['checkpoint', '001', '--files', 'app.txt'],
      '[REMEMBER] dirty-start smoke commits only checkpoint-owned files',
    );
    expect(checkpointOutput).toContain('[已自动提交]');

    const reviewOutput = runFlow(repoDir, ['review']);
    expect(reviewOutput).toContain('代码审查已通过，请执行 node flow.js finish 完成收尾');

    await writeFile(join(repoDir, 'rogue.txt'), 'outside workflow boundary\n', 'utf-8');

    const finishOutput = runFlow(repoDir, ['finish']);
    expect(finishOutput).toContain('验证结果: 未发现可执行的验证命令');
    expect(finishOutput).toContain('1 done');
    expect(finishOutput).toContain('拒绝最终提交：检测到未归属给 workflow checkpoint 的脏文件。');
    expect(finishOutput).toContain('- rogue.txt');

    const statusOutput = runGit(repoDir, ['status', '--short']);
    expect(statusOutput).toContain('?? rogue.txt');
    expect(statusOutput).toContain('M baseline.txt');
  });

  it('resume preserves dirty baseline and interrupted residue with truthful messaging', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'flow-operational-resume-dirty-'));
    tempDirs.push(repoDir);

    initGitRepo(repoDir);
    await writeFile(join(repoDir, 'baseline.txt'), 'baseline\n', 'utf-8');
    execFileSync('git', ['add', '--', 'baseline.txt'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init baseline'], { cwd: repoDir, stdio: 'pipe' });
    await writeFile(join(repoDir, 'baseline.txt'), 'baseline\ndirty before init\n', 'utf-8');

    const initOutput = runFlow(repoDir, ['init'], TASK_MARKDOWN);
    expect(initOutput).toContain('已初始化工作流: Clean Repo Smoke (1 个任务)');

    const nextOutput = runFlow(repoDir, ['next']);
    expect(nextOutput).toContain('--- 任务 001 ---');

    await writeFile(join(repoDir, 'residue.txt'), 'left behind by interrupted task\n', 'utf-8');

    const resumeOutput = runFlow(repoDir, ['resume']);
    expect(resumeOutput).toContain('恢复工作流: Clean Repo Smoke');
    expect(resumeOutput).toContain('进度: 0/1');
    expect(resumeOutput).toContain('中断任务 001 已重置，将重新执行');
    expect(resumeOutput).toContain('工作流启动前已有 1 个脏文件仍然保留:');
    expect(resumeOutput).toContain('- baseline.txt');
    expect(resumeOutput).toContain('已保留');
    expect(resumeOutput).toContain('- residue.txt');

    const statusOutput = runFlow(repoDir, ['status']);
    expect(statusOutput).toContain('状态: running | 进度: 0/1');
    expect(statusOutput).toContain('[ ] 001 [backend] add tracked file');

    const gitStatus = runGit(repoDir, ['status', '--short']);
    expect(gitStatus).toContain('M baseline.txt');
    expect(gitStatus).toContain('?? residue.txt');
  });

  it('detects and commits a gitlink-only submodule update in the operational flow', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-operational-submodule-'));
    const rootDir = join(dir, 'root');
    const submoduleSourceDir = join(dir, 'submodule-source');
    const submodulePath = join(rootDir, 'vendor', 'lib');
    const trackedFile = 'tracked.txt';
    tempDirs.push(dir);

    await mkdir(rootDir, { recursive: true });
    await mkdir(submoduleSourceDir, { recursive: true });

    initGitRepo(submoduleSourceDir);
    await writeFile(join(submoduleSourceDir, trackedFile), 'base\n', 'utf-8');
    execFileSync('git', ['add', '--', trackedFile], { cwd: submoduleSourceDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init submodule'], { cwd: submoduleSourceDir, stdio: 'pipe' });

    initGitRepo(rootDir);
    execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', submoduleSourceDir, 'vendor/lib'], { cwd: rootDir, stdio: 'pipe' });
    execFileSync('git', ['add', '--', '.'], { cwd: rootDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init root'], { cwd: rootDir, stdio: 'pipe' });

    const initOutput = runFlow(rootDir, ['init'], SUBMODULE_TASK_MARKDOWN);
    expect(initOutput).toContain('已初始化工作流: Submodule Smoke (1 个任务)');

    const nextOutput = runFlow(rootDir, ['next']);
    expect(nextOutput).toContain('--- 任务 001 ---');

    initGitRepo(submodulePath);
    await writeFile(join(submodulePath, trackedFile), 'base\nadvanced\n', 'utf-8');
    execFileSync('git', ['add', '--', trackedFile], { cwd: submodulePath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'advance submodule'], { cwd: submodulePath, stdio: 'pipe' });

    const checkpointOutput = runFlow(
      rootDir,
      ['checkpoint', '001', '--files', 'vendor/lib'],
      '[DECISION] gitlink-only updates should be committed from the parent repo boundary',
    );
    expect(checkpointOutput).toContain('任务 001 完成 (1/1)');
    expect(checkpointOutput).toContain('[已自动提交]');

    const parentCommitFiles = runGit(rootDir, ['show', '--pretty=', '--name-only', 'HEAD']).split('\n').filter(Boolean);
    expect(parentCommitFiles).toEqual(['vendor/lib']);

    const rootStatus = runGit(rootDir, ['status', '--short']);
    expect(rootStatus).not.toContain('M vendor/lib');
    expect(rootStatus).not.toContain('MM vendor/lib');
    expect(rootStatus).not.toContain('A  vendor/lib');
  });
});
