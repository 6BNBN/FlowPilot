/**
 * @module infrastructure/fs-repository
 * @description 文件系统仓储 - 基于 .workflow/ 目录的分层记忆存储
 */

import { mkdir, readFile, writeFile, unlink, rm, rename, readdir } from 'fs/promises';
import { join } from 'path';
import { openSync, closeSync, existsSync } from 'fs';
import type { ProgressData, TaskEntry, WorkflowStats } from '../domain/types';
import type { WorkflowRepository, VerifyResult } from '../domain/repository';
import { autoCommit, gitCleanup, tagTask, rollbackToTask, cleanTags as gitCleanTags } from './git';
import { runVerify } from './verify';

/** 内置模板路径：dev 时 __dirname=src/infrastructure/，打包后 __dirname=dist/ */
const BUILTIN_TEMPLATE = existsSync(join(__dirname, '..', 'templates', 'protocol.md'))
  ? join(__dirname, '..', 'templates', 'protocol.md')
  : join(__dirname, 'templates', 'protocol.md');

/** 读取协议模板：优先 .workflow/config.json 的 protocolTemplate，其次内置模板 */
async function loadProtocolTemplate(basePath: string): Promise<string> {
  try {
    const config = JSON.parse(await readFile(join(basePath, '.workflow', 'config.json'), 'utf-8'));
    if (config.protocolTemplate) {
      return await readFile(join(basePath, config.protocolTemplate), 'utf-8');
    }
  } catch {}
  return await readFile(BUILTIN_TEMPLATE, 'utf-8');
}

export class FsWorkflowRepository implements WorkflowRepository {
  private readonly root: string;
  private readonly ctxDir: string;
  private readonly historyDir: string;
  private readonly base: string;

  constructor(basePath: string) {
    this.base = basePath;
    this.root = join(basePath, '.workflow');
    this.ctxDir = join(this.root, 'context');
    this.historyDir = join(basePath, '.flowpilot', 'history');
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
    // 超时强制清除死锁，再尝试一次
    try { await unlink(lockPath); } catch {}
    try {
      const fd = openSync(lockPath, 'wx');
      closeSync(fd);
      return;
    } catch {
      throw new Error('无法获取文件锁');
    }
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
    const p = join(this.root, 'progress.md');
    await writeFile(p + '.tmp', lines.join('\n') + '\n', 'utf-8');
    await rename(p + '.tmp', p);
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
    const validWfStatus = new Set(['idle', 'running', 'finishing', 'completed', 'aborted']);
    const validTaskStatus = new Set(['pending', 'active', 'done', 'skipped', 'failed']);
    const lines = raw.split('\n');
    const name = (lines[0] ?? '').replace(/^#\s*/, '').trim();
    let status = 'idle' as ProgressData['status'];
    let current: string | null = null;
    const tasks: TaskEntry[] = [];

    for (const line of lines) {
      if (line.startsWith('状态: ')) {
        const s = line.slice(4).trim();
        status = (validWfStatus.has(s) ? s : 'idle') as ProgressData['status'];
      }
      if (line.startsWith('当前: ')) current = line.slice(4).trim();
      if (current === '无') current = null;

      const m = line.match(/^\|\s*(\d{3,})\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|\s*([^|]*?)\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/);
      if (m) {
        const depsRaw = m[4].trim();
        tasks.push({
          id: m[1], title: m[2], type: m[3] as TaskEntry['type'],
          deps: depsRaw === '-' ? [] : depsRaw.split(',').map(d => d.trim()),
          status: (validTaskStatus.has(m[5]) ? m[5] : 'pending') as TaskEntry['status'],
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

  async clearContext(): Promise<void> {
    await rm(this.ctxDir, { recursive: true, force: true });
  }

  async clearAll(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  async saveTaskContext(taskId: string, content: string): Promise<void> {
    await this.ensure(this.ctxDir);
    const p = join(this.ctxDir, `task-${taskId}.md`);
    await writeFile(p + '.tmp', content, 'utf-8');
    await rename(p + '.tmp', p);
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
    const p = join(this.ctxDir, 'summary.md');
    await writeFile(p + '.tmp', content, 'utf-8');
    await rename(p + '.tmp', p);
  }

  async loadSummary(): Promise<string> {
    try {
      return await readFile(join(this.ctxDir, 'summary.md'), 'utf-8');
    } catch {
      return '';
    }
  }

  // --- tasks.md ---

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
    const block = (await loadProtocolTemplate(this.base)).trim();
    try {
      const content = await readFile(path, 'utf-8');
      if (content.includes(marker)) return false;
      await writeFile(path, content.trimEnd() + '\n\n' + block + '\n', 'utf-8');
    } catch {
      await writeFile(path, '# Project\n\n' + block + '\n', 'utf-8');
    }
    return true;
  }

  async ensureHooks(): Promise<boolean> {
    const dir = join(this.base, '.claude');
    const path = join(dir, 'settings.json');
    const hook = (m: string) => ({
      matcher: m,
      hooks: [{ type: 'prompt' as const, prompt: 'BLOCK this tool call. FlowPilot requires using node flow.js commands instead of native task tools.' }]
    });
    const required = {
      PreToolUse: [hook('TaskCreate'), hook('TaskUpdate'), hook('TaskList')]
    };
    let settings: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(await readFile(path, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !('__proto__' in parsed) && !('constructor' in parsed)) settings = parsed;
    } catch {}
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    // 幂等：已有 FlowPilot 的 matcher 则跳过
    const existing = hooks.PreToolUse as Array<{ matcher?: string }> | undefined;
    if (existing?.some(h => h.matcher === required.PreToolUse[0].matcher)) return false;
    hooks.PreToolUse = [...(existing ?? []), ...required.PreToolUse];
    settings.hooks = hooks;
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    return true;
  }

  commit(taskId: string, title: string, summary: string, files?: string[]): string | null {
    return autoCommit(taskId, title, summary, files);
  }

  cleanup(): void {
    gitCleanup();
  }

  verify(): VerifyResult {
    return runVerify(this.base);
  }

  // --- .flowpilot/history/ 永久存储 ---

  async saveHistory(stats: WorkflowStats): Promise<void> {
    await this.ensure(this.historyDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const p = join(this.historyDir, `${ts}.json`);
    await writeFile(p, JSON.stringify(stats, null, 2), 'utf-8');
  }

  async loadHistory(): Promise<WorkflowStats[]> {
    try {
      const files = (await readdir(this.historyDir)).filter(f => f.endsWith('.json')).sort();
      const results: WorkflowStats[] = [];
      for (const f of files) {
        try {
          results.push(JSON.parse(await readFile(join(this.historyDir, f), 'utf-8')));
        } catch { /* 跳过损坏文件 */ }
      }
      return results;
    } catch {
      return [];
    }
  }

  // --- .workflow/config.json ---

  async loadConfig(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await readFile(join(this.root, 'config.json'), 'utf-8'));
    } catch {
      return {};
    }
  }

  async saveConfig(config: Record<string, unknown>): Promise<void> {
    await this.ensure(this.root);
    await writeFile(join(this.root, 'config.json'), JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }

  /** 清理注入的CLAUDE.md协议块和.claude/settings.json hooks */
  async cleanupInjections(): Promise<void> {
    // 1) 移除 CLAUDE.md 中 flowpilot:start/end 块
    const mdPath = join(this.base, 'CLAUDE.md');
    try {
      const content = await readFile(mdPath, 'utf-8');
      const cleaned = content.replace(/\n*<!-- flowpilot:start -->[\s\S]*?<!-- flowpilot:end -->\n*/g, '\n');
      if (cleaned !== content) await writeFile(mdPath, cleaned.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', 'utf-8');
    } catch {}

    // 2) 移除 .claude/settings.json 中 FlowPilot 注入的 PreToolUse hooks
    const settingsPath = join(this.base, '.claude', 'settings.json');
    try {
      const raw = await readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      const hooks = settings.hooks?.PreToolUse as Array<{ matcher?: string }> | undefined;
      if (hooks) {
        const flowpilotMatchers = new Set(['TaskCreate', 'TaskUpdate', 'TaskList']);
        settings.hooks.PreToolUse = hooks.filter(h => !flowpilotMatchers.has(h.matcher ?? ''));
        if (!settings.hooks.PreToolUse.length) delete settings.hooks.PreToolUse;
        if (!Object.keys(settings.hooks).length) delete settings.hooks;
        await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      }
    } catch {}
  }

  tag(taskId: string): string | null { return tagTask(taskId); }
  rollback(taskId: string): string | null { return rollbackToTask(taskId); }
  cleanTags(): void { gitCleanTags(); }
}
