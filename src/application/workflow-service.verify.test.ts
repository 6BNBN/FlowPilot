import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
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
  await service.init(TASKS_MD);
  await service.next();
  await service.checkpoint('001', '完成任务');
  await service.review();
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
  it('区分 passed、skipped 与 not found 的验证步骤', async () => {
    const repo = new FsWorkflowRepository(dir);
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
    expect(msg).not.toContain('验证通过: npm run build, npm run test -- --run');
  });

  it('在没有可检测验证命令时说明 not found', async () => {
    const repo = new FsWorkflowRepository(dir);
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
  });
});
