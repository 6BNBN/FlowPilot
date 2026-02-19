/**
 * @module infrastructure/fs-repository
 * @description 文件系统仓储 - 基于 .workflow/ 目录的分层记忆存储
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { ProgressData, TaskEntry } from '../domain/types';
import type { WorkflowRepository } from './repository';

export class FsWorkflowRepository implements WorkflowRepository {
  private readonly root: string;
  private readonly ctxDir: string;

  constructor(basePath: string) {
    this.root = join(basePath, '.workflow');
    this.ctxDir = join(this.root, 'context');
  }

  private async ensure(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
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
      '| ID | 标题 | 类型 | 依赖 | 状态 | 摘要 |',
      '|----|------|------|------|------|------|',
    ];
    for (const t of data.tasks) {
      const deps = t.deps.length ? t.deps.join(',') : '-';
      lines.push(`| ${t.id} | ${t.title} | ${t.type} | ${deps} | ${t.status} | ${t.summary || '-'} |`);
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

      const m = line.match(/^\|\s*(\d{3})\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|\s*([^|]*?)\s*\|\s*(\w+)\s*\|\s*(.*?)\s*\|$/);
      if (m) {
        const depsRaw = m[4].trim();
        tasks.push({
          id: m[1], title: m[2], type: m[3] as TaskEntry['type'],
          status: m[5] as TaskEntry['status'],
          summary: m[6] === '-' ? '' : m[6],
          deps: depsRaw === '-' ? [] : depsRaw.split(',').map(d => d.trim()),
          retries: 0,
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
}
