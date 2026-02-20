/**
 * @module infrastructure/git
 * @description Git 自动提交 - 支持子模块的细粒度提交
 */

import { execSync } from 'node:child_process';

/** 获取所有子模块路径 */
function getSubmodules(): string[] {
  try {
    const out = execSync('git submodule --quiet foreach "echo $sm_path"', { stdio: 'pipe', encoding: 'utf-8' });
    return out.split('\n').filter(Boolean);
  } catch { return []; }
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

/** 在指定目录执行 git add + commit */
function commitIn(cwd: string, files: string[] | null, msg: string): void {
  const opts = { stdio: 'pipe' as const, cwd, encoding: 'utf-8' as const };
  try {
    if (files) {
      for (const f of files) execSync(`git add ${JSON.stringify(f)}`, opts);
    } else {
      execSync('git add -A', opts);
    }
    const status = execSync('git diff --cached --quiet || echo HAS_CHANGES', opts).trim();
    if (status === 'HAS_CHANGES') {
      execSync(`git commit -m ${JSON.stringify(msg)}`, opts);
    }
  } catch (e: any) {
    console.error(`[FlowPilot] git commit 失败 (${cwd}): ${e.stderr || e.message}`);
  }
}

/** 自动 git add + commit，files 指定只提交特定文件 */
export function autoCommit(taskId: string, title: string, summary: string, files?: string[]): void {
  try {
    const msg = `task-${taskId}: ${title}\n\n${summary}`;
    const submodules = getSubmodules();

    if (!submodules.length) {
      commitIn(process.cwd(), files?.length ? files : null, msg);
      return;
    }

    if (files?.length) {
      const groups = groupBySubmodule(files, submodules);
      for (const [sub, subFiles] of groups) {
        if (sub) commitIn(sub, subFiles, msg);
      }
      // 父仓库：提交父仓库自身文件 + 更新子模块指针
      const parentFiles = groups.get('') ?? [];
      const touchedSubs = [...groups.keys()].filter(k => k !== '');
      for (const s of touchedSubs) execSync(`git add ${JSON.stringify(s)}`, { stdio: 'pipe' });
      for (const f of parentFiles) execSync(`git add ${JSON.stringify(f)}`, { stdio: 'pipe' });
      const status = execSync('git diff --cached --quiet || echo HAS_CHANGES', { stdio: 'pipe', encoding: 'utf-8' }).trim();
      if (status === 'HAS_CHANGES') {
        execSync(`git commit -m ${JSON.stringify(msg)}`, { stdio: 'pipe' });
      }
    } else {
      // 无指定文件：所有子模块 + 父仓库全部提交
      for (const sub of submodules) commitIn(sub, null, msg);
      commitIn(process.cwd(), null, msg);
    }
  } catch (e: any) {
    console.error(`[FlowPilot] autoCommit 失败: ${e.stderr || e.message}`);
  }
}
