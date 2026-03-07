/**
 * @module infrastructure/fs-repository
 * @description 文件系统仓储 - 基于 .workflow/.flowpilot 目录的分层记忆存储
 */

import { mkdir, readFile, writeFile, unlink, rm, rename, readdir, stat, access, rmdir } from 'fs/promises';
import { join } from 'path';
import { openSync, closeSync, writeFileSync } from 'fs';
import { hostname } from 'os';
import type { ProgressData, TaskEntry, WorkflowStats, EvolutionEntry } from '../domain/types';
import type { WorkflowRepository, VerifyResult, CommitResult } from '../domain/repository';
import { autoCommit, gitCleanup, tagTask, rollbackToTask, cleanTags as gitCleanTags, listChangedFiles as gitListChangedFiles } from './git';
import { runVerify } from './verify';
import { PROTOCOL_TEMPLATE } from './protocol-template';
import {
  createRuntimeLockMetadata,
  defaultInvalidLockStaleAfterMs,
  getRuntimeLocalityToken,
  isRuntimeLockOwnedByProcess,
  isRuntimeLockStale,
  loadSetupInjectionManifest,
  mergeSetupInjectionManifest,
  parseRuntimeLock,
  serializeRuntimeLock,
} from './runtime-state';
import type { ExactFileSnapshot, HookEntry, SetupInjectionManifest } from './runtime-state';

const PERSISTENT_DIR = '.flowpilot';
const LEGACY_RUNTIME_DIR = '.workflow';
const CONFIG_FILE = 'config.json';

const VALID_WORKFLOW_STATUS = new Set(['idle', 'running', 'finishing', 'completed', 'aborted']);
const VALID_TASK_STATUS = new Set(['pending', 'active', 'done', 'skipped', 'failed']);

/** 解析 progress.md 文本为工作流状态 */
export function parseProgressMarkdown(raw: string): ProgressData {
  const lines = raw.split('\n');
  const name = (lines[0] ?? '').replace(/^#\s*/, '').trim();
  let status = 'idle' as ProgressData['status'];
  let current: string | null = null;
  let startTime: string | undefined;
  const tasks: TaskEntry[] = [];

  for (const line of lines) {
    if (line.startsWith('状态: ')) {
      const parsedStatus = line.slice(4).trim();
      status = (VALID_WORKFLOW_STATUS.has(parsedStatus) ? parsedStatus : 'idle') as ProgressData['status'];
    }
    if (line.startsWith('当前: ')) current = line.slice(4).trim();
    if (current === '无') current = null;
    if (line.startsWith('开始: ')) startTime = line.slice(4).trim();

    const matchedTask = line.match(/^\|\s*(\d{3,})\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|\s*([^|]*?)\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/);
    if (matchedTask) {
      const depsRaw = matchedTask[4].trim();
      tasks.push({
        id: matchedTask[1],
        title: matchedTask[2],
        type: matchedTask[3] as TaskEntry['type'],
        deps: depsRaw === '-' ? [] : depsRaw.split(',').map(dep => dep.trim()),
        status: (VALID_TASK_STATUS.has(matchedTask[5]) ? matchedTask[5] : 'pending') as TaskEntry['status'],
        retries: parseInt(matchedTask[6], 10),
        summary: matchedTask[7] === '-' ? '' : matchedTask[7],
        description: matchedTask[8] === '-' ? '' : matchedTask[8],
      });
    }
  }

  return { name, status, current, tasks, ...(startTime ? { startTime } : {}) };
}

async function readConfigFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readPersistedConfig(basePath: string): Promise<Record<string, unknown> | null> {
  const currentConfig = await readConfigFile(join(basePath, PERSISTENT_DIR, CONFIG_FILE));
  if (currentConfig) return currentConfig;
  return readConfigFile(join(basePath, LEGACY_RUNTIME_DIR, CONFIG_FILE));
}

/** 读取协议模板：优先 .flowpilot/config.json，兼容旧的 .workflow/config.json */
async function loadProtocolTemplate(basePath: string): Promise<string> {
  const config = await readPersistedConfig(basePath);
  const protocolTemplate = config?.protocolTemplate;
  if (typeof protocolTemplate === 'string' && protocolTemplate.length > 0) {
    try {
      return await readFile(join(basePath, protocolTemplate), 'utf-8');
    } catch {}
  }
  return PROTOCOL_TEMPLATE;
}

function hookEntry(matcher: string): HookEntry {
  return {
    matcher,
    hooks: [{ type: 'prompt', prompt: 'BLOCK this tool call. FlowPilot requires using node flow.js commands instead of native task tools.' }],
  };
}

type CleanupEffect =
  | { effect: 'noop' }
  | { effect: 'write'; content: string }
  | { effect: 'delete' };

function dedupeHookEntries(entries: HookEntry[]): HookEntry[] {
  const seen = new Set<string>();
  const result: HookEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.matcher)) continue;
    seen.add(entry.matcher);
    result.push({
      matcher: entry.matcher,
      hooks: entry.hooks.map(hook => ({ type: hook.type, prompt: hook.prompt })),
    });
  }
  return result;
}

function isHookEntry(value: unknown): value is HookEntry {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as HookEntry).matcher === 'string'
    && Array.isArray((value as HookEntry).hooks)
    && (value as HookEntry).hooks.every(hook => Boolean(hook) && typeof hook.type === 'string' && typeof hook.prompt === 'string');
}

function serializeHookEntry(entry: HookEntry): string {
  return JSON.stringify({
    matcher: entry.matcher,
    hooks: entry.hooks.map(hook => ({ type: hook.type, prompt: hook.prompt })),
  });
}

function normalizeCleanupContent(content: string): string {
  if (content.trim().length === 0) {
    return '';
  }
  return content.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function cleanupClaudeContent(content: string, manifest: SetupInjectionManifest): CleanupEffect {
  const claude = manifest.claudeMd;
  if (!claude || claude.block.length === 0 || !content.includes(claude.block)) {
    return { effect: 'noop' };
  }

  let next = content.replace(claude.block, '');
  if (claude.created && claude.scaffold && next.startsWith(claude.scaffold)) {
    next = next.slice(claude.scaffold.length);
  }

  const normalized = normalizeCleanupContent(next);
  if (normalized.length === 0) {
    return { effect: 'delete' };
  }

  return normalized === content ? { effect: 'noop' } : { effect: 'write', content: normalized };
}

function cleanupHookSettings(settings: Record<string, unknown>, manifest: SetupInjectionManifest): CleanupEffect {
  const hooksManifest = manifest.hooks;
  if (!hooksManifest) return { effect: 'noop' };

  const settingsHooks = settings.hooks;
  const hooks = settingsHooks && typeof settingsHooks === 'object' && !Array.isArray(settingsHooks)
    ? settingsHooks as Record<string, unknown>
    : {};
  const currentPreToolUse = hooks.PreToolUse;
  const existingPreToolUse = Array.isArray(currentPreToolUse)
    ? currentPreToolUse.filter(isHookEntry)
    : [];

  const ownedCounts = hooksManifest.preToolUse.reduce<Map<string, number>>((counts, entry) => {
    const key = serializeHookEntry(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  const remainingPreToolUse = existingPreToolUse.filter((entry) => {
    const key = serializeHookEntry(entry);
    const remaining = ownedCounts.get(key) ?? 0;
    if (remaining === 0) return true;
    ownedCounts.set(key, remaining - 1);
    return false;
  });

  const nextHooks: Record<string, unknown> = { ...hooks };
  if (remainingPreToolUse.length > 0) {
    nextHooks.PreToolUse = remainingPreToolUse;
  } else {
    delete nextHooks.PreToolUse;
  }

  const nextSettings: Record<string, unknown> = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    nextSettings.hooks = nextHooks;
  } else {
    delete nextSettings.hooks;
  }

  if (hooksManifest.created && Object.keys(nextSettings).length === 0) {
    return { effect: 'delete' };
  }

  const serializedCurrent = JSON.stringify(settings, null, 2) + '\n';
  const baselineRaw = hooksManifest.settingsBaseline?.rawContent;
  if (hooksManifest.settingsBaseline?.exists && baselineRaw !== undefined) {
    try {
      const parsedBaseline = JSON.parse(baselineRaw);
      if (JSON.stringify(parsedBaseline) === JSON.stringify(nextSettings)) {
        return baselineRaw === serializedCurrent ? { effect: 'noop' } : { effect: 'write', content: baselineRaw };
      }
    } catch {}
  }

  const serializedNext = JSON.stringify(nextSettings, null, 2) + '\n';
  return serializedNext === serializedCurrent ? { effect: 'noop' } : { effect: 'write', content: serializedNext };
}

function isExactFileSnapshotEqual(snapshot: ExactFileSnapshot | undefined, current: ExactFileSnapshot): boolean {
  if (!snapshot) return false;
  if (snapshot.exists !== current.exists) return false;
  if (!snapshot.exists) return true;
  return snapshot.rawContent === current.rawContent;
}

function cleanupGitignoreContent(content: string, manifest: SetupInjectionManifest): CleanupEffect {
  const gitignore = manifest.gitignore;
  if (!gitignore) return { effect: 'noop' };

  const ownedRules = new Set(gitignore.rules.map(rule => rule.trimEnd()));
  let removed = false;
  const remainingLines = content
    .split(/\r?\n/)
    .filter((line) => {
      if (ownedRules.has(line.trimEnd())) {
        removed = true;
        return false;
      }
      return true;
    });

  if (!removed) {
    return { effect: 'noop' };
  }

  while (remainingLines.length > 0 && remainingLines[remainingLines.length - 1] === '') {
    remainingLines.pop();
  }

  const normalized = remainingLines.length > 0 ? `${remainingLines.join('\n')}\n` : '';
  if (normalized.length === 0) {
    return { effect: 'noop' };
  }
  return normalized === content ? { effect: 'noop' } : { effect: 'write', content: normalized };
}

export class FsWorkflowRepository implements WorkflowRepository {
  private readonly root: string;
  private readonly ctxDir: string;
  private readonly historyDir: string;
  private readonly evolutionDir: string;
  private readonly configDir: string;
  private readonly base: string;

  private async snapshotExactFile(path: string): Promise<ExactFileSnapshot> {
    try {
      return {
        exists: true,
        rawContent: await readFile(path, 'utf-8'),
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return { exists: false };
      }
      throw error;
    }
  }

  constructor(basePath: string) {
    this.base = basePath;
    this.root = join(basePath, LEGACY_RUNTIME_DIR);
    this.ctxDir = join(this.root, 'context');
    this.configDir = join(basePath, PERSISTENT_DIR);
    this.historyDir = join(basePath, PERSISTENT_DIR, 'history');
    this.evolutionDir = join(basePath, PERSISTENT_DIR, 'evolution');
  }

  projectRoot(): string { return this.base; }

  private async ensure(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: any) {
      if (error?.code === 'ESRCH') return false;
      return true;
    }
  }

  private async reclaimStaleLock(lockPath: string): Promise<boolean> {
    try {
      const [raw, fileStat] = await Promise.all([
        readFile(lockPath, 'utf-8'),
        stat(lockPath),
      ]);
      const parsed = parseRuntimeLock(raw);
      const decision = isRuntimeLockStale({
        parsed,
        fileAgeMs: Date.now() - fileStat.mtimeMs,
        staleAfterMs: defaultInvalidLockStaleAfterMs(),
        isProcessAlive: pid => this.isProcessAlive(pid),
        currentHostname: hostname(),
        currentLocalityToken: getRuntimeLocalityToken(),
      });
      if (!decision.stale) return false;
      await unlink(lockPath);
      return true;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return true;
      return false;
    }
  }

  private async describeLockFailure(lockPath: string): Promise<string> {
    try {
      const raw = await readFile(lockPath, 'utf-8');
      const parsed = parseRuntimeLock(raw);
      if (!parsed.valid) return '无法获取文件锁：现有锁元数据无效且未达到安全回收条件';
      const ageMs = Math.max(0, Date.now() - Date.parse(parsed.metadata.createdAt));
      if (parsed.metadata.hostname === hostname() && parsed.metadata.localityToken === undefined) {
        return '无法获取文件锁：同主机锁缺少可证明本地性的元数据，拒绝盲目回收';
      }
      return `无法获取文件锁：当前由 pid ${parsed.metadata.pid} 在 ${parsed.metadata.hostname} 上持有，已存在 ${ageMs}ms`;
    } catch {
      return '无法获取文件锁';
    }
  }

  /** 文件锁：用 O_EXCL 创建 lockfile，防止并发读写 */
  async lock(maxWait = 5000): Promise<void> {
    await this.ensure(this.root);
    const lockPath = join(this.root, '.lock');
    const start = Date.now();
    const tryAcquire = async (): Promise<boolean> => {
      let fd: number;
      try {
        fd = openSync(lockPath, 'wx');
      } catch (error: any) {
        if (error?.code === 'EEXIST') return false;
        throw error;
      }

      try {
        const payload = serializeRuntimeLock(createRuntimeLockMetadata());
        writeFileSync(fd, payload, 'utf-8');
      } catch (error) {
        try {
          closeSync(fd);
        } catch {}
        try {
          await unlink(lockPath);
        } catch {}
        throw error;
      }

      try {
        closeSync(fd);
        return true;
      } catch (error) {
        try {
          await unlink(lockPath);
        } catch {}
        throw error;
      }
    };

    while (Date.now() - start < maxWait) {
      if (await tryAcquire()) return;
      await new Promise(r => setTimeout(r, 50));
    }

    const reclaimed = await this.reclaimStaleLock(lockPath);
    if (reclaimed && await tryAcquire()) return;

    throw new Error(await this.describeLockFailure(lockPath));
  }

  async unlock(): Promise<void> {
    const lockPath = join(this.root, '.lock');
    try {
      const raw = await readFile(lockPath, 'utf-8');
      const parsed = parseRuntimeLock(raw);
      if (!isRuntimeLockOwnedByProcess(parsed)) return;
      await unlink(lockPath);
    } catch {}
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
      return parseProgressMarkdown(raw);
    } catch {
      return null;
    }
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
    let created = false;
    let scaffold = '';
    try {
      const content = await readFile(path, 'utf-8');
      if (content.includes(marker)) return false;
      await writeFile(path, content.trimEnd() + '\n\n' + block + '\n', 'utf-8');
    } catch {
      created = true;
      scaffold = '# Project\n\n';
      await writeFile(path, `${scaffold}${block}\n`, 'utf-8');
    }
    await mergeSetupInjectionManifest(this.base, {
      claudeMd: {
        created,
        block,
        ...(created ? { scaffold } : {}),
      },
    });
    return true;
  }

  async ensureHooks(): Promise<boolean> {
    const dir = join(this.base, '.claude');
    const path = join(dir, 'settings.json');
    const settingsBaseline = await this.snapshotExactFile(path);

    let settings: Record<string, unknown> = {};
    let created = false;
    try {
      const parsed = JSON.parse(settingsBaseline.rawContent ?? '');
      if (
        parsed
        && typeof parsed === 'object'
        && !Array.isArray(parsed)
        && !Object.prototype.hasOwnProperty.call(parsed, '__proto__')
        && !Object.prototype.hasOwnProperty.call(parsed, 'constructor')
      ) {
        settings = parsed;
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT' || !settingsBaseline.exists) created = true;
    }
    if (!settingsBaseline.exists) {
      created = true;
    }

    const requiredPreToolUse = [hookEntry('TaskCreate'), hookEntry('TaskUpdate'), hookEntry('TaskList')];
    const currentHooks = settings.hooks;
    const hooks = currentHooks && typeof currentHooks === 'object' && !Array.isArray(currentHooks)
      ? currentHooks as Record<string, unknown>
      : {};
    const currentPreToolUse = hooks.PreToolUse;
    const existingPreToolUse = Array.isArray(currentPreToolUse)
      ? currentPreToolUse as HookEntry[]
      : [];
    const existingMatchers = new Set(existingPreToolUse
      .map(entry => entry.matcher)
      .filter((matcher): matcher is string => Boolean(matcher)));
    const missingPreToolUse = requiredPreToolUse.filter(entry => !existingMatchers.has(entry.matcher));
    if (!created && !missingPreToolUse.length) return false;

    const nextSettings = {
      ...settings,
      hooks: {
        ...hooks,
        PreToolUse: dedupeHookEntries([...existingPreToolUse, ...missingPreToolUse]),
      },
    };

    await this.ensure(dir);
    await writeFile(path, JSON.stringify(nextSettings, null, 2) + '\n', 'utf-8');
    if (missingPreToolUse.length > 0 || created) {
      await mergeSetupInjectionManifest(this.base, {
        hooks: {
          created,
          preToolUse: missingPreToolUse,
          settingsBaseline,
        },
      });
    }
    return true;
  }

  async ensureLocalStateIgnored(): Promise<boolean> {
    const path = join(this.base, '.gitignore');
    const rules = ['.workflow/', '.flowpilot/', '.claude/settings.json', '.claude/worktrees/'];
    const baseline = await this.snapshotExactFile(path);
    let created = false;

    try {
      const content = await readFile(path, 'utf-8');
      const lines = content.split(/\r?\n/);
      const existingRules = new Set(lines.map(line => line.trimEnd()));
      const missingRules = rules.filter(rule => !existingRules.has(rule));
      if (missingRules.length === 0) return false;

      const nextContent = content.length === 0
        ? `${missingRules.join('\n')}\n`
        : `${content}${content.endsWith('\n') ? '' : '\n'}${missingRules.join('\n')}\n`;
      await writeFile(path, nextContent, 'utf-8');
      await mergeSetupInjectionManifest(this.base, {
        gitignore: {
          created: false,
          rules: missingRules,
          baseline,
        },
      });
      return true;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      created = true;
      await writeFile(path, `${rules.join('\n')}\n`, 'utf-8');
      await mergeSetupInjectionManifest(this.base, {
        gitignore: {
          created,
          rules,
          baseline,
        },
      });
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

  // --- .flowpilot/config.json（兼容读取旧的 .workflow/config.json） ---

  async loadConfig(): Promise<Record<string, unknown>> {
    const currentConfig = await readConfigFile(join(this.configDir, CONFIG_FILE));
    if (currentConfig) return currentConfig;

    const legacyConfig = await readConfigFile(join(this.root, CONFIG_FILE));
    if (!legacyConfig) return {};

    await this.saveConfig(legacyConfig);
    return legacyConfig;
  }

  async saveConfig(config: Record<string, unknown>): Promise<void> {
    await this.ensure(this.configDir);
    const path = join(this.configDir, CONFIG_FILE);
    await writeFile(path + '.tmp', JSON.stringify(config, null, 2) + '\n', 'utf-8');
    await rename(path + '.tmp', path);
  }

  /** 清理注入的 CLAUDE.md 协议块、hooks 和 .gitignore 规则，仅移除 FlowPilot-owned 内容 */
  async cleanupInjections(): Promise<void> {
    const manifest = await loadSetupInjectionManifest(this.base);

    const mdPath = join(this.base, 'CLAUDE.md');
    try {
      const content = await readFile(mdPath, 'utf-8');
      const cleaned = cleanupClaudeContent(content, manifest);
      if (cleaned.effect === 'delete') {
        await unlink(mdPath);
      } else if (cleaned.effect === 'write') {
        await writeFile(mdPath, cleaned.content, 'utf-8');
      }
    } catch {}

    const claudeDirPath = join(this.base, '.claude');
    const settingsPath = join(claudeDirPath, 'settings.json');
    try {
      const parsed = JSON.parse(await readFile(settingsPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const cleaned = cleanupHookSettings(parsed as Record<string, unknown>, manifest);
        if (cleaned.effect === 'delete') {
          await unlink(settingsPath);
          try {
            await rmdir(claudeDirPath);
          } catch {}
        } else if (cleaned.effect === 'write') {
          await writeFile(settingsPath, cleaned.content, 'utf-8');
        }
      }
    } catch {}

    const gitignorePath = join(this.base, '.gitignore');
    try {
      const content = await readFile(gitignorePath, 'utf-8');
      const cleaned = cleanupGitignoreContent(content, manifest);
      if (cleaned.effect === 'delete') {
        await unlink(gitignorePath);
      } else if (cleaned.effect === 'write') {
        await writeFile(gitignorePath, cleaned.content, 'utf-8');
      }
    } catch {}
  }

  async doesSettingsResidueMatchBaseline(): Promise<boolean> {
    const manifest = await loadSetupInjectionManifest(this.base);
    const hooksManifest = manifest.hooks;
    if (!hooksManifest) return true;

    const baseline = hooksManifest.settingsBaseline;
    if (!baseline) return false;

    const current = await this.snapshotExactFile(join(this.base, '.claude', 'settings.json'));
    return isExactFileSnapshotEqual(baseline, current);
  }

  async doesGitignoreResidueMatchPolicy(): Promise<boolean> {
    const manifest = await loadSetupInjectionManifest(this.base);
    const gitignoreManifest = manifest.gitignore;
    if (!gitignoreManifest) return true;

    const current = await this.snapshotExactFile(join(this.base, '.gitignore'));
    const baseline = gitignoreManifest.baseline;
    if (baseline?.exists) {
      return isExactFileSnapshotEqual(baseline, current);
    }
    if (!current.exists) return false;

    const expected = `${gitignoreManifest.rules.join('\n')}\n`;
    return current.rawContent === expected;
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
