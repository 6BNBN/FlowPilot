/**
 * @module infrastructure/hooks
 * @description 生命周期钩子 - 优先从 .flowpilot/config.json 读取，兼容旧的 .workflow/config.json
 */

import { readFile } from 'fs/promises';
import { execSync } from 'child_process';
import { join } from 'path';
import { log } from './logger';

export type HookName = 'onTaskStart' | 'onTaskComplete' | 'onWorkflowFinish';

interface HooksConfig {
  hooks?: Partial<Record<HookName, string>>;
}

/**
 * 执行生命周期钩子，失败只 warn 不阻塞
 */
async function loadHooksConfig(basePath: string): Promise<HooksConfig | null> {
  for (const configPath of [
    join(basePath, '.flowpilot', 'config.json'),
    join(basePath, '.workflow', 'config.json'),
  ]) {
    try {
      return JSON.parse(await readFile(configPath, 'utf-8')) as HooksConfig;
    } catch {
      // 尝试下一个兼容路径
    }
  }
  return null;
}

export async function runLifecycleHook(
  hookName: HookName,
  basePath: string,
  env?: Record<string, string>,
): Promise<void> {
  const config = await loadHooksConfig(basePath);
  if (!config) {
    return;
  }

  const cmd = config.hooks?.[hookName];
  if (!cmd) return;

  try {
    log.debug(`hook "${hookName}" executing: ${cmd}`);
    execSync(cmd, {
      cwd: basePath,
      stdio: 'pipe',
      timeout: 30_000,
      env: { ...process.env, ...env },
    });
  } catch (e) {
    console.warn(`[FlowPilot] hook "${hookName}" failed: ${(e as Error).message}`);
  }
}
