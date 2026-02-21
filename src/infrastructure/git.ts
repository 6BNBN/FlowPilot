/**
 * @module infrastructure/git
 * @description Git 自动提交 - 支持子模块的细粒度提交
 */

import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** 获取所有子模块路径，无 .gitmodules 时返回空数组，有但命令失败时抛出 */
function getSubmodules(): string[] {
  if (!existsSync('.gitmodules')) return [];
  const out = execFileSync('git', ['submodule', '--quiet', 'foreach', 'echo $sm_path'], { stdio: 'pipe', encoding: 'utf-8' });
  return out.split('\n').filter(Boolean);
}

/** 按子模块分组文件，返回 { 子模块路径: 相对文件列表 }，空字符串键=父仓库 */
function groupBySubmodule(files: string[], submodules: string[]): Map<string, string[]> {
  const sorted = [...submodules].sort((a, b) => b.length - a.length);
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const norm = f.replace(/\\/g, '/');
    const sub = sorted.find(s => norm.startsWith(s + '/'));
    const key = sub ?? '';
    const rel = sub ? norm.slice(sub.length + 1) : norm;
    groups.set(key, [...(groups.get(key) ?? []), rel]);
  }
  return groups;
}

/** 在指定目录执行 git add + commit，返回错误信息或null */
function commitIn(cwd: string, files: string[] | null, msg: string): string | null {
  const opts = { stdio: 'pipe' as const, cwd, encoding: 'utf-8' as const };
  try {
    if (files) {
      for (const f of files) execFileSync('git', ['add', f], opts);
    } else {
      execFileSync('git', ['add', '-A'], opts);
    }
    const status = execSync('git diff --cached --quiet || echo HAS_CHANGES', opts).trim();
    if (status === 'HAS_CHANGES') {
      execFileSync('git', ['commit', '-F', '-'], { ...opts, input: msg });
    }
    return null;
  } catch (e: any) {
    return `${cwd}: ${e.stderr?.toString?.() || e.message}`;
  }
}

/** 清理未提交的变更（resume时调用），用stash保留而非丢弃 */
export function gitCleanup(): void {
  try {
    const status = execSync('git status --porcelain', { stdio: 'pipe', encoding: 'utf-8' }).trim();
    if (status) {
      execSync('git stash push -m "flowpilot-resume: auto-stashed on interrupt recovery"', { stdio: 'pipe' });
    }
  } catch {}
}

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

/** 自动 git add + commit，返回错误信息或null */
export function autoCommit(taskId: string, title: string, summary: string, files?: string[]): string | null {
  const msg = `task-${taskId}: ${title}\n\n${summary}`;
  const errors: string[] = [];
  const submodules = getSubmodules();

  if (!submodules.length) {
    const err = commitIn(process.cwd(), files?.length ? files : null, msg);
    return err;
  }

  if (files?.length) {
    const groups = groupBySubmodule(files, submodules);
    for (const [sub, subFiles] of groups) {
      if (sub) {
        const err = commitIn(sub, subFiles, msg);
        if (err) errors.push(err);
      }
    }
    // 父仓库：提交父仓库自身文件 + 更新子模块指针
    try {
      const parentFiles = groups.get('') ?? [];
      const touchedSubs = [...groups.keys()].filter(k => k !== '');
      for (const s of touchedSubs) execFileSync('git', ['add', s], { stdio: 'pipe' });
      for (const f of parentFiles) execFileSync('git', ['add', f], { stdio: 'pipe' });
      const status = execSync('git diff --cached --quiet || echo HAS_CHANGES', { stdio: 'pipe', encoding: 'utf-8' }).trim();
      if (status === 'HAS_CHANGES') {
        execFileSync('git', ['commit', '-F', '-'], { stdio: 'pipe', input: msg });
      }
    } catch (e: any) {
      errors.push(`parent: ${e.stderr?.toString?.() || e.message}`);
    }
  } else {
    for (const sub of submodules) {
      const err = commitIn(sub, null, msg);
      if (err) errors.push(err);
    }
    const err = commitIn(process.cwd(), null, msg);
    if (err) errors.push(err);
  }

  return errors.length ? errors.join('\n') : null;
}
