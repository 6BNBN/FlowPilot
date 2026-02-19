/**
 * @module infrastructure/git
 * @description Git 自动提交 - 每个任务完成后细粒度提交
 */

import { execSync } from 'node:child_process';

/** 自动 git add + commit */
export function autoCommit(taskId: string, title: string, summary: string): void {
  try {
    execSync('git add .', { stdio: 'pipe' });
    const msg = `task-${taskId}: ${title}\n\n${summary}`;
    execSync(`git commit -m ${JSON.stringify(msg)} --allow-empty`, { stdio: 'pipe' });
  } catch {
    // git 不可用或无变更时静默跳过
  }
}
