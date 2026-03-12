import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowService } from './workflow-service';
import { FsWorkflowRepository } from '../infrastructure/fs-repository';
import { parseTasksMarkdown } from '../infrastructure/markdown-parser';

let dir: string;
let svc: WorkflowService;

const TASKS_MD = `# 验证语义测试

测试 finish 验证输出

1. [backend] 完成任务
  输出 checkpoint
`;

async function completeWorkflow(service: WorkflowService): Promise<void> {
  await completeWorkflowWithoutReview(service);
  await service.review();
}

async function completeWorkflowWithoutReview(service: WorkflowService): Promise<void> {
  await service.init(TASKS_MD);
  await service.next();
  await service.checkpoint('001', '完成任务');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-verify-finish-'));
  const repo = new FsWorkflowRepository(dir);
  svc = new WorkflowService(repo, parseTasksMarkdown);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('WorkflowService finish verification messaging', () => {
  it('首次 finish 在 review 前保留 验证通过 哨兵文本', async () => {
    const repo = new FsWorkflowRepository(dir);
    const clearAllSpy = vi.spyOn(repo, 'clearAll');
    vi.spyOn(repo, 'verify').mockReturnValue({
      passed: true,
      status: 'passed',
      scripts: ['npm run build', 'npm run test -- --run'],
      steps: [
        { command: 'npm run build', status: 'passed' },
        { command: 'npm run test -- --run', status: 'skipped', reason: '未找到测试文件' },
      ],
    } as any);
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflowWithoutReview(svc);

    const msg = await svc.finish();

    expect(msg).toContain('验证通过');
    expect(msg).toContain('验证结果:');
    expect(msg).toContain('通过: npm run build');
    expect(msg).toContain('跳过: npm run test -- --run（未找到测试文件）');
    expect(msg).toContain('请派子Agent执行 code-review');
    expect(msg).not.toContain('验证通过: npm run build, npm run test -- --run');
    expect(clearAllSpy).not.toHaveBeenCalled();
    expect((await svc.status())?.status).toBe('running');
  });

  it('review 后 commit skipped 时保留工作流并区分 passed、skipped 验证步骤', async () => {
    const repo = new FsWorkflowRepository(dir);
    const clearAllSpy = vi.spyOn(repo, 'clearAll');
    vi.spyOn(repo, 'commit').mockReturnValue({ status: 'skipped', reason: 'no-files' });
    vi.spyOn(repo, 'listChangedFiles').mockReturnValue([]);
    vi.spyOn(repo, 'verify').mockReturnValue({
      passed: true,
      status: 'passed',
      scripts: ['npm run build', 'npm run test -- --run'],
      steps: [
        { command: 'npm run build', status: 'passed' },
        { command: 'npm run test -- --run', status: 'skipped', reason: '未找到测试文件' },
      ],
    } as any);
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflow(svc);

    const msg = await svc.finish();

    expect(msg).toContain('验证结果:');
    expect(msg).toContain('通过: npm run build');
    expect(msg).toContain('跳过: npm run test -- --run（未找到测试文件）');
    expect(msg).toContain('未提交最终commit');
    expect(msg).not.toContain('工作流回到待命状态');
    expect(msg).not.toContain('验证通过: npm run build, npm run test -- --run');
    expect(clearAllSpy).not.toHaveBeenCalled();
    expect((await svc.status())?.status).toBe('finishing');
  });

  it('review 后验证命令 not found 时保留工作流并说明 not found', async () => {
    const repo = new FsWorkflowRepository(dir);
    const clearAllSpy = vi.spyOn(repo, 'clearAll');
    vi.spyOn(repo, 'commit').mockReturnValue({ status: 'skipped', reason: 'no-files' });
    vi.spyOn(repo, 'listChangedFiles').mockReturnValue([]);
    vi.spyOn(repo, 'verify').mockReturnValue({
      passed: true,
      status: 'not-found',
      scripts: [],
      steps: [],
    } as any);
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflow(svc);

    const msg = await svc.finish();

    expect(msg).toContain('验证结果: 未发现可执行的验证命令');
    expect(msg).not.toContain('验证通过: 无验证脚本');
    expect(msg).toContain('未提交最终commit');
    expect(msg).not.toContain('工作流回到待命状态');
    expect(clearAllSpy).not.toHaveBeenCalled();
    expect((await svc.status())?.status).toBe('finishing');
  });

  it('finish 在 clearAll 前输出并落盘最终总结', async () => {
    const repo = new FsWorkflowRepository(dir);
    vi.spyOn(repo, 'verify').mockReturnValue({
      passed: true,
      status: 'passed',
      scripts: ['npm run test'],
      steps: [{ command: 'npm run test', status: 'passed' }],
    } as any);
    vi.spyOn(repo, 'commit').mockReturnValue({ status: 'committed' } as any);
    const clearAllSpy = vi.spyOn(repo, 'clearAll').mockImplementation(async () => {
      const persisted = await readFile(join(dir, '.workflow', 'final-summary.md'), 'utf-8');
      expect(persisted).toContain('最终总结:');
      expect(persisted).toContain('[x] 001 [backend] 完成任务 - 完成任务');
      await rm(join(dir, '.workflow'), { recursive: true, force: true });
    });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflow(svc);

    const msg = await svc.finish();

    expect(msg).toContain('最终总结:');
    expect(msg).toContain('[x] 001 [backend] 完成任务 - 完成任务');
    expect(clearAllSpy).toHaveBeenCalledOnce();
  });
});
