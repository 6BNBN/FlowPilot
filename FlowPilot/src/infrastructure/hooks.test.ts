import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLifecycleHook } from './hooks';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('runLifecycleHook', () => {
  it('优先读取 .flowpilot/config.json 中的 hooks 配置', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-hooks-'));

    try {
      await mkdir(join(dir, '.flowpilot'), { recursive: true });
      await mkdir(join(dir, '.workflow'), { recursive: true });
      await writeFile(
        join(dir, '.flowpilot', 'config.json'),
        JSON.stringify({
          hooks: {
            onTaskComplete: `node -e \"require('node:fs').writeFileSync('persistent-hook.txt', 'ok')\"`,
          },
        }, null, 2),
        'utf-8',
      );
      await writeFile(
        join(dir, '.workflow', 'config.json'),
        JSON.stringify({
          hooks: {
            onTaskComplete: `node -e \"require('node:fs').writeFileSync('legacy-hook.txt', 'ok')\"`,
          },
        }, null, 2),
        'utf-8',
      );

      await runLifecycleHook('onTaskComplete', dir);

      expect(await fileExists(join(dir, 'persistent-hook.txt'))).toBe(true);
      expect(await fileExists(join(dir, 'legacy-hook.txt'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('在 .flowpilot/config.json 缺失时兼容读取旧的 .workflow/config.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-hooks-legacy-'));

    try {
      await mkdir(join(dir, '.workflow'), { recursive: true });
      await writeFile(
        join(dir, '.workflow', 'config.json'),
        JSON.stringify({
          hooks: {
            onTaskComplete: `node -e \"require('node:fs').writeFileSync('legacy-hook.txt', 'ok')\"`,
          },
        }, null, 2),
        'utf-8',
      );

      await runLifecycleHook('onTaskComplete', dir);

      expect(await fileExists(join(dir, 'legacy-hook.txt'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
