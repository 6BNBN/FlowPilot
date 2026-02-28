/**
 * @module infrastructure/markdown-parser
 * @description Markdown 任务解析器
 *
 * 支持两种格式：
 * 1. FlowPilot 原生格式：`1. [frontend] 标题 (deps: 002,003)`
 * 2. OpenSpec 格式：`## 1. Group` + `- [ ] 1.1 Task`
 */

import type { TaskType } from '../domain/types';
import type { TaskDefinition, WorkflowDefinition } from '../domain/workflow';
import { makeTaskId } from '../domain/task-store';

const TASK_RE = /^(\d+)\.\s+\[\s*(\w+)\s*\]\s+(.+?)(?:\s*\((?:deps?|依赖)\s*:\s*([^)]*)\))?\s*$/i;
const DESC_RE = /^\s{2,}(.+)$/;
const OPENSPEC_GROUP_RE = /^##\s+(\d+)\.\s+(.+)$/;
const OPENSPEC_TASK_RE = /^-\s+\[[ x]\]\s+(\d+)\.(\d+)\s+(.+)$/i;

/** 解析 tasks.md 为 WorkflowDefinition（自动检测格式） */
export function parseTasksMarkdown(markdown: string): WorkflowDefinition {
  const isOpenSpec = markdown.split('\n').some(l => OPENSPEC_TASK_RE.test(l));
  return isOpenSpec ? parseOpenSpecMarkdown(markdown) : parseFlowPilotMarkdown(markdown);
}

/** OpenSpec checkbox 格式解析 */
function parseOpenSpecMarkdown(markdown: string): WorkflowDefinition {
  const lines = markdown.split('\n');
  let name = '';
  let description = '';
  const tasks: TaskDefinition[] = [];
  const groupTasks = new Map<number, string[]>(); // groupNum → sysId[]
  let currentGroup = 0;

  for (const line of lines) {
    if (!name && line.startsWith('# ') && !line.startsWith('## ')) {
      name = line.slice(2).trim();
      continue;
    }
    if (name && !description && !line.startsWith('#') && line.trim() && !OPENSPEC_TASK_RE.test(line)) {
      description = line.trim();
      continue;
    }
    const gm = line.match(OPENSPEC_GROUP_RE);
    if (gm) {
      currentGroup = parseInt(gm[1], 10);
      if (!groupTasks.has(currentGroup)) groupTasks.set(currentGroup, []);
      continue;
    }
    const tm = line.match(OPENSPEC_TASK_RE);
    if (tm) {
      const groupNum = parseInt(tm[1], 10);
      const sysId = makeTaskId(tasks.length + 1);
      if (!groupTasks.has(groupNum)) groupTasks.set(groupNum, []);
      groupTasks.get(groupNum)!.push(sysId);

      let titleText = tm[3].trim();
      let type: TaskType = 'general';
      const typeMatch = titleText.match(/^\[\s*(frontend|backend|general)\s*\]\s+(.+)$/i);
      if (typeMatch) {
        type = typeMatch[1].toLowerCase() as TaskType;
        titleText = typeMatch[2];
      }
      // 组 N>1 的任务依赖组 N-1 的所有任务
      const deps = groupNum > 1 && groupTasks.has(groupNum - 1)
        ? [...groupTasks.get(groupNum - 1)!]
        : [];

      tasks.push({ title: titleText, type, deps, description: '' });
    }
  }

  if (!name) name = 'OpenSpec Workflow';
  return { name, description, tasks };
}

/** FlowPilot 原生格式解析（原有逻辑不变） */
function parseFlowPilotMarkdown(markdown: string): WorkflowDefinition {
  const lines = markdown.split('\n');
  let name = '';
  let description = '';
  const tasks: TaskDefinition[] = [];
  const numToId = new Map<string, string>();

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
      const userNum = m[1];
      const sysId = makeTaskId(tasks.length + 1);
      numToId.set(userNum.padStart(3, '0'), sysId);
      numToId.set(userNum, sysId);

      const validTypes = new Set(['frontend', 'backend', 'general']);
      const rawType = m[2].toLowerCase();
      const type = (validTypes.has(rawType) ? rawType : 'general') as TaskType;
      const title = m[3].trim();
      const rawDeps = m[4] ? m[4].split(',').map(d => d.trim()).filter(Boolean) : [];
      let desc = '';
      while (i + 1 < lines.length && DESC_RE.test(lines[i + 1])) {
        i++;
        desc += (desc ? '\n' : '') + lines[i].trim();
      }
      tasks.push({ title, type, deps: rawDeps, description: desc });
    }
  }

  for (const t of tasks) {
    t.deps = t.deps.map(d => numToId.get(d.padStart(3, '0')) || numToId.get(d) || makeTaskId(parseInt(d, 10))).filter(Boolean);
  }

  return { name, description, tasks };
}
