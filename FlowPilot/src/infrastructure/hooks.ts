/**
 * @module infrastructure/hooks
 * @description 生命周期钩子 - 从 .workflow/config.json 读取并执行 shell 命令
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
export async function runLifecycleHook(
  hookName: HookName,
  basePath: string,
  env?: Record<string, string>,
): Promise<void> {
  const configPath = join(basePath, '.workflow', 'config.json');
  let config: HooksConfig;
  try {
    config = JSON.parse(await readFile(configPath, 'utf-8'));
  } catch {
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
