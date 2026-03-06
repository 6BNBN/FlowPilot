import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runVerify } from './verify';

describe('runVerify', () => {
  it('将 vitest 测试脚本转换为非 watch 验证命令', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-verify-'));

    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          scripts: {
            build: 'tsup',
            test: 'vitest',
            lint: 'eslint .',
          },
        }, null, 2),
        'utf-8',
      );

      const result = runVerify(dir);

      expect(result.passed).toBe(false);
      expect(result.scripts).toEqual(['npm run build', 'npm run test -- --run', 'npm run lint']);
      expect(result.error).toContain('npm run build 失败');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
