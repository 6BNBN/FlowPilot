/**
 * @module e2e/self-evolution
 * @description 自我迭代闭环端到端测试
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkflowService } from '../application/workflow-service';
import { FsWorkflowRepository } from '../infrastructure/fs-repository';
import { parseTasksMarkdown } from '../infrastructure/markdown-parser';
import { loadMemory, type MemoryEntry } from '../infrastructure/memory';

let savedApiKey: string | undefined;
let savedAuthToken: string | undefined;

beforeAll(() => {
  savedApiKey = process.env.ANTHROPIC_API_KEY;
  savedAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

afterAll(() => {
  if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
  if (savedAuthToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = savedAuthToken;
});

let dir: string;
let repo: FsWorkflowRepository;
let svc: WorkflowService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-evo-'));
  repo = new FsWorkflowRepository(dir);
  svc = new WorkflowService(repo, parseTasksMarkdown);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 快速完成单任务工作流 */
async function runSingleTask(s: WorkflowService, md: string, summary: string) {
  await s.init(md, true);
  await s.next();
  await s.checkpoint('001', summary);
}

describe('测试1: 记忆跨工作流传递', () => {
  it('第二轮工作流 next 的 context 包含第一轮写入的记忆', async () => {
    // 第一轮
    const md1 = '# 轮次1\n\n1. [backend] 配置存储设计\n  设计配置存储方案';
    await svc.init(md1);
    await svc.next();
    await svc.checkpoint('001', '[REMEMBER] 使用PostgreSQL的jsonb存储配置');

    // 手动完成第一轮（跳过 finish 的 git/verify）
    // 第二轮：force init 新任务
    const md2 = '# 轮次2\n\n1. [backend] 配置读取接口\n  实现PostgreSQL配置读取';
    await svc.init(md2, true);
    const r = await svc.next();

    expect(r).not.toBeNull();
    const ctx = r!.context;
    const hasPostgres = ctx.includes('PostgreSQL') || ctx.includes('jsonb');
    expect(hasPostgres).toBe(true);
  });
});

describe('测试2: 历史统计影响参数', () => {
  it('高失败率工作流完成后，历史文件被写入', async () => {
    // 第一轮：3个任务，2个 FAILED
    const md = '# 失败测试\n\n1. [backend] 任务A\n2. [backend] 任务B\n3. [backend] 任务C';
    await svc.init(md);

    // 完成任务A
    await svc.next();
    await svc.checkpoint('001', '完成A');

    // 任务B 失败3次 → skipped
    await svc.next();
    await svc.checkpoint('002', 'FAILED');
    await svc.next();
    await svc.checkpoint('002', 'FAILED');
    await svc.next();
    await svc.checkpoint('002', 'FAILED');

    // 任务C 失败3次 → skipped
    await svc.next();
    await svc.checkpoint('003', 'FAILED');
    await svc.next();
    await svc.checkpoint('003', 'FAILED');
    await svc.next();
    await svc.checkpoint('003', 'FAILED');

    // 保存历史统计（模拟 finish 中的 collectStats + saveHistory）
    const { collectStats } = await import('../infrastructure/history');
    const data = await svc.status();
    const stats = collectStats(data!);
    await repo.saveHistory(stats);

    // 验证 .flowpilot/history/ 有文件
    const historyDir = join(dir, '.flowpilot', 'history');
    const files = await readdir(historyDir);
    expect(files.length).toBeGreaterThan(0);

    // 第二轮：init 触发 applyHistoryInsights
    const md2 = '# 轮次2\n\n1. [backend] 新任务';
    await svc.init(md2, true);

    // 验证历史仍然存在（不被 clearAll 清理）
    const files2 = await readdir(historyDir);
    expect(files2.length).toBeGreaterThan(0);
  });
});

describe('测试3: 知识自动提取', () => {
  it('checkpoint 提取标记和决策模式写入 memory.json', async () => {
    const md = '# 提取测试\n\n1. [backend] 技术选型\n  选择前端框架';
    await svc.init(md);
    await svc.next();

    const summary = [
      '[DECISION] 选择了React而非Vue',
      '因为TypeScript支持更好所以选择Next.js',
      '其他无关内容',
    ].join('\n');
    await svc.checkpoint('001', summary);

    const entries = await loadMemory(dir);
    // 至少提取了标记行 + 决策模式
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const contents = entries.map(e => e.content);
    // 标记提取
    expect(contents.some(c => c.includes('React') && c.includes('Vue'))).toBe(true);
    // 决策模式提取
    expect(contents.some(c => c.includes('Next.js') || c.includes('TypeScript'))).toBe(true);
  });
});

describe('测试4: 循环检测触发', () => {
  it('连续3次相似 FAILED 后 next 的 context 包含循环检测警告', async () => {
    const md = '# 循环测试\n\n1. [backend] 部署服务\n  部署到生产环境';
    await svc.init(md);

    // 连续3次 FAILED（相似 summary）
    await svc.next();
    await svc.checkpoint('001', 'FAILED');
    await svc.next();
    await svc.checkpoint('001', 'FAILED');
    await svc.next();
    const msg = await svc.checkpoint('001', 'FAILED');

    // 第3次失败后任务被跳过，需要新任务来验证警告注入
    // 添加一个新任务来接收循环警告
    await svc.add('修复部署', 'backend');
    const r = await svc.next();

    expect(r).not.toBeNull();
    expect(r!.context).toContain('循环检测警告');
  });
});

describe('测试5: 时间衰减 + evergreen 豁免', () => {
  it('100天前普通条目被 archived，architecture 来源条目不被 archived', async () => {
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();

    // 手动写入 memory.json
    const entries: MemoryEntry[] = [
      {
        content: '普通临时笔记内容',
        source: 'task-001',
        timestamp: oldDate,
        refs: 0,
        archived: false,
      },
      {
        content: '系统架构使用微服务模式',
        source: 'architecture-review',
        timestamp: oldDate,
        refs: 0,
        archived: false,
      },
    ];
    await mkdir(join(dir, '.flowpilot'), { recursive: true });
    await writeFile(join(dir, '.flowpilot', 'memory.json'), JSON.stringify(entries), 'utf-8');

    // init 触发 decayMemory
    const md = '# 衰减测试\n\n1. [general] 测试任务';
    await svc.init(md);

    const result = await loadMemory(dir);
    const normal = result.find(e => e.content === '普通临时笔记内容');
    const arch = result.find(e => e.content === '系统架构使用微服务模式');

    expect(normal?.archived).toBe(true);
    expect(arch?.archived).toBe(false);
  });
});
