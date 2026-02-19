/**
 * @module infrastructure/markdown-parser
 * @description Markdown 任务解析器
 *
 * tasks.md 格式：
 * - `# 名称`
 * - 描述段落
 * - `1. [frontend] 标题 (deps: 002,003)`
 * - `   描述文本`
 */

import type { TaskType } from '../domain/types';
import type { TaskDefinition, WorkflowDefinition } from '../domain/workflow';
import { makeTaskId } from '../domain/task-store';

const TASK_RE = /^(\d+)\.\s+\[\s*(\w+)\s*\]\s+(.+?)(?:\s*\((?:deps?|依赖)\s*:\s*([^)]*)\))?\s*$/i;
const DESC_RE = /^\s{2,}(.+)$/;

/** 解析 tasks.md 为 WorkflowDefinition */
export function parseTasksMarkdown(markdown: string): WorkflowDefinition {
  const lines = markdown.split('\n');
  let name = '';
  let description = '';
  const tasks: TaskDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!name && line.startsWith('# ')) {
      name = line.slice(2).trim();
      continue;
    }
    if (name && !description && !line.startsWith('#') && line.trim() && !TASK_RE.test(line)) {
      description = line.trim();
      continue;
    }

    const m = line.match(TASK_RE);
    if (m) {
      const type = m[2].toLowerCase() as TaskType;
      const title = m[3].trim();
      const deps = m[4] ? m[4].split(',').map(d => d.trim().padStart(3, '0')).filter(Boolean) : [];
      // 收集缩进描述行
      let desc = '';
      while (i + 1 < lines.length && DESC_RE.test(lines[i + 1])) {
        i++;
        desc += (desc ? '\n' : '') + lines[i].trim();
      }
      tasks.push({ title, type, deps, description: desc });
    }
  }
  return { name, description, tasks };
}
