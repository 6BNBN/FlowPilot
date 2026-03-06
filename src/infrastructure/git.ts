/**
 * @module infrastructure/git
 * @description Git 自动提交 - 支持子模块的细粒度提交
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CommitResult, CommitSkipReason } from '../domain/repository';

const FLOWPILOT_RUNTIME_PREFIXES = ['.flowpilot/', '.workflow/'];
const FLOWPILOT_RUNTIME_FILES = new Set(['.claude/settings.json']);

/** 统一 git 路径格式，避免 Windows 分隔符和 ./ 前缀影响判断 */
function normalizeGitPath(file: string): string {
  return file.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** 判断是否为 FlowPilot 运行时产物，自动提交/自动恢复都应跳过 */
function isFlowPilotRuntimePath(file: string): boolean {
  const norm = normalizeGitPath(file);
  return FLOWPILOT_RUNTIME_FILES.has(norm)
    || FLOWPILOT_RUNTIME_PREFIXES.some(prefix => norm === prefix.slice(0, -1) || norm.startsWith(prefix));
}

/** 过滤显式文件列表：去重、规范化，并排除 FlowPilot 运行时产物 */
function filterCommitFiles(files: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const file of files) {
    const norm = normalizeGitPath(file);
    if (!norm || isFlowPilotRuntimePath(norm) || seen.has(norm)) continue;
    seen.add(norm);
    result.push(norm);
  }
  return result;
}

/** 检查指定 pathspec 是否存在已暂存改动 */
function hasCachedChanges(cwd: string, files: string[]): boolean {
  try {
    execFileSync('git', ['diff', '--cached', '--quiet', '--', ...files], { stdio: 'pipe', cwd });
    return false;
  } catch (e: any) {
    if (e?.status === 1) return true;
    throw e;
  }
}

/** 读取 git 命令输出的路径列表；命令失败时返回空数组，让上层按 no-files 兜底 */
function readGitPaths(cwd: string, args: string[]): string[] {
  try {
    const out = execFileSync('git', args, { stdio: 'pipe', cwd, encoding: 'utf-8' });
    return out.split('\n').map(normalizeGitPath).filter(Boolean);
  } catch {
    return [];
  }
}

/** 获取所有子模块路径，无 .gitmodules 时返回空数组，有但命令失败时抛出 */
function getSubmodules(cwd = process.cwd()): string[] {
  if (!existsSync(join(cwd, '.gitmodules'))) return [];
  const out = execFileSync('git', ['submodule', '--quiet', 'foreach', 'echo $sm_path'], { stdio: 'pipe', cwd, encoding: 'utf-8' });
  return out.split('\n').map(normalizeGitPath).filter(Boolean);
}

/** 递归收集 dirty submodule 内部的真实改动文件 */
function listDirtySubmoduleFiles(cwd: string, submodulePath: string): string[] {
  const submoduleCwd = join(cwd, submodulePath);
  const groups = [
    readGitPaths(submoduleCwd, ['diff', '--name-only', '--cached']),
    readGitPaths(submoduleCwd, ['diff', '--name-only']),
    readGitPaths(submoduleCwd, ['ls-files', '--others', '--exclude-standard']),
  ];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const group of groups) {
    for (const file of group) {
      const fullPath = normalizeGitPath(`${submodulePath}/${file}`);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      result.push(fullPath);
    }
  }

  return result;
}

/** 按子模块分组文件，返回 { 子模块路径: 相对文件列表 }，空字符串键=父仓库 */
function groupBySubmodule(files: string[], submodules: string[]): Map<string, string[]> {
  const sorted = [...submodules].sort((a, b) => b.length - a.length);
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const norm = normalizeGitPath(f);
    const sub = sorted.find(s => norm.startsWith(s + '/'));
    const key = sub ?? '';
    const rel = sub ? norm.slice(sub.length + 1) : norm;
    groups.set(key, [...(groups.get(key) ?? []), rel]);
  }
  return groups;
}

/** 构造 skipped 结果 */
function skipped(reason: CommitSkipReason): CommitResult {
  return { status: 'skipped', reason };
}

/** 在指定目录执行 git add + commit，返回显式结果 */
function commitIn(cwd: string, files: string[], msg: string): CommitResult {
  const opts = { stdio: 'pipe' as const, cwd, encoding: 'utf-8' as const };
  if (!files.length) return skipped('runtime-only');
  try {
    for (const f of files) execFileSync('git', ['add', '--', f], opts);
    if (!hasCachedChanges(cwd, files)) {
      return skipped('no-staged-changes');
    }
    execFileSync('git', ['commit', '-F', '-', '--', ...files], { ...opts, input: msg });
    return { status: 'committed' };
  } catch (e: any) {
    return { status: 'failed', error: `${cwd}: ${e.stderr?.toString?.() || e.message}` };
  }
}

/**
 * 中断恢复时不再自动 stash 整个工作区。
 * 旧逻辑会把用户显式删除的文件一并 stash，导致文件立刻从工作区“复活”。
 * 现在保守地保持用户工作区原样，避免 FlowPilot 越权处理用户改动。
 */
export function gitCleanup(): void {}

/** 收集当前工作区真实改动文件，包含 staged/unstaged/untracked */
export function listChangedFiles(cwd = process.cwd()): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const submodules = getSubmodules(cwd);
  const submoduleSet = new Set(submodules);
  const groups = [
    readGitPaths(cwd, ['diff', '--name-only', '--cached']),
    readGitPaths(cwd, ['diff', '--name-only']),
    readGitPaths(cwd, ['ls-files', '--others', '--exclude-standard']),
  ];

  for (const group of groups) {
    for (const file of group) {
      if (submoduleSet.has(file)) {
        for (const nestedFile of listDirtySubmoduleFiles(cwd, file)) {
          if (seen.has(nestedFile)) continue;
          seen.add(nestedFile);
          result.push(nestedFile);
        }
        continue;
      }

      if (seen.has(file)) continue;
      seen.add(file);
      result.push(file);
    }
  }

  return result;
}

export const __testables = {
  normalizeGitPath,
  isFlowPilotRuntimePath,
  filterCommitFiles,
};

/** 为任务打轻量 tag，返回错误信息或null */
export function tagTask(taskId: string): string | null {
  try {
    execFileSync('git', ['tag', `flowpilot/task-${taskId}`], { stdio: 'pipe' });
    return null;
  } catch (e: any) {
    return e.stderr?.toString?.() || e.message;
  }
}

/** 回滚到指定任务的 tag，使用 git revert */
export function rollbackToTask(taskId: string): string | null {
  const tag = `flowpilot/task-${taskId}`;
  try {
    execFileSync('git', ['rev-parse', tag], { stdio: 'pipe' });
    const log = execFileSync('git', ['log', '--oneline', `${tag}..HEAD`], { stdio: 'pipe', encoding: 'utf-8' }).trim();
    if (!log) return '没有需要回滚的提交';
    execFileSync('git', ['revert', '--no-commit', `${tag}..HEAD`], { stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', `rollback: revert to task-${taskId}`], { stdio: 'pipe' });
    return null;
  } catch (e: any) {
    try { execFileSync('git', ['revert', '--abort'], { stdio: 'pipe' }); } catch {}
    return e.stderr?.toString?.() || e.message;
  }
}

/** 清理所有 flowpilot/ 前缀的 tag */
export function cleanTags(): void {
  try {
    const tags = execFileSync('git', ['tag', '-l', 'flowpilot/*'], { stdio: 'pipe', encoding: 'utf-8' }).trim();
    if (!tags) return;
    for (const t of tags.split('\n')) {
      if (t) execFileSync('git', ['tag', '-d', t], { stdio: 'pipe' });
    }
  } catch {}
}

/** 自动 git add + commit，返回真实提交结果 */
export function autoCommit(taskId: string, title: string, summary: string, files?: string[]): CommitResult {
  const msg = `task-${taskId}: ${title}

${summary}`;
  if (!files?.length) return skipped('no-files');

  const commitFiles = filterCommitFiles(files);
  if (!commitFiles.length) return skipped('runtime-only');

  const submodules = getSubmodules();
  if (!submodules.length) {
    return commitIn(process.cwd(), commitFiles, msg);
  }

  const groups = groupBySubmodule(commitFiles, submodules);
  const results: CommitResult[] = [];

  for (const [sub, subFiles] of groups) {
    if (!sub) continue;
    results.push(commitIn(sub, subFiles, msg));
  }

  const parentFiles = groups.get('') ?? [];
  const touchedSubs = [...groups.keys()].filter(k => k !== '');
  const parentTargets = [...touchedSubs, ...parentFiles];
  if (parentTargets.length) {
    results.push(commitIn(process.cwd(), parentTargets, msg));
  }

  const failures = results.filter((result): result is CommitResult & { status: 'failed'; error: string } => result.status === 'failed' && Boolean(result.error));
  if (failures.length) {
    return { status: 'failed', error: failures.map(result => result.error).join('\n') };
  }
  if (results.some(result => result.status === 'committed')) {
    return { status: 'committed' };
  }
  if (results.some(result => result.status === 'skipped' && result.reason === 'no-staged-changes')) {
    return skipped('no-staged-changes');
  }
  return skipped('runtime-only');
}
