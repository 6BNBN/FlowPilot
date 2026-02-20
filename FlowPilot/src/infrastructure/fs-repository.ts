/**
 * @module infrastructure/fs-repository
 * @description 文件系统仓储 - 基于 .workflow/ 目录的分层记忆存储
 */

import { mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { openSync, closeSync, existsSync } from 'fs';
import type { ProgressData, TaskEntry } from '../domain/types';
import type { WorkflowRepository } from './repository';

/** 生成写入CLAUDE.md的规则块 */
function generateClaudeMdBlock(): string {
  return `<!-- flowpilot:start -->
## FlowPilot 工作流规则

遵循 .workflow/protocol.md 工作流调度协议。

### 禁止事项
- **禁止使用 TaskCreate/TaskUpdate/TaskList** — 只用 flow 命令管理任务
- **禁止主Agent写代码/读源码/改文件** — 禁止 Edit/Write/Read/Glob/Grep，全部交给子Agent

### 需求拆解
收到需求后，调用 /superpowers:brainstorming 头脑风暴，整理为任务列表后用 echo '...' | node flow.js init 写入。

### 子Agent规则
- 执行任务前，优先查找当前环境中匹配的技能(Skill)或MCP工具，有则必须使用
- type=frontend → 调用 /frontend-design 插件
- type=backend → 调用 /feature-dev 插件
- type=general → 查找匹配的技能/MCP，无匹配则直接执行
- 遇到不熟悉的库/框架API → 必须先用 context7 MCP 查询官方文档，禁止凭记忆猜测
- checkpoint后只回复"任务xxx已完成"，不要回传详细内容

### 代码安全规范（子Agent必须遵守）
- SQL注入：参数化查询，禁止拼接用户输入
- XSS：禁止v-html/innerHTML直接渲染用户输入，必须sanitize
- 认证：密钥从环境变量读取，密码bcrypt，Token设有效期
- 输入校验：入口层校验类型/长度/格式，文件上传校验MIME和大小
- 敏感数据：日志禁止明文密码，传输强制HTTPS，.env禁止提交Git

### 收尾
全部完成后用 Task 工具派子Agent调用 /code-review:code-review 审查变更，有问题修复后再 node flow.js finish。
<!-- flowpilot:end -->`;
}

export class FsWorkflowRepository implements WorkflowRepository {
  private readonly root: string;
  private readonly ctxDir: string;

  private readonly base: string;

  constructor(basePath: string) {
    this.base = basePath;
    this.root = join(basePath, '.workflow');
    this.ctxDir = join(this.root, 'context');
  }

  projectRoot(): string { return this.base; }

  private async ensure(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  /** 文件锁：用 O_EXCL 创建 lockfile，防止并发读写 */
  async lock(maxWait = 5000): Promise<void> {
    await this.ensure(this.root);
    const lockPath = join(this.root, '.lock');
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const fd = openSync(lockPath, 'wx');
        closeSync(fd);
        return;
      } catch {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    // 超时强制清除死锁
    try { await unlink(lockPath); } catch {}
  }

  async unlock(): Promise<void> {
    try { await unlink(join(this.root, '.lock')); } catch {}
  }

  // --- progress.md 读写 ---

  async saveProgress(data: ProgressData): Promise<void> {
    await this.ensure(this.root);
    const lines = [
      `# ${data.name}`,
      '',
      `状态: ${data.status}`,
      `当前: ${data.current ?? '无'}`,
      '',
      '| ID | 标题 | 类型 | 依赖 | 状态 | 重试 | 摘要 | 描述 |',
      '|----|------|------|------|------|------|------|------|',
    ];
    for (const t of data.tasks) {
      const deps = t.deps.length ? t.deps.join(',') : '-';
      const esc = (s: string) => (s || '-').replace(/\|/g, '∣').replace(/\n/g, ' ');
      lines.push(`| ${t.id} | ${esc(t.title)} | ${t.type} | ${deps} | ${t.status} | ${t.retries} | ${esc(t.summary)} | ${esc(t.description)} |`);
    }
    await writeFile(join(this.root, 'progress.md'), lines.join('\n') + '\n', 'utf-8');
  }

  async loadProgress(): Promise<ProgressData | null> {
    try {
      const raw = await readFile(join(this.root, 'progress.md'), 'utf-8');
      return this.parseProgress(raw);
    } catch {
      return null;
    }
  }

  private parseProgress(raw: string): ProgressData {
    const lines = raw.split('\n');
    const name = (lines[0] ?? '').replace(/^#\s*/, '').trim();
    let status = 'idle' as ProgressData['status'];
    let current: string | null = null;
    const tasks: TaskEntry[] = [];

    for (const line of lines) {
      if (line.startsWith('状态: ')) status = line.slice(4).trim() as ProgressData['status'];
      if (line.startsWith('当前: ')) current = line.slice(4).trim();
      if (current === '无') current = null;

      const m = line.match(/^\|\s*(\d{3})\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|\s*([^|]*?)\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/);
      if (m) {
        const depsRaw = m[4].trim();
        tasks.push({
          id: m[1], title: m[2], type: m[3] as TaskEntry['type'],
          deps: depsRaw === '-' ? [] : depsRaw.split(',').map(d => d.trim()),
          status: m[5] as TaskEntry['status'],
          retries: parseInt(m[6], 10),
          summary: m[7] === '-' ? '' : m[7],
          description: m[8] === '-' ? '' : m[8],
        });
      }
    }

    // 从 tasks.md 补充 deps 信息
    return { name, status, current, tasks };
  }

  // --- context/ 任务详细产出 ---

  async saveTaskContext(taskId: string, content: string): Promise<void> {
    await this.ensure(this.ctxDir);
    await writeFile(join(this.ctxDir, `task-${taskId}.md`), content, 'utf-8');
  }

  async loadTaskContext(taskId: string): Promise<string | null> {
    try {
      return await readFile(join(this.ctxDir, `task-${taskId}.md`), 'utf-8');
    } catch {
      return null;
    }
  }

  // --- summary.md ---

  async saveSummary(content: string): Promise<void> {
    await this.ensure(this.ctxDir);
    await writeFile(join(this.ctxDir, 'summary.md'), content, 'utf-8');
  }

  async loadSummary(): Promise<string> {
    try {
      return await readFile(join(this.ctxDir, 'summary.md'), 'utf-8');
    } catch {
      return '';
    }
  }

  // --- protocol.md / tasks.md ---

  async saveProtocol(content: string): Promise<void> {
    await this.ensure(this.root);
    await writeFile(join(this.root, 'protocol.md'), content, 'utf-8');
  }

  async saveTasks(content: string): Promise<void> {
    await this.ensure(this.root);
    await writeFile(join(this.root, 'tasks.md'), content, 'utf-8');
  }

  async loadTasks(): Promise<string | null> {
    try {
      return await readFile(join(this.root, 'tasks.md'), 'utf-8');
    } catch {
      return null;
    }
  }

  async ensureClaudeMd(): Promise<boolean> {
    const base = join(this.root, '..');
    const path = join(base, 'CLAUDE.md');
    const marker = '<!-- flowpilot:start -->';
    const block = generateClaudeMdBlock();
    try {
      const content = await readFile(path, 'utf-8');
      if (content.includes(marker)) return false;
      await writeFile(path, content.trimEnd() + '\n\n' + block + '\n', 'utf-8');
    } catch {
      await writeFile(path, '# Project\n\n' + block + '\n', 'utf-8');
    }
    return true;
  }
}
