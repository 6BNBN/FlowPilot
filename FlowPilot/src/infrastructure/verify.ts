/**
 * @module infrastructure/verify
 * @description 项目验证 - 自动检测任意项目类型并执行验证
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type VerifyStepStatus = 'passed' | 'skipped' | 'failed';
export type VerifyStatus = 'passed' | 'failed' | 'not-found';

export interface VerifyStepResult {
  command: string;
  status: VerifyStepStatus;
  reason?: string;
}

export interface VerifyResult {
  passed: boolean;
  status: VerifyStatus;
  scripts: string[];
  steps: VerifyStepResult[];
  error?: string;
}

/** 优先从 .flowpilot/config.json 加载验证配置，兼容旧的 .workflow/config.json */
function loadConfig(cwd: string): { commands?: string[]; timeout?: number } {
  for (const configPath of [
    join(cwd, '.flowpilot', 'config.json'),
    join(cwd, '.workflow', 'config.json'),
  ]) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const cfg = JSON.parse(raw);
      return cfg?.verify ?? {};
    } catch {
      // 尝试下一个兼容路径
    }
  }
  return {};
}

/** 自动检测并执行项目验证脚本 */
export function runVerify(cwd: string): VerifyResult {
  const config = loadConfig(cwd);
  const cmds = normalizeCommands(cwd, config.commands?.length ? config.commands : detectCommands(cwd));
  const timeout = (config.timeout ?? 300) * 1_000;
  if (!cmds.length) return { passed: true, status: 'not-found', scripts: [], steps: [] };

  const steps: VerifyStepResult[] = [];

  for (const cmd of cmds) {
    try {
      execSync(cmd, { cwd, stdio: 'pipe', timeout });
      steps.push({ command: cmd, status: 'passed' });
    } catch (e: any) {
      const stderr = e.stderr?.length ? e.stderr.toString() : '';
      const stdout = e.stdout?.length ? e.stdout.toString() : '';
      const out = stderr || stdout || '';
      const noTestsReason = detectNoTestsReason(out);
      if (noTestsReason) {
        steps.push({ command: cmd, status: 'skipped', reason: noTestsReason });
        continue;
      }
      const reason = out.slice(0, 500) || '命令执行失败';
      steps.push({ command: cmd, status: 'failed', reason });
      return { passed: false, status: 'failed', scripts: cmds, steps, error: `${cmd} 失败:\n${reason}` };
    }
  }
  return { passed: true, status: 'passed', scripts: cmds, steps };
}

function detectNoTestsReason(output: string): string | null {
  if (output.includes('No test files found')) return '未找到测试文件';
  if (output.includes('no test files')) return '未找到测试文件';
  return null;
}

function normalizeCommands(cwd: string, commands: string[]): string[] {
  const testScript = loadPackageScripts(cwd).test;
  return commands.map(command => {
    if (shouldForceVitestRun(command, testScript)) return 'npm run test -- --run';

    const nested = matchNestedNpmTestCommand(command);
    if (!nested) return command;
    const nestedTestScript = loadPackageScripts(join(cwd, nested.dir)).test;
    return shouldForceVitestRun('npm run test', nestedTestScript)
      ? `cd ${nested.dir} && npm run test -- --run`
      : command;
  });
}

function loadPackageScripts(cwd: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    const scripts = pkg?.scripts;
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return {};
    return Object.fromEntries(
      Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  } catch {
    return {};
  }
}

function shouldForceVitestRun(command: string, testScript?: string): boolean {
  if (command !== 'npm run test' || !testScript) return false;
  const normalizedScript = testScript.replace(/\s+/g, ' ').trim();
  if (!/\bvitest\b/.test(normalizedScript)) return false;
  return !/\bvitest\b.*(?:\s|^)(?:run\b|--run\b)/.test(normalizedScript);
}

function matchNestedNpmTestCommand(command: string): { dir: string } | null {
  const match = /^cd\s+(.+?)\s+&&\s+npm run test$/.exec(command.trim());
  return match ? { dir: match[1] } : null;
}

interface DetectedCommandSet {
  cwd: string;
  commands: string[];
}

function detectNodeCommands(projectDir: string): string[] {
  try {
    const s = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8')).scripts || {};
    return ['build', 'test', 'lint'].filter(k => k in s).map(k => `npm run ${k}`);
  } catch {
    return [];
  }
}

function detectNestedProjectCommands(cwd: string): string[] {
  const children = readdirSync(cwd, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules');

  const candidates: DetectedCommandSet[] = [];
  for (const child of children) {
    const childDir = join(cwd, child.name);
    if (existsSync(join(childDir, 'package.json'))) {
      const commands = detectNodeCommands(childDir);
      if (commands.length) candidates.push({ cwd: child.name, commands });
      continue;
    }
    if (existsSync(join(childDir, 'Cargo.toml'))) {
      candidates.push({ cwd: child.name, commands: ['cargo build', 'cargo test'] });
      continue;
    }
    if (existsSync(join(childDir, 'go.mod'))) {
      candidates.push({ cwd: child.name, commands: ['go build ./...', 'go test ./...'] });
    }
  }

  if (candidates.length !== 1) return [];
  return candidates[0].commands.map(command => `cd ${candidates[0].cwd} && ${command}`);
}

/** 按项目标记文件检测验证命令 */
function detectCommands(cwd: string): string[] {
  const has = (f: string) => existsSync(join(cwd, f));

  // Node.js
  if (has('package.json')) {
    const commands = detectNodeCommands(cwd);
    if (commands.length) return commands;
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

  const nested = detectNestedProjectCommands(cwd);
  if (nested.length) return nested;

  return [];
}
