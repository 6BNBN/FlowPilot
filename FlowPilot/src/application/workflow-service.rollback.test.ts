import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkflowService } from './workflow-service';
import { FsWorkflowRepository } from '../infrastructure/fs-repository';
import { parseTasksMarkdown } from '../infrastructure/markdown-parser';

const TASKS_MD = `# 回滚分支测试

1. [backend] 基础后端
2. [backend] 目标任务 (deps: 1)
3. [general] 目标下游A (deps: 2)
4. [general] 目标下游B (deps: 3)
5. [frontend] 无关分支 (deps: 1)
6. [general] 汇合任务 (deps: 4,5)
`;

describe('WorkflowService rollback regression', () => {
  let dir: string;
  let repo: FsWorkflowRepository;
  let svc: WorkflowService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'flow-rollback-'));
    repo = new FsWorkflowRepository(dir);
    vi.spyOn(repo, 'rollback').mockReturnValue(null);
    svc = new WorkflowService(repo, parseTasksMarkdown);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rollback重开目标及传递下游终态任务，但保留无关完成分支', async () => {
    await svc.init(TASKS_MD);

    await svc.next();
    await svc.checkpoint('001', '[REMEMBER] 基础后端完成');

    const batch = await svc.nextBatch();
    expect(batch.map(item => item.task.id)).toEqual(['002', '005']);

    await svc.checkpoint('002', '[DECISION] 目标任务完成');
    await svc.checkpoint('005', '无关分支完成');

    await svc.next();
    await svc.checkpoint('003', 'FAILED: 下游A失败');
    await svc.next();
    await svc.checkpoint('003', 'FAILED: 下游A再次失败');
    await svc.next();
    await svc.checkpoint('003', 'FAILED: 下游A第三次失败');
    expect(await svc.next()).toBeNull();

    const beforeRollback = await svc.status();
    expect(beforeRollback?.tasks.map(task => ({ id: task.id, status: task.status }))).toEqual([
      { id: '001', status: 'done' },
      { id: '002', status: 'done' },
      { id: '003', status: 'failed' },
      { id: '004', status: 'skipped' },
      { id: '005', status: 'done' },
      { id: '006', status: 'skipped' },
    ]);

    const msg = await svc.rollback('002');
    expect(msg).toContain('任务 002');
    expect(msg).toContain('4 个任务重置为 pending');

    const afterRollback = await svc.status();
    expect(afterRollback?.tasks.map(task => ({
      id: task.id,
      status: task.status,
      summary: task.summary,
      retries: task.retries,
    }))).toEqual([
      { id: '001', status: 'done', summary: '[REMEMBER] 基础后端完成', retries: 0 },
      { id: '002', status: 'pending', summary: '', retries: 0 },
      { id: '003', status: 'pending', summary: '', retries: 0 },
      { id: '004', status: 'pending', summary: '', retries: 0 },
      { id: '005', status: 'done', summary: '无关分支完成', retries: 0 },
      { id: '006', status: 'pending', summary: '', retries: 0 },
    ]);
  });

  it('rollback在review后重开任务时恢复为running状态', async () => {
    await svc.init(TASKS_MD);

    await svc.next();
    await svc.checkpoint('001', '[REMEMBER] 基础后端完成');

    const batch = await svc.nextBatch();
    expect(batch.map(item => item.task.id)).toEqual(['002', '005']);
    await svc.checkpoint('002', '[DECISION] 目标任务完成');
    await svc.checkpoint('005', '[REMEMBER] 无关分支完成');

    await svc.next();
    await svc.checkpoint('003', '[REMEMBER] 下游A完成');
    await svc.next();
    await svc.checkpoint('004', '[REMEMBER] 下游B完成');
    await svc.next();
    await svc.checkpoint('006', '[ARCHITECTURE] 汇合任务完成');

    await svc.review();
    const beforeRollback = await svc.status();
    expect(beforeRollback?.status).toBe('finishing');

    await svc.rollback('002');

    const afterRollback = await svc.status();
    expect(afterRollback?.status).toBe('running');
  });

  it('rollback后重建summary，nextBatch上下文不再注入已重开任务的旧摘要', async () => {
    await svc.init(TASKS_MD);

    await svc.next();
    await svc.checkpoint('001', '[REMEMBER] 基础后端完成');

    const firstBatch = await svc.nextBatch();
    expect(firstBatch.map(item => item.task.id)).toEqual(['002', '005']);
    await svc.checkpoint('002', '[DECISION] 目标任务完成');
    await svc.checkpoint('005', '[REMEMBER] 无关分支完成');

    await svc.next();
    await svc.checkpoint('003', '[REMEMBER] 下游A完成');
    await svc.next();
    await svc.checkpoint('004', '[ARCHITECTURE] 下游B完成');
    await svc.next();
    await svc.checkpoint('006', '[DECISION] 汇合任务完成');

    await svc.review();
    await svc.rollback('002');

    const summary = await repo.loadSummary();
    expect(summary).toContain('[REMEMBER] 无关分支完成');
    expect(summary).not.toContain('[DECISION] 目标任务完成');
    expect(summary).not.toContain('[REMEMBER] 下游A完成');
    expect(summary).not.toContain('[ARCHITECTURE] 下游B完成');
    expect(summary).not.toContain('[DECISION] 汇合任务完成');

    const rerunBatch = await svc.nextBatch();
    expect(rerunBatch.map(item => item.task.id)).toEqual(['002']);
    expect(rerunBatch[0]?.context).toContain('[REMEMBER] 无关分支完成');
    expect(rerunBatch[0]?.context).not.toContain('[DECISION] 目标任务完成');
    expect(rerunBatch[0]?.context).not.toContain('[REMEMBER] 下游A完成');
    expect(rerunBatch[0]?.context).not.toContain('[ARCHITECTURE] 下游B完成');
    expect(rerunBatch[0]?.context).not.toContain('[DECISION] 汇合任务完成');
  });
});
