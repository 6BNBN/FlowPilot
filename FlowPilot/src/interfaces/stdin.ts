/**
 * @module interfaces/stdin
 * @description stdin 工具
 */

import { createInterface } from 'node:readline/promises';
import type { SetupClient } from '../domain/types';

/** 检测是否为交互式终端 */
export function isTTY(): boolean {
  return process.stdin.isTTY === true;
}

/** 非TTY时读取stdin，TTY时返回空，超时返回空 */
export function readStdinIfPiped(timeout = 30_000): Promise<string> {
  if (isTTY()) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { process.stdin.destroy(); resolve(''); }, timeout);
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf-8')); });
    process.stdin.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

const CLIENT_OPTIONS: Array<{ key: string; value: SetupClient; label: string; detail: string }> = [
  { key: '1', value: 'claude', label: 'Claude Code', detail: '默认生成 CLAUDE.md + .claude/settings.json' },
  { key: '2', value: 'codex', label: 'Codex', detail: '只生成 AGENTS.md' },
  { key: '3', value: 'cursor', label: 'Cursor', detail: '只生成 AGENTS.md' },
  { key: '4', value: 'snow-cli', label: 'snow-cli', detail: '生成 AGENTS.md + ROLE.md' },
  { key: '5', value: 'other', label: 'Other', detail: '只生成 AGENTS.md' },
];

export function resolveSetupClientChoice(answer: string): SetupClient {
  const trimmed = answer.trim();
  const matched = CLIENT_OPTIONS.find(option => option.key === trimmed);
  return matched?.value ?? 'other';
}

export async function promptSetupClient(): Promise<SetupClient> {
  if (!isTTY()) return 'other';

  process.stdout.write([
    '**客户端选择**',
    '请选择目标客户端。这里的选择只影响生成说明文件与客户端配置，不会改变 FlowPilot 的协议优先级和调度规则。',
    ...CLIENT_OPTIONS.map(option => `${option.key}. ${option.label} - ${option.detail}`),
    '',
    '**提示**',
    '- Claude Code 默认生成 CLAUDE.md',
    '- Codex / Cursor / Other 默认生成 AGENTS.md',
    '- 直接回车默认选择 5. Other',
    '',
  ].join('\n'));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('选择 [1-5]：');
    return resolveSetupClientChoice(answer);
  } finally {
    rl.close();
  }
}
