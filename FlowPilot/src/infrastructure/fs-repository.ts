/**
 * @module infrastructure/fs-repository
 * @description 文件系统仓储 - 基于 .workflow/ 目录的分层记忆存储
 */

import { mkdir, readFile, writeFile, unlink, rm, rename, readdir } from 'fs/promises';
import { join } from 'path';
import { openSync, closeSync } from 'fs';
import type { ProgressData, TaskEntry, WorkflowStats, EvolutionEntry } from '../domain/types';
import type { WorkflowRepository, VerifyResult, CommitResult } from '../domain/repository';
import { autoCommit, gitCleanup, tagTask, rollbackToTask, cleanTags as gitCleanTags, listChangedFiles as gitListChangedFiles } from './git';
import { runVerify } from './verify';
import { PROTOCOL_TEMPLATE } from './protocol-template';

/** 读取协议模板：优先 .workflow/config.json 的 protocolTemplate，其次内置模板 */
async function loadProtocolTemplate(basePath: string): Promise<string> {
  try {
    const config = JSON.parse(await readFile(join(basePath, '.workflow', 'config.json'), 'utf-8'));
    if (config.protocolTemplate) {
      return await readFile(join(basePath, config.protocolTemplate), 'utf-8');
    }
  } catch {}
  return PROTOCOL_TEMPLATE;
}

export class FsWorkflowRepository implements WorkflowRepository {
  private readonly root: string;
  private readonly ctxDir: string;
  private readonly historyDir: string;
  private readonly evolutionDir: string;
  private readonly base: string;

  constructor(basePath: string) {
    this.base = basePath;
    this.root = join(basePath, '.workflow');
    this.ctxDir = join(this.root, 'context');
    this.historyDir = join(basePath, '.flowpilot', 'history');
    this.evolutionDir = join(basePath, '.flowpilot', 'evolution');
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
      ...(data.startTime ? [`开始: ${data.startTime}`] : []),
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
    let startTime: string | undefined;
    const tasks: TaskEntry[] = [];

    for (const line of lines) {
      if (line.startsWith('状态: ')) {
        const s = line.slice(4).trim();
        status = (validWfStatus.has(s) ? s : 'idle') as ProgressData['status'];
      }
      if (line.startsWith('当前: ')) current = line.slice(4).trim();
      if (current === '无') current = null;
      if (line.startsWith('开始: ')) startTime = line.slice(4).trim();

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
    return { name, status, current, tasks, ...(startTime ? { startTime } : {}) };
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

    let settings: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(await readFile(path, 'utf-8'));
      if (
        parsed
        && typeof parsed === 'object'
        && !Array.isArray(parsed)
        && !Object.prototype.hasOwnProperty.call(parsed, '__proto__')
        && !Object.prototype.hasOwnProperty.call(parsed, 'constructor')
      ) {
        settings = parsed;
      }
    } catch {}

    const hook = (matcher: string) => ({
      matcher,
      hooks: [{ type: 'prompt' as const, prompt: 'BLOCK this tool call. FlowPilot requires using node flow.js commands instead of native task tools.' }]
    });
    const requiredPreToolUse = [hook('TaskCreate'), hook('TaskUpdate'), hook('TaskList')];
    const currentHooks = settings.hooks;
    const hooks = currentHooks && typeof currentHooks === 'object' && !Array.isArray(currentHooks)
      ? currentHooks as Record<string, unknown>
      : {};
    const currentPreToolUse = hooks.PreToolUse;
    const existingPreToolUse = Array.isArray(currentPreToolUse)
      ? currentPreToolUse as Array<{ matcher?: string }>
      : [];
    const existingMatchers = new Set(existingPreToolUse
      .map(entry => entry.matcher)
      .filter((matcher): matcher is string => Boolean(matcher)));
    const missingPreToolUse = requiredPreToolUse.filter(entry => !existingMatchers.has(entry.matcher));
    if (!missingPreToolUse.length) return false;

    const nextSettings = {
      ...settings,
      hooks: {
        ...hooks,
        PreToolUse: [...existingPreToolUse, ...missingPreToolUse],
      },
    };

    await this.ensure(dir);
    await writeFile(path, JSON.stringify(nextSettings, null, 2) + '\n', 'utf-8');
    return true;
  }

  async ensureClaudeWorktreesIgnored(): Promise<boolean> {
    const path = join(this.base, '.gitignore');
    const rule = '.claude/worktrees/';

    try {
      const content = await readFile(path, 'utf-8');
      const hasRule = content.split(/\r?\n/).some(line => line.trimEnd() === rule);
      if (hasRule) return false;

      const nextContent = content.length === 0
        ? `${rule}\n`
        : `${content}${content.endsWith('\n') ? '' : '\n'}${rule}\n`;
      await writeFile(path, nextContent, 'utf-8');
      return true;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      await writeFile(path, `${rule}\n`, 'utf-8');
      return true;
    }
  }

  listChangedFiles(): string[] {
    return gitListChangedFiles(this.base);
  }

  commit(taskId: string, title: string, summary: string, files?: string[]): CommitResult {
    return autoCommit(taskId, title, summary, files, this.base);
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

  /** 清理注入的 CLAUDE.md 协议块；运行期不回写 .claude/* */
  async cleanupInjections(): Promise<void> {
    const mdPath = join(this.base, 'CLAUDE.md');
    try {
      const content = await readFile(mdPath, 'utf-8');
      const cleaned = content.replace(/\n*<!-- flowpilot:start -->[\s\S]*?<!-- flowpilot:end -->\n*/g, '\n');
      if (cleaned !== content) await writeFile(mdPath, cleaned.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', 'utf-8');
    } catch {}
  }

  tag(taskId: string): string | null { return tagTask(taskId, this.base); }
  rollback(taskId: string): string | null { return rollbackToTask(taskId, this.base); }
  cleanTags(): void { gitCleanTags(this.base); }

  // --- .flowpilot/evolution/ 进化日志 ---

  async saveEvolution(entry: EvolutionEntry): Promise<void> {
    await this.ensure(this.evolutionDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(join(this.evolutionDir, `${ts}.json`), JSON.stringify(entry, null, 2), 'utf-8');
  }

  async loadEvolutions(): Promise<EvolutionEntry[]> {
    try {
      const files = (await readdir(this.evolutionDir)).filter(f => f.endsWith('.json')).sort();
      const results: EvolutionEntry[] = [];
      for (const f of files) {
        try { results.push(JSON.parse(await readFile(join(this.evolutionDir, f), 'utf-8'))); } catch {}
      }
      return results;
    } catch { return []; }
  }
}
