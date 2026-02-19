/**
 * @module infrastructure/verify
 * @description 项目验证 - 自动检测并执行验证脚本
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface VerifyResult {
  passed: boolean;
  scripts: string[];
  error?: string;
}

/** 自动检测并执行项目验证脚本 */
export function runVerify(cwd: string): VerifyResult {
  const scripts = detectScripts(cwd);
  if (!scripts.length) return { passed: true, scripts: [] };

  for (const s of scripts) {
    try {
      execSync(`npm run ${s}`, { cwd, stdio: 'pipe', timeout: 120_000 });
    } catch (e: any) {
      const out = (e.stderr || e.stdout || '').toString();
      // 无测试文件不算失败
      if (out.includes('No test files found')) continue;
      return { passed: false, scripts, error: `npm run ${s} 失败:\n${out.slice(0, 500)}` };
    }
  }
  return { passed: true, scripts };
}

function detectScripts(cwd: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    const s = pkg.scripts || {};
    return ['build', 'test', 'lint'].filter(k => k in s);
  } catch {
    return [];
  }
}
