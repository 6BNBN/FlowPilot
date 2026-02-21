/**
 * @module infrastructure/verify
 * @description 项目验证 - 自动检测任意项目类型并执行验证
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface VerifyResult {
  passed: boolean;
  scripts: string[];
  error?: string;
}

/** 从 .workflow/config.json 加载验证配置 */
function loadConfig(cwd: string): { commands?: string[]; timeout?: number } {
  try {
    const raw = readFileSync(join(cwd, '.workflow', 'config.json'), 'utf-8');
    const cfg = JSON.parse(raw);
    return cfg?.verify ?? {};
  } catch { return {}; }
}

/** 自动检测并执行项目验证脚本 */
export function runVerify(cwd: string): VerifyResult {
  const config = loadConfig(cwd);
  const cmds = config.commands?.length ? config.commands : detectCommands(cwd);
  const timeout = (config.timeout ?? 300) * 1_000;
  if (!cmds.length) return { passed: true, scripts: [] };

  for (const cmd of cmds) {
    try {
      execSync(cmd, { cwd, stdio: 'pipe', timeout });
    } catch (e: any) {
      const stderr = e.stderr?.length ? e.stderr.toString() : '';
      const stdout = e.stdout?.length ? e.stdout.toString() : '';
      const out = stderr || stdout || '';
      if (out.includes('No test files found')) continue;
      if (out.includes('no test files')) continue;
      return { passed: false, scripts: cmds, error: `${cmd} 失败:\n${out.slice(0, 500)}` };
    }
  }
  return { passed: true, scripts: cmds };
}

/** 按项目标记文件检测验证命令 */
function detectCommands(cwd: string): string[] {
  const has = (f: string) => existsSync(join(cwd, f));

  // Node.js
  if (has('package.json')) {
    try {
      const s = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')).scripts || {};
      return ['build', 'test', 'lint'].filter(k => k in s).map(k => `npm run ${k}`);
    } catch { /* fall through */ }
  }
  // Rust
  if (has('Cargo.toml')) return ['cargo build', 'cargo test'];
  // Go
  if (has('go.mod')) return ['go build ./...', 'go test ./...'];
  // Python
  if (has('pyproject.toml') || has('setup.py') || has('requirements.txt')) {
    const cmds: string[] = [];
    if (has('pyproject.toml')) {
      try {
        const txt = readFileSync(join(cwd, 'pyproject.toml'), 'utf-8');
        if (txt.includes('ruff')) cmds.push('ruff check .');
        if (txt.includes('mypy')) cmds.push('mypy .');
      } catch { /* ignore */ }
    }
    cmds.push('python -m pytest --tb=short -q');
    return cmds;
  }
  // Java - Maven
  if (has('pom.xml')) return ['mvn compile -q', 'mvn test -q'];
  // Java - Gradle
  if (has('build.gradle') || has('build.gradle.kts')) return ['gradle build'];
  // C/C++ - CMake
  if (has('CMakeLists.txt')) return ['cmake --build build', 'ctest --test-dir build'];
  // Makefile (通用)
  if (has('Makefile')) {
    try {
      const mk = readFileSync(join(cwd, 'Makefile'), 'utf-8');
      const targets: string[] = [];
      if (/^build\s*:/m.test(mk)) targets.push('make build');
      if (/^test\s*:/m.test(mk)) targets.push('make test');
      if (/^lint\s*:/m.test(mk)) targets.push('make lint');
      if (targets.length) return targets;
    } catch { /* ignore */ }
  }

  return [];
}
