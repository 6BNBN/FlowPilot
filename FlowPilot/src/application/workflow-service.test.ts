import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkflowService } from './workflow-service';
import { FsWorkflowRepository } from '../infrastructure/fs-repository';
import { parseTasksMarkdown } from '../infrastructure/markdown-parser';
import { loadMemory } from '../infrastructure/memory';
import * as history from '../infrastructure/history';
import * as hooks from '../infrastructure/hooks';
import type { CommitResult } from '../domain/repository';

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
const LOCAL_STATE_GITIGNORE = '.workflow/\n.flowpilot/\n.claude/settings.json\n.claude/worktrees/\n';

async function completeWorkflow(service: WorkflowService): Promise<void> {
  await service.init(TASKS_MD);
  await service.next();
  await service.checkpoint('001', '表结构设计完成');
  await service.next();
  await service.checkpoint('002', '页面完成');
  await service.next();
  await service.checkpoint('003', '文档完成');
}

function mockCommitResult(repo: FsWorkflowRepository, result: CommitResult) {
  return vi.spyOn(repo, 'commit').mockReturnValue(result);
}

function mockChangedFiles(repo: FsWorkflowRepository, files: string[]) {
  return vi.spyOn(repo, 'listChangedFiles').mockReturnValue(files);
}

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

async function initGitRepo(baseDir: string): Promise<void> {
  runGit(['init'], baseDir);
  runGit(['config', 'user.name', 'FlowPilot Tests'], baseDir);
  runGit(['config', 'user.email', 'flowpilot-tests@example.com'], baseDir);
  await writeFile(join(baseDir, '.gitignore'), 'node_modules\n', 'utf-8');
  await writeFile(join(baseDir, 'README.md'), '# test repo\n', 'utf-8');
  runGit(['add', '.'], baseDir);
  runGit(['commit', '-m', 'init'], baseDir);
}

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

  it('resume会明确报告中断任务保留的脏业务文件', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValueOnce(['src/feature.ts']);
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await svc.init(TASKS_MD);
    await svc.next();

    const msg = await svc.resume();

    expect(msg).toContain('中断任务 001 已重置，将重新执行');
    expect(msg).toContain('已保留 1 个中断任务残留的脏业务文件');
    expect(msg).toContain('src/feature.ts');
  });

  it('resume会区分启动前已脏且恢复后仍脏的文件', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce(['README.md']);
    changedFilesSpy.mockReturnValueOnce(['README.md']);
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await svc.init(TASKS_MD);
    await svc.next();

    const msg = await svc.resume();

    expect(msg).toContain('工作流启动前已有 1 个脏文件仍然保留');
    expect(msg).toContain('README.md');
    expect(msg).not.toContain('中断任务残留的脏业务文件');
  });

  it('resume会把无脏文件的恢复表述为干净重启', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValueOnce([]);
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await svc.init(TASKS_MD);
    await svc.next();

    const msg = await svc.resume();

    expect(msg).toContain('当前工作区无残留脏业务文件，本次恢复是干净重启');
  });

  it('resume在旧工作流缺少baseline时给出保守警告而非误报干净', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValueOnce(['src/legacy.ts']);
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await svc.init(TASKS_MD);
    await rm(join(dir, '.workflow', 'dirty-baseline.json'), { force: true });
    await svc.next();

    const msg = await svc.resume();

    expect(msg).toContain('未找到 dirty baseline');
    expect(msg).toContain('src/legacy.ts');
    expect(msg).not.toContain('干净重启');
  });

  it('resume会过滤 FlowPilot 运行时脏文件，不把 .claude/settings.json 误报为业务文件', async () => {
    await initGitRepo(dir);
    const repo = new FsWorkflowRepository(dir);
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await svc.init(TASKS_MD);
    await svc.next();
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude', 'settings.json'), '{"hooks":[]}', 'utf-8');
    await writeFile(join(dir, 'src-feature.ts'), 'export const changed = true;\n', 'utf-8');

    const msg = await svc.resume();

    expect(msg).toContain('src-feature.ts');
    expect(msg).not.toContain('.claude/settings.json');
    expect(msg).not.toContain('.workflow/');
    expect(msg).not.toContain('.flowpilot/');
  });

  it('resume在旧工作流缺少baseline时也会过滤 FlowPilot 运行时脏文件', async () => {
    await initGitRepo(dir);
    const repo = new FsWorkflowRepository(dir);
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await svc.init(TASKS_MD);
    await rm(join(dir, '.workflow', 'dirty-baseline.json'), { force: true });
    await svc.next();
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude', 'settings.json'), '{"hooks":[]}', 'utf-8');
    await writeFile(join(dir, 'src-legacy.ts'), 'export const legacy = true;\n', 'utf-8');

    const msg = await svc.resume();

    expect(msg).toContain('未找到 dirty baseline');
    expect(msg).toContain('src-legacy.ts');
    expect(msg).not.toContain('.claude/settings.json');
    expect(msg).not.toContain('.workflow/');
    expect(msg).not.toContain('.flowpilot/');
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

  it('init在setup前记录工作流初始dirty baseline', async () => {
    const repo = new FsWorkflowRepository(dir);
    const events: string[] = [];
    vi.spyOn(repo, 'listChangedFiles').mockImplementation(() => {
      events.push('listChangedFiles');
      return ['README.md'];
    });
    vi.spyOn(repo, 'ensureClaudeMd').mockImplementation(async () => {
      events.push('ensureClaudeMd');
      return true;
    });
    vi.spyOn(repo, 'ensureHooks').mockImplementation(async () => {
      events.push('ensureHooks');
      return true;
    });
    vi.spyOn(repo, 'ensureLocalStateIgnored').mockImplementation(async () => {
      events.push('ensureLocalStateIgnored');
      return true;
    });
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await svc.init(TASKS_MD);

    const baseline = JSON.parse(await readFile(join(dir, '.workflow', 'dirty-baseline.json'), 'utf-8'));
    expect(baseline.files).toEqual(['README.md']);
    expect(events.slice(0, 2)).toEqual(['listChangedFiles', 'ensureClaudeMd']);
  });

  it('next记录单个任务的激活元数据', async () => {
    await svc.init(TASKS_MD);
    await svc.next();

    const activations = JSON.parse(await readFile(join(dir, '.workflow', 'activated.json'), 'utf-8'));
    expect(Object.keys(activations)).toEqual(['001']);
    expect(activations['001'].pid).toBe(process.pid);
    expect(typeof activations['001'].time).toBe('number');
  });

  it('nextBatch记录多个任务的激活元数据', async () => {
    const md = '# 并行测试\n\n1. [backend] A\n2. [frontend] B\n3. [general] C (deps: 1,2)';
    await svc.init(md);
    await svc.nextBatch();

    const activations = JSON.parse(await readFile(join(dir, '.workflow', 'activated.json'), 'utf-8'));
    expect(Object.keys(activations).sort()).toEqual(['001', '002']);
    expect(activations['001'].pid).toBe(process.pid);
    expect(activations['002'].pid).toBe(process.pid);
  });

  it('第二个WorkflowService实例从磁盘读取共享激活状态而非依赖同进程快捷路径', async () => {
    await svc.init(TASKS_MD);
    await svc.next();

    const activatedPath = join(dir, '.workflow', 'activated.json');
    const persisted = JSON.parse(await readFile(activatedPath, 'utf-8'));
    await expect((svc as any).getActivationAge('001')).resolves.toBe(Infinity);

    persisted['001'] = {
      ...persisted['001'],
      time: persisted['001'].time - 4_000,
      pid: process.pid,
    };
    await writeFile(activatedPath, JSON.stringify(persisted), 'utf-8');

    const repo = new FsWorkflowRepository(dir);
    const secondSvc = new WorkflowService(repo, parseTasksMarkdown);
    await expect((secondSvc as any).getActivationAge('001')).resolves.toBeGreaterThanOrEqual(4_000);
  });

  it('checkpoint对快速且有效的摘要按成功处理', async () => {
    await svc.init(TASKS_MD);
    await svc.next();

    const msg = await svc.checkpoint('001', '完成 schema 评审并确认索引迁移顺序');

    expect(msg).toContain('任务 001 完成');
    const status = await svc.status();
    expect(status?.tasks[0].status).toBe('done');
  });

  it('checkpoint对显式FAILED负载仍按失败处理', async () => {
    await svc.init(TASKS_MD);
    await svc.next();

    const msg = await svc.checkpoint('001', 'FAILED: agent crashed before applying changes');

    expect(msg).toContain('将重试');
    const status = await svc.status();
    expect(status?.tasks[0].status).toBe('pending');
    expect(status?.tasks[0].retries).toBe(1);
  });

  it('checkpoint对短错误形态负载仍按失败处理', async () => {
    await svc.init(TASKS_MD);
    await svc.next();

    const msg = await svc.checkpoint('001', 'timeout while waiting for repo lock');

    expect(msg).toContain('将重试');
    const status = await svc.status();
    expect(status?.tasks[0].status).toBe('pending');
    expect(status?.tasks[0].retries).toBe(1);
  });

  it('checkpoint对包含失败领域词汇的成功摘要仍按成功处理', async () => {
    await svc.init(TASKS_MD);
    await svc.next();

    const msg = await svc.checkpoint('001', '完成 timeout/error handling 修复并补充异常重试说明');

    expect(msg).toContain('任务 001 完成');
    const status = await svc.status();
    expect(status?.tasks[0].status).toBe('done');
    expect(status?.tasks[0].retries).toBe(0);
  });

  it('跨进程checkpoint不会仅因激活时长过短被判定失败', async () => {
    await svc.init(TASKS_MD);
    await svc.next();

    const repo = new FsWorkflowRepository(dir);
    const secondSvc = new WorkflowService(repo, parseTasksMarkdown);
    const msg = await secondSvc.checkpoint('001', '完成 schema 评审并补充索引约束说明');

    expect(msg).toContain('任务 001 完成');
    const status = await secondSvc.status();
    expect(status?.tasks[0].status).toBe('done');
    expect(status?.tasks[0].retries).toBe(0);
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

  it('仅在 init 和 setup 接入 .gitignore helper', async () => {
    const repo = new FsWorkflowRepository(dir);
    const helperSpy = vi.spyOn(repo, 'ensureLocalStateIgnored');
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await svc.init(TASKS_MD);
    expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe(LOCAL_STATE_GITIGNORE);

    await svc.setup();
    expect(helperSpy).toHaveBeenCalledTimes(2);

    helperSpy.mockClear();
    await svc.next();
    await svc.status();
    await svc.resume();
    await svc.nextBatch();

    expect(helperSpy).not.toHaveBeenCalled();
    expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe(LOCAL_STATE_GITIGNORE);
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
    // 记忆内容包含"页面"关键词，与任务002"创建页面"匹配
    await svc.checkpoint('001', '[REMEMBER] 创建页面时使用React组件化架构模式，支持动态路由和状态管理');
    const r = await svc.next();
    expect(r?.context).toContain('相关记忆');
    expect(r?.context).toContain('React组件化架构模式');
  });

  it('nextBatch注入相关永久记忆到context', async () => {
    const md = '# 记忆测试\n\n1. [backend] 数据库设计\n2. [frontend] 前端页面\n3. [general] 编写文档说明 (deps: 1,2)\n  编写数据库和前端页面的文档';
    await svc.init(md);
    const batch1 = await svc.nextBatch();
    // 记忆内容包含"文档"关键词，与任务003匹配
    await svc.checkpoint('001', '[REMEMBER] 编写文档时需要包含数据库表结构说明和字段类型的详细描述');
    await svc.checkpoint('002', '前端页面开发完成，实现了用户登录和注册功能，使用React组件化架构');
    const batch2 = await svc.nextBatch();
    expect(batch2[0]?.context).toContain('相关记忆');
  });

  it('checkpoint仅在真实提交时显示已自动提交', async () => {
    const repo = new FsWorkflowRepository(dir);
    mockCommitResult(repo, { status: 'committed' });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await svc.init(TASKS_MD);
    await svc.next();

    const msg = await svc.checkpoint('001', '表结构设计完成', ['CLAUDE.md', '.gitignore', 'src/main.ts']);
    expect(msg).toContain('[已自动提交]');
  });

  it('checkpoint在无变更时明确提示未自动提交原因', async () => {
    const repo = new FsWorkflowRepository(dir);
    mockCommitResult(repo, { status: 'skipped', reason: 'no-staged-changes' });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await svc.init(TASKS_MD);
    await svc.next();

    const msg = await svc.checkpoint('001', '表结构设计完成', ['src/main.ts']);
    expect(msg).toContain('[未自动提交]');
    expect(msg).toContain('指定文件无可提交变更');
    expect(msg).not.toContain('[已自动提交]');
  });

  it('checkpoint会持久化 --files 的 owned-file intent，即使任务提交是 no-op', async () => {
    const repo = new FsWorkflowRepository(dir);
    mockCommitResult(repo, { status: 'skipped', reason: 'no-staged-changes' });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await svc.init(TASKS_MD);
    await svc.next();

    await svc.checkpoint('001', '表结构设计完成', [
      './src/main.ts',
      'src\\main.ts',
      '.workflow/progress.md',
      '.claude/settings.json',
      '/README.md',
    ]);

    const owned = JSON.parse(await readFile(join(dir, '.workflow', 'owned-files.json'), 'utf-8'));
    expect(owned).toEqual({
      byTask: {
        '001': ['README.md', 'src/main.ts'],
      },
    });
  });

  it('checkpoint在未提供文件时明确提示未自动提交原因', async () => {
    const repo = new FsWorkflowRepository(dir);
    mockCommitResult(repo, { status: 'skipped', reason: 'no-files' });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await svc.init(TASKS_MD);
    await svc.next();

    const msg = await svc.checkpoint('001', '表结构设计完成');
    expect(msg).toContain('[未自动提交]');
    expect(msg).toContain('未提供 --files，未自动提交');
    expect(msg).not.toContain('[已自动提交]');
  });

  it('finish在干净启动时只提交 workflow-owned 文件', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValue(['src/main.ts']);
    const commitSpy = vi.spyOn(repo, 'commit').mockImplementation((taskId, title, summary, files) => {
      if (taskId !== 'finish') {
        return { status: 'skipped', reason: 'no-staged-changes' };
      }
      expect(files).toEqual(['src/main.ts']);
      return { status: 'committed' };
    });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test -- --run'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await svc.init(TASKS_MD);
    await svc.next();
    await svc.checkpoint('001', '表结构设计完成', ['src/main.ts']);
    await svc.next();
    await svc.checkpoint('002', '页面完成');
    await svc.next();
    await svc.checkpoint('003', '文档完成');
    await svc.review();

    const msg = await svc.finish();
    expect(msg).toContain('验证结果:');
    expect(msg).toContain('- 通过: npm test -- --run');
    expect(msg).toContain('已提交最终commit');
    expect(msg).not.toContain('未提交最终commit');
    expect(commitSpy).toHaveBeenCalledTimes(4);
    expect(commitSpy.mock.calls.at(-1)?.[0]).toBe('finish');
    expect(await svc.status()).toBeNull();
  });

  it('finish在 ownership boundary 拒绝后不运行提交类副作用，但会先做精确 cleanup', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValue(['src/unowned.ts']);
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflow(svc);
    await svc.review();

    const hookSpy = vi.spyOn(hooks, 'runLifecycleHook');
    const saveHistorySpy = vi.spyOn(repo, 'saveHistory');
    const reflectSpy = vi.spyOn(history, 'reflect');
    const experimentSpy = vi.spyOn(history, 'experiment');
    const saveEvolutionSpy = vi.spyOn(repo, 'saveEvolution');
    const cleanupInjectionsSpy = vi.spyOn(repo, 'cleanupInjections');
    const commitSpy = vi.spyOn(repo, 'commit');
    const clearAllSpy = vi.spyOn(repo, 'clearAll');

    const msg = await svc.finish();

    expect(msg).toContain('拒绝最终提交');
    expect(msg).toContain('src/unowned.ts');
    expect(hookSpy).not.toHaveBeenCalled();
    expect(saveHistorySpy).not.toHaveBeenCalled();
    expect(reflectSpy).not.toHaveBeenCalled();
    expect(experimentSpy).not.toHaveBeenCalled();
    expect(saveEvolutionSpy).not.toHaveBeenCalled();
    expect(cleanupInjectionsSpy).toHaveBeenCalledTimes(1);
    expect(commitSpy).not.toHaveBeenCalled();
    expect(clearAllSpy).not.toHaveBeenCalled();
    expect((await svc.status())?.status).toBe('finishing');
  });

  it('finish在 cleanup 移除 setup-owned 注入后仍只提交业务文件，即使 checkpoint 声明了这些文件', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValueOnce(['src/main.ts']);
    const commitSpy = vi.spyOn(repo, 'commit').mockImplementation((taskId, title, summary, files) => {
      if (taskId !== 'finish') {
        return { status: 'skipped', reason: 'no-staged-changes' };
      }
      expect(files).toEqual(['src/main.ts']);
      return { status: 'committed' };
    });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await svc.init(TASKS_MD);
    await svc.next();
    await svc.checkpoint('001', '表结构设计完成', ['CLAUDE.md', '.gitignore', 'src/main.ts']);
    await svc.next();
    await svc.checkpoint('002', '页面完成');
    await svc.next();
    await svc.checkpoint('003', '文档完成');
    await svc.review();

    const msg = await svc.finish();

    expect(msg).toContain('已提交最终commit');
    expect(msg).not.toContain('拒绝最终提交');
    expect(commitSpy.mock.calls.at(-1)?.[0]).toBe('finish');
    expect(await svc.status()).toBeNull();
  });

  it('finish在仓库已预先setup时仍只提交业务文件，即使 checkpoint 声明了 CLAUDE.md 和 .gitignore', async () => {
    await writeFile(join(dir, 'CLAUDE.md'), '# Project\n\n<!-- flowpilot:start -->\nexisting\n', 'utf-8');
    await writeFile(join(dir, '.gitignore'), LOCAL_STATE_GITIGNORE, 'utf-8');

    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValueOnce(['src/main.ts']);
    const commitSpy = vi.spyOn(repo, 'commit').mockImplementation((taskId, title, summary, files) => {
      if (taskId !== 'finish') {
        return { status: 'skipped', reason: 'no-staged-changes' };
      }
      expect(files).toEqual(['src/main.ts']);
      return { status: 'committed' };
    });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await svc.init(TASKS_MD);
    expect(JSON.parse(await readFile(join(dir, '.workflow', 'setup-owned.json'), 'utf-8'))).toEqual({ files: [] });
    await svc.next();
    await svc.checkpoint('001', '表结构设计完成', ['CLAUDE.md', '.gitignore', 'src/main.ts']);
    await svc.next();
    await svc.checkpoint('002', '页面完成');
    await svc.next();
    await svc.checkpoint('003', '文档完成');
    await svc.review();

    const msg = await svc.finish();

    expect(msg).toContain('已提交最终commit');
    expect(msg).not.toContain('拒绝最终提交');
    expect(commitSpy.mock.calls.at(-1)?.[0]).toBe('finish');
    expect(await svc.status()).toBeNull();
  });

  it('finish在脏启动时允许 baseline 脏文件并只提交 owned 新改动', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce(['README.md']);
    changedFilesSpy.mockReturnValueOnce(['README.md', 'src/main.ts']);
    const commitSpy = vi.spyOn(repo, 'commit').mockImplementation((taskId, title, summary, files) => {
      if (taskId !== 'finish') {
        return { status: 'skipped', reason: 'no-staged-changes' };
      }
      expect(files).toEqual(['src/main.ts']);
      return { status: 'committed' };
    });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await svc.init(TASKS_MD);
    await svc.next();
    await svc.checkpoint('001', '表结构设计完成', ['README.md', 'src/main.ts']);
    await svc.next();
    await svc.checkpoint('002', '页面完成');
    await svc.next();
    await svc.checkpoint('003', '文档完成');
    await svc.review();

    const msg = await svc.finish();

    expect(msg).toContain('已提交最终commit');
    expect(msg).not.toContain('拒绝最终提交');
    expect(commitSpy.mock.calls.at(-1)?.[0]).toBe('finish');
    expect(await svc.status()).toBeNull();
  });

  it('finish在存在未归属脏文件时拒绝而不是误提交', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce(['README.md']);
    changedFilesSpy.mockReturnValueOnce(['README.md', 'src/main.ts', 'src/unowned.ts']);
    const commitSpy = vi.spyOn(repo, 'commit');
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    const clearAllSpy = vi.spyOn(repo, 'clearAll');
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await svc.init(TASKS_MD);
    await svc.next();
    await svc.checkpoint('001', '表结构设计完成', ['README.md', 'src/main.ts']);
    await svc.next();
    await svc.checkpoint('002', '页面完成');
    await svc.next();
    await svc.checkpoint('003', '文档完成');
    await svc.review();

    const msg = await svc.finish();
    expect(msg).toContain('拒绝最终提交');
    expect(msg).toContain('src/unowned.ts');
    expect(msg).not.toContain('已提交最终commit');
    expect(commitSpy).not.toHaveBeenCalledWith('finish', expect.any(String), expect.any(String), expect.anything());
    expect(clearAllSpy).not.toHaveBeenCalled();
    expect((await svc.status())?.status).toBe('finishing');
  });

  it('review和缺少baseline时的finish失败不会删除baseline，工作流仍可继续收尾', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValueOnce(['src/unowned.ts']);
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflow(svc);

    const baselinePath = join(dir, '.workflow', 'dirty-baseline.json');
    const baselineBeforeReview = await readFile(baselinePath, 'utf-8');
    await svc.review();
    expect(await readFile(baselinePath, 'utf-8')).toBe(baselineBeforeReview);

    const msg = await svc.finish();

    expect(msg).toContain('拒绝最终提交');
    expect(await readFile(baselinePath, 'utf-8')).toBe(baselineBeforeReview);
    expect((await svc.status())?.status).toBe('finishing');
  });

  it('finish在 legacy 或外部删除 baseline 时不再死锁，而是显式降级完成', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValueOnce(['src/legacy.ts']);
    const commitSpy = vi.spyOn(repo, 'commit');
    const clearAllSpy = vi.spyOn(repo, 'clearAll');
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflow(svc);
    await rm(join(dir, '.workflow', 'dirty-baseline.json'), { force: true });
    await svc.review();

    const msg = await svc.finish();

    expect(msg).toContain('未找到 dirty baseline');
    expect(msg).toContain('未提交最终commit');
    expect(msg).toContain('src/legacy.ts');
    expect(msg).toContain('工作流回到待命状态');
    expect(commitSpy).not.toHaveBeenCalledWith('finish', expect.any(String), expect.any(String), expect.anything());
    expect(clearAllSpy).toHaveBeenCalledTimes(1);
    expect(await svc.status()).toBeNull();
  });

  it('finish在 baseline 缺失但工作区已清理时也会显式降级完成且不自动提交', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValueOnce([]);
    const commitSpy = vi.spyOn(repo, 'commit');
    const clearAllSpy = vi.spyOn(repo, 'clearAll');
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflow(svc);
    await rm(join(dir, '.workflow', 'dirty-baseline.json'), { force: true });
    await svc.review();

    const msg = await svc.finish();

    expect(msg).toContain('未找到 dirty baseline');
    expect(msg).toContain('当前工作区无脏业务文件');
    expect(msg).toContain('未提交最终commit');
    expect(msg).toContain('工作流回到待命状态');
    expect(commitSpy).not.toHaveBeenCalledWith('finish', expect.any(String), expect.any(String), expect.anything());
    expect(clearAllSpy).toHaveBeenCalledTimes(1);
    expect(await svc.status()).toBeNull();
  });

  it('finish在未提供文件时说明未提交最终commit但仍正常收尾', async () => {
    const repo = new FsWorkflowRepository(dir);
    mockChangedFiles(repo, []);
    mockCommitResult(repo, { status: 'skipped', reason: 'no-files' });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflow(svc);
    await svc.review();

    const msg = await svc.finish();
    expect(msg).toContain('验证结果:');
    expect(msg).toContain('- 通过: npm test');
    expect(msg).toContain('未提交最终commit：未提供 --files，未自动提交');
    expect(msg).toContain('工作流回到待命状态');
    expect(msg).not.toContain('已提交最终commit');
    expect(await svc.status()).toBeNull();
  });

  it('finish在 cleanup 后若 CLAUDE.md 残留用户改动则拒绝最终提交', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValue(['CLAUDE.md']);
    const commitSpy = vi.spyOn(repo, 'commit');
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await completeWorkflow(svc);
    await writeFile(join(dir, 'CLAUDE.md'), `${await readFile(join(dir, 'CLAUDE.md'), 'utf-8')}User residue\n`, 'utf-8');
    await svc.review();

    const msg = await svc.finish();

    expect(msg).toContain('拒绝最终提交');
    expect(msg).toContain('CLAUDE.md');
    expect(commitSpy).not.toHaveBeenCalledWith('finish', expect.any(String), expect.any(String), expect.anything());
    expect((await svc.status())?.status).toBe('finishing');
  });

  it('finish在 cleanup 后若 .gitignore 残留用户改动则拒绝最终提交', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValue(['.gitignore']);
    const commitSpy = vi.spyOn(repo, 'commit');
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await completeWorkflow(svc);
    await writeFile(join(dir, '.gitignore'), `${await readFile(join(dir, '.gitignore'), 'utf-8')}dist/\n`, 'utf-8');
    await svc.review();

    const msg = await svc.finish();

    expect(msg).toContain('拒绝最终提交');
    expect(msg).toContain('.gitignore');
    expect(commitSpy).not.toHaveBeenCalledWith('finish', expect.any(String), expect.any(String), expect.anything());
    expect((await svc.status())?.status).toBe('finishing');
  });

  it('finish不会因跟踪中的预先脏 settings.json 在 cleanup 后恢复原始内容而误拒绝', async () => {
    await initGitRepo(dir);
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude', 'settings.json'), '{"model":"opus"}\n', 'utf-8');
    runGit(['add', '.claude/settings.json'], dir);
    runGit(['commit', '-m', 'track settings'], dir);

    const preWorkflowDirtyContent = '{"model":"opus","theme":"dark","hooks":{"PreToolUse":[{"matcher":"OtherTool","hooks":[{"type":"prompt","prompt":"keep me"}]}]}}';
    await writeFile(join(dir, '.claude', 'settings.json'), preWorkflowDirtyContent, 'utf-8');

    const repo = new FsWorkflowRepository(dir);
    vi.spyOn(repo, 'commit').mockReturnValue({ status: 'skipped', reason: 'no-files' });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await completeWorkflow(svc);
    await svc.review();

    const msg = await svc.finish();

    expect(msg).not.toContain('拒绝最终提交');
    expect(msg).toContain('未提交最终commit：未提供 --files，未自动提交');
    expect(await readFile(join(dir, '.claude', 'settings.json'), 'utf-8')).toBe(preWorkflowDirtyContent);
    expect((await svc.status())).toBeNull();
  });

  it('finish在 ignored/untracked settings.json cleanup 后仍有 residue 时也会拒绝最终提交', async () => {
    await initGitRepo(dir);
    await writeFile(join(dir, '.gitignore'), 'node_modules\n.claude/settings.json\n', 'utf-8');
    runGit(['add', '.gitignore'], dir);
    runGit(['commit', '-m', 'ignore settings'], dir);

    const repo = new FsWorkflowRepository(dir);
    const commitSpy = vi.spyOn(repo, 'commit').mockReturnValue({ status: 'skipped', reason: 'no-files' });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await completeWorkflow(svc);
    const settingsPath = join(dir, '.claude', 'settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
    await writeFile(settingsPath, JSON.stringify({
      ...settings,
      model: 'sonnet',
    }, null, 2) + '\n', 'utf-8');
    await svc.review();

    const msg = await svc.finish();

    expect(msg).toContain('拒绝最终提交');
    expect(msg).toContain('.claude/settings.json');
    expect(commitSpy).not.toHaveBeenCalledWith('finish', expect.any(String), expect.any(String), expect.anything());
    expect((await svc.status())?.status).toBe('finishing');
    expect(JSON.parse(await readFile(settingsPath, 'utf-8'))).toEqual({ model: 'sonnet' });
  });

  it('finish在存在 hook ownership 但缺少精确 settings baseline 时会 fail closed', async () => {
    await initGitRepo(dir);
    await writeFile(join(dir, '.gitignore'), 'node_modules\n.claude/settings.json\n', 'utf-8');
    runGit(['add', '.gitignore'], dir);
    runGit(['commit', '-m', 'ignore settings'], dir);

    const repo = new FsWorkflowRepository(dir);
    const commitSpy = vi.spyOn(repo, 'commit').mockReturnValue({ status: 'skipped', reason: 'no-files' });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await completeWorkflow(svc);
    const settingsPath = join(dir, '.claude', 'settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
    await writeFile(settingsPath, JSON.stringify({
      ...settings,
      model: 'sonnet',
    }, null, 2) + '\n', 'utf-8');

    const injectionsPath = join(dir, '.workflow', 'injections.json');
    const injections = JSON.parse(await readFile(injectionsPath, 'utf-8'));
    const { settingsBaseline: _missingBaseline, ...hooksWithoutBaseline } = injections.hooks;
    await writeFile(injectionsPath, JSON.stringify({
      ...injections,
      hooks: hooksWithoutBaseline,
    }, null, 2) + '\n', 'utf-8');
    await svc.review();

    const msg = await svc.finish();

    expect(msg).toContain('拒绝最终提交');
    expect(msg).toContain('.claude/settings.json');
    expect(commitSpy).not.toHaveBeenCalledWith('finish', expect.any(String), expect.any(String), expect.anything());
    expect((await svc.status())?.status).toBe('finishing');
    expect(JSON.parse(await readFile(settingsPath, 'utf-8'))).toEqual({ model: 'sonnet' });
  });

  it('finish会对称清理由 setup 创建且内容仍完整匹配的 CLAUDE.md、settings.json 和 .gitignore', async () => {
    const repo = new FsWorkflowRepository(dir);
    const changedFilesSpy = vi.spyOn(repo, 'listChangedFiles');
    changedFilesSpy.mockReturnValueOnce([]);
    changedFilesSpy.mockReturnValueOnce([]);
    mockCommitResult(repo, { status: 'skipped', reason: 'no-files' });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);

    await completeWorkflow(svc);
    await svc.review();

    await svc.finish();

    expect(await svc.status()).toBeNull();
    expect(await repo.loadProgress()).toBeNull();
    await expect(readFile(join(dir, 'CLAUDE.md'), 'utf-8')).rejects.toThrow();
    await expect(readFile(join(dir, '.claude', 'settings.json'), 'utf-8')).rejects.toThrow();
    expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe(LOCAL_STATE_GITIGNORE);
  });

  it('abort仅移除预存文件中的 FlowPilot 注入内容', async () => {
    await writeFile(join(dir, 'CLAUDE.md'), '# Custom\n\nKeep me.\n', 'utf-8');
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify({
      model: 'opus',
      hooks: {
        PreToolUse: [
          { matcher: 'OtherTool', hooks: [{ type: 'prompt', prompt: 'keep me' }] },
        ],
      },
    }, null, 2) + '\n', 'utf-8');
    await writeFile(join(dir, '.gitignore'), 'node_modules/\ncustom.log\n', 'utf-8');

    const repo = new FsWorkflowRepository(dir);
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await svc.init(TASKS_MD);

    const msg = await svc.abort();

    expect(msg).toContain('已中止');
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('# Custom\n\nKeep me.\n');
    expect(JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf-8'))).toEqual({
      model: 'opus',
      hooks: {
        PreToolUse: [
          { matcher: 'OtherTool', hooks: [{ type: 'prompt', prompt: 'keep me' }] },
        ],
      },
    });
    expect(await readFile(join(dir, '.gitignore'), 'utf-8')).toBe('node_modules/\ncustom.log\n');
    expect(await repo.loadProgress()).toBeNull();
  });

  it('finish在git失败时保留工作流并提示手动提交', async () => {
    const repo = new FsWorkflowRepository(dir);
    mockCommitResult(repo, { status: 'failed', error: 'git hooks failed' });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: [] });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflow(svc);
    await svc.review();

    const msg = await svc.finish();
    expect(msg).toContain('[git提交失败] git hooks failed');
    expect(msg).toContain('请根据错误修复后手动检查并提交需要的文件');
    expect(await svc.status()).not.toBeNull();
  });

  it('finish输出进化摘要可观测性', async () => {
    const repo = new FsWorkflowRepository(dir);
    mockChangedFiles(repo, []);
    mockCommitResult(repo, { status: 'skipped', reason: 'no-files' });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflow(svc);
    await svc.review();

    const msg = await svc.finish();

    expect(msg).toContain('进化摘要:');
    expect(msg).toContain('reflect: 已执行');
    expect(msg).toContain('experiment: 已执行');
    expect(msg).toContain('config变更: 是');
    expect(msg).toContain('变更键: parallelLimit');
  });

  it('finish在无实验时也输出未执行和无配置变更', async () => {
    const repo = new FsWorkflowRepository(dir);
    mockChangedFiles(repo, []);
    mockCommitResult(repo, { status: 'skipped', reason: 'no-files' });
    vi.spyOn(repo, 'verify').mockReturnValue({ passed: true, scripts: ['npm test'] });
    const reflectSpy = vi.spyOn(history, 'reflect').mockResolvedValue({
      timestamp: '2026-03-07T00:00:00.000Z',
      findings: [],
      experiments: [],
    });
    const experimentSpy = vi.spyOn(history, 'experiment');
    svc = new WorkflowService(repo, parseTasksMarkdown);
    await completeWorkflow(svc);
    await svc.review();

    const msg = await svc.finish();

    expect(msg).toContain('进化摘要:');
    expect(msg).toContain('reflect: 已执行');
    expect(msg).toContain('experiment: 未执行');
    expect(msg).toContain('config变更: 否');
    expect(msg).toContain('变更键: 无');
    expect(reflectSpy).toHaveBeenCalled();
    expect(experimentSpy).not.toHaveBeenCalled();
  });

  it('rollbackEvolution恢复历史config', async () => {
    await svc.init(TASKS_MD);
    const repo = new FsWorkflowRepository(dir);
    // Save initial evolution entry
    await repo.saveEvolution({
      timestamp: '2025-01-01T00:00:00Z',
      workflowName: 'test',
      configBefore: { maxRetries: 3 },
      configAfter: { maxRetries: 5 },
      suggestions: ['increase retries'],
    });
    // Save current config as the "after" state
    await repo.saveConfig({ maxRetries: 5 });

    // Find the index of our entry (last one with workflowName 'test')
    const allEvos = await repo.loadEvolutions();
    const targetIdx = allEvos.findIndex(e => e.workflowName === 'test');
    expect(targetIdx).toBeGreaterThanOrEqual(0);

    const msg = await svc.rollbackEvolution(targetIdx);
    expect(msg).toContain(`回滚到进化点 ${targetIdx}`);

    const config = await repo.loadConfig();
    expect(config.maxRetries).toBe(3);

    // Verify a rollback evolution entry was saved
    const evos = await repo.loadEvolutions();
    expect(evos.some(e => e.workflowName?.includes('rollback'))).toBe(true);
  });

  it('rollbackEvolution returns error for empty log', async () => {
    // Use a fresh service without init to avoid evolution side effects
    const freshDir = await mkdtemp(join(tmpdir(), 'flow-empty-'));
    const freshRepo = new FsWorkflowRepository(freshDir);
    const freshSvc = new WorkflowService(freshRepo, parseTasksMarkdown);
    await freshSvc.init(TASKS_MD);
    // Check if evolutions exist; if so, test with out-of-range index
    const evos = await freshRepo.loadEvolutions();
    if (evos.length === 0) {
      const msg = await freshSvc.rollbackEvolution(0);
      expect(msg).toContain('无进化日志');
    } else {
      const msg = await freshSvc.rollbackEvolution(evos.length + 10);
      expect(msg).toContain('索引越界');
    }
    await rm(freshDir, { recursive: true, force: true });
  });
});
