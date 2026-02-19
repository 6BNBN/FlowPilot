/**
 * @module infrastructure/markdown-parser
 * @description Markdown 工作流定义解析器 - 将 Markdown 转换为 WorkflowDefinition
 *
 * 格式约定：
 * - 第一行 `# 名称` 为工作流名称
 * - 名称下方段落为描述
 * - 有序列表项为步骤：`1. 步骤标题`
 * - 控制流标记：`[loop]`、`[branch]`、`[factory]`
 * - 并行步骤用字母后缀子列表：`  2a. 子步骤A`
 */

import { StepId } from '../domain/types';
import { StepDefinition, WorkflowDefinition } from '../domain/workflow';
import type { StepType } from '../domain/types';

/** 从标题文本中提取控制流类型标记 */
function extractType(text: string): { type: StepType; title: string } {
  const match = text.match(/\[(loop|branch|factory)\]\s*/i);
  if (match) {
    const type = match[1].toLowerCase() as StepType;
    return { type, title: text.replace(match[0], '').trim() };
  }
  return { type: 'sequence', title: text.trim() };
}

/** 从标题文本中提取能力标记：`{read-file}` */
function extractCapability(title: string): { clean: string; capability?: string } {
  const m = title.match(/\{([a-z-]+)\}\s*/);
  if (m) return { clean: title.replace(m[0], '').trim(), capability: m[1] };
  return { clean: title };
}

/** 解析条件表达式：标题中 `when: ...` 或 `until: ...` */
function extractCondition(title: string): { clean: string; condition?: string } {
  const m = title.match(/(?:when|until):\s*(.+)$/i);
  if (m) return { clean: title.replace(m[0], '').trim(), condition: m[1].trim() };
  return { clean: title };
}

/** 主行匹配：`1. text` */
const MAIN_RE = /^(\d+)\.\s+(.+)$/;
/** 并行子行匹配：`  2a. text` */
const SUB_RE = /^\s+(\d+)([a-z])\.\s+(.+)$/;

/** 将 Markdown 文本解析为 WorkflowDefinition */
export function parseWorkflowMarkdown(markdown: string): WorkflowDefinition {
  const lines = markdown.split('\n');
  let name = '';
  let description = '';
  const steps: StepDefinition[] = [];
  let pendingParallel: { parentNum: string; children: StepDefinition[] } | null = null;

  /** 将收集的并行子步骤刷入 steps */
  const flushParallel = () => {
    if (!pendingParallel) return;
    const id = StepId(pendingParallel.parentNum);
    steps.push({ id, type: 'parallel', title: `并行组 ${id}`, description: '', children: pendingParallel.children });
    pendingParallel = null;
  };

  for (const line of lines) {
    if (!name && line.startsWith('# ')) { name = line.slice(2).trim(); continue; }
    if (name && !description && !line.startsWith('#') && line.trim() && !MAIN_RE.test(line)) {
      description = line.trim(); continue;
    }

    const sub = line.match(SUB_RE);
    if (sub) {
      const [, num, letter, text] = sub;
      if (!pendingParallel || pendingParallel.parentNum !== num) {
        flushParallel();
        pendingParallel = { parentNum: num, children: [] };
      }
      const { type, title } = extractType(text);
      const { clean, condition } = extractCondition(title);
      const { clean: final, capability } = extractCapability(clean);
      pendingParallel.children.push({
        id: StepId(`${num}${letter}`), type, title: final, description: '', condition, capability,
      });
      continue;
    }

    const main = line.match(MAIN_RE);
    if (main) {
      flushParallel();
      const [, num, text] = main;
      const { type, title } = extractType(text);
      const { clean, condition } = extractCondition(title);
      const { clean: final, capability } = extractCapability(clean);
      steps.push({ id: StepId(num), type, title: final, description: '', condition, capability });
    }
  }
  flushParallel();
  return { name, description, steps };
}
