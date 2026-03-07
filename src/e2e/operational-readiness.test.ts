/**
 * @module e2e/operational-readiness
 * @description clean-repo operational readiness smoke test
 */

import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FLOW_CLI = '/home/zzz/桌面/2026开发/tools/FlowPilot/dist/flow.js';
const TASK_MARKDOWN = `# Clean Repo Smoke\n\n1. [backend] add tracked file\n  create one tracked file in a clean repo\n`;

describe('clean repo operational readiness smoke test', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('runs init -> next/checkpoint -> review -> finish and commits only workflow-owned files', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'flow-operational-smoke-'));
    tempDirs.push(repoDir);

    execFileSync('git', ['init'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'FlowPilot Test'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'flowpilot@example.com'], { cwd: repoDir, stdio: 'pipe' });

    const initOutput = execFileSync('node', [FLOW_CLI, 'init'], {
      cwd: repoDir,
      input: TASK_MARKDOWN,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(initOutput).toContain('已初始化工作流: Clean Repo Smoke (1 个任务)');

    const nextOutput = execFileSync('node', [FLOW_CLI, 'next'], {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(nextOutput).toContain('--- 任务 001 ---');

    await writeFile(join(repoDir, 'app.txt'), 'hello smoke\n', 'utf-8');

    const checkpointOutput = execFileSync('node', [FLOW_CLI, 'checkpoint', '001', '--files', 'app.txt'], {
      cwd: repoDir,
      input: '[REMEMBER] clean repo smoke writes exactly one tracked file',
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(checkpointOutput).toContain('任务 001 完成 (1/1)');
    expect(checkpointOutput).toContain('全部任务已完成，请执行 node flow.js finish 进行收尾');
    expect(checkpointOutput).toContain('[已自动提交]');

    const reviewOutput = execFileSync('node', [FLOW_CLI, 'review'], {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(reviewOutput).toContain('代码审查已通过，请执行 node flow.js finish 完成收尾');

    const finishOutput = execFileSync('node', [FLOW_CLI, 'finish'], {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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

    const status = execFileSync('git', ['status', '--short'], {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);
    expect(status).toEqual(['?? .flowpilot/']);

    const flowpilotEntries = (await readdir(join(repoDir, '.flowpilot'))).sort();
    expect(flowpilotEntries).toContain('history');
    expect(flowpilotEntries).not.toContain('.workflow');
    expect((await readdir(join(repoDir, '.flowpilot', 'history'))).length).toBe(1);

    const commitCount = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(commitCount).toBe('1');

    const committedFiles = execFileSync('git', ['show', '--pretty=', '--name-only', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);
    expect(committedFiles).toEqual(['app.txt']);

    expect((await stat(join(repoDir, 'app.txt'))).isFile()).toBe(true);
    expect(await readFile(join(repoDir, 'app.txt'), 'utf-8')).toBe('hello smoke\n');
  });
});
