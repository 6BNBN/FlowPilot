import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkflowService } from './workflow-service';
import { FsWorkflowRepository } from '../infrastructure/fs-repository';
import { parseTasksMarkdown } from '../infrastructure/markdown-parser';
import { loadMemory } from '../infrastructure/memory';

let dir: string;
let svc: WorkflowService;

const TASKS_MD = `# 集成测试

测试用工作流

1. [backend] 设计数据库
  PostgreSQL表结构
2. [frontend] 创建页面 (deps: 1)
  React首页
3. [general] 写文档 (deps: 1,2)
  API文档
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-int-'));
  const repo = new FsWorkflowRepository(dir);
  svc = new WorkflowService(repo, parseTasksMarkdown);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('WorkflowService 集成测试', () => {
  it('init → next → checkpoint → finish 完整流程', async () => {
    // init
    const data = await svc.init(TASKS_MD);
    expect(data.status).toBe('running');
    expect(data.tasks).toHaveLength(3);

    // next: 只有001可执行（002依赖001）
    const r1 = await svc.next();
    expect(r1?.task.id).toBe('001');

    // checkpoint 001
    const msg1 = await svc.checkpoint('001', '表结构设计完成');
    expect(msg1).toContain('1/3');

    // next: 002解锁
    const r2 = await svc.next();
    expect(r2?.task.id).toBe('002');
    expect(r2?.context).toContain('集成测试');

    // checkpoint 002
    await svc.checkpoint('002', '页面完成');

    // next: 003解锁
    const r3 = await svc.next();
    expect(r3?.task.id).toBe('003');

    // checkpoint 003
    const msg3 = await svc.checkpoint('003', '文档完成');
    expect(msg3).toContain('finish');

    // next: 全部完成
    expect(await svc.next()).toBeNull();
  });

  it('中断恢复：active任务重置为pending', async () => {
    await svc.init(TASKS_MD);
    await svc.next(); // 001 → active

    // 模拟中断：直接resume
    const msg = await svc.resume();
    expect(msg).toContain('恢复工作流');
    expect(msg).toContain('001');

    // 重新next应该还是001
    const r = await svc.next();
    expect(r?.task.id).toBe('001');
  });

  it('失败重试3次后级联跳过', async () => {
    await svc.init(TASKS_MD);
    await svc.next(); // 001 active

    // 失败3次（每次重试需重新激活）
    await svc.checkpoint('001', 'FAILED');
    await svc.next(); // 重新激活
    await svc.checkpoint('001', 'FAILED');
    await svc.next(); // 重新激活
    const msg = await svc.checkpoint('001', 'FAILED');
    expect(msg).toContain('跳过');

    // 002依赖001，应被级联跳过
    const r = await svc.next();
    expect(r).toBeNull(); // 全部跳过/失败
  });

  it('skip手动跳过', async () => {
    await svc.init(TASKS_MD);
    const msg = await svc.skip('001');
    expect(msg).toContain('跳过');

    const status = await svc.status();
    expect(status?.tasks[0].status).toBe('skipped');
  });

  it('add追加任务', async () => {
    await svc.init(TASKS_MD);
    const msg = await svc.add('新任务', 'backend');
    expect(msg).toContain('004');

    const status = await svc.status();
    expect(status?.tasks).toHaveLength(4);
  });

  it('nextBatch返回可并行任务', async () => {
    const md = '# 并行测试\n\n1. [backend] A\n2. [frontend] B\n3. [general] C (deps: 1,2)';
    await svc.init(md);
    const batch = await svc.nextBatch();
    expect(batch.map(b => b.task.id)).toEqual(['001', '002']);
  });

  it('init不允许覆盖running工作流', async () => {
    await svc.init(TASKS_MD);
    await expect(svc.init(TASKS_MD)).rejects.toThrow('已有进行中');
  });

  it('init --force可以覆盖', async () => {
    await svc.init(TASKS_MD);
    const data = await svc.init(TASKS_MD, true);
    expect(data.status).toBe('running');
  });

  it('checkpoint提取[REMEMBER]标记写入永久记忆', async () => {
    await svc.init(TASKS_MD);
    await svc.next();
    await svc.checkpoint('001', '完成设计\n[REMEMBER] PostgreSQL使用jsonb存储配置\n其他内容');
    const entries = await loadMemory(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('PostgreSQL使用jsonb存储配置');
    expect(entries[0].source).toBe('task-001');
  });

  it('next注入相关永久记忆到context', async () => {
    await svc.init(TASKS_MD);
    await svc.next();
    await svc.checkpoint('001', '[REMEMBER] 数据库使用PostgreSQL表结构设计');
    const r = await svc.next();
    expect(r?.context).toContain('相关记忆');
    expect(r?.context).toContain('PostgreSQL');
  });

  it('nextBatch注入相关永久记忆到context', async () => {
    const md = '# 记忆测试\n\n1. [backend] 数据库设计\n2. [frontend] 前端页面\n3. [general] C (deps: 1,2)';
    await svc.init(md);
    const batch1 = await svc.nextBatch();
    await svc.checkpoint('001', '[REMEMBER] 数据库使用PostgreSQL设计表结构');
    await svc.checkpoint('002', '前端完成');
    const batch2 = await svc.nextBatch();
    expect(batch2[0]?.context).toContain('相关记忆');
  });
});
