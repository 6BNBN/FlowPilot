/**
 * @module infrastructure/env-check
 * @description 环境检测 - Agent Teams 和插件可用性检查
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** 检测CC环境，返回警告列表（空=全部通过） */
export function checkEnvironment(): string[] {
  const warnings: string[] = [];
  const home = homedir();
  const claudeDir = join(home, '.claude');

  // Agent Teams 检测
  if (!existsSync(claudeDir)) {
    warnings.push('未检测到 Claude Code 环境（~/.claude 不存在）');
  } else {
    try {
      const settingsPath = join(claudeDir, 'settings.json');
      if (existsSync(settingsPath)) {
        const raw = readFileSync(settingsPath, 'utf-8');
        if (!raw.includes('enabledBetaFeatureFlags') || !raw.includes('agent_teams')) {
          warnings.push('Agent Teams 可能未开启 → Settings → Feature Flags → Agent Teams');
        }
      }
    } catch {}
  }

  // 插件检测（CLAUDE.md协议中引用的所有插件）
  const pluginDir = join(claudeDir, 'plugins');
  const required = ['superpowers', 'frontend-design', 'feature-dev', 'code-review'];
  const missing: string[] = [];

  if (existsSync(pluginDir)) {
    for (const name of required) {
      if (!existsSync(join(pluginDir, name)) && !existsSync(join(pluginDir, name + '.json'))) {
        missing.push(name);
      }
    }
  } else {
    missing.push(...required);
  }

  if (missing.length) {
    warnings.push(`推荐插件未检测到: ${missing.join(', ')}（子Agent功能可能降级）`);
  }

  // context7 MCP 检测
  const mcpPaths = [join(claudeDir, 'mcp.json'), join(claudeDir, '.mcp.json')];
  const hasMcp = mcpPaths.some(p => {
    try { return existsSync(p) && readFileSync(p, 'utf-8').includes('context7'); } catch { return false; }
  });
  if (!hasMcp) {
    warnings.push('context7 MCP 未检测到（子Agent查询文档功能不可用）');
  }

  return warnings;
}
