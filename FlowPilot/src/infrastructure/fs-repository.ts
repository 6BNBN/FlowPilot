/**
 * @module infrastructure/fs-repository
 * @description 文件系统仓储 - 基于 .workflow/ 目录的分层记忆存储
 */

import { mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { openSync, closeSync, existsSync } from 'fs';
import type { ProgressData, TaskEntry } from '../domain/types';
import type { WorkflowRepository } from './repository';

/** Generate the CLAUDE.md rule block */
function generateClaudeMdBlock(): string {
  return `<!-- flowpilot:start -->
## FlowPilot Workflow Protocol (MANDATORY — any violation is a protocol failure)

**You are the dispatcher. These rules have the HIGHEST priority.**

### Trigger: When user says "开始" (start), immediately run:
\`\`\`bash
node flow.js resume
\`\`\`
- If unfinished workflow exists → enter execution loop
- If no workflow → wait for user requirements → decompose → \`echo '...' | node flow.js init\`

### Iron Rules (violating ANY rule = protocol failure)
1. **NEVER use TaskCreate / TaskUpdate / TaskList** — these are CC's native task system. Use ONLY flow commands (\`node flow.js xxx\`) to manage tasks.
2. **NEVER let the main agent write code / read source / edit files** — Edit, Write, Read, Glob, Grep are FORBIDDEN for the main agent. Dispatch ALL dev work to sub-agents via the Task tool.
3. **ALWAYS dispatch tasks to sub-agents via the Task tool** — the main agent ONLY runs flow commands and dispatches. Never do the work yourself.

### Execution Loop (repeat until "all done")
1. Run \`node flow.js next --batch\` to get parallelizable tasks.
2. For each task, dispatch a sub-agent via the Task tool. Include in the prompt:
   - The "context" section from flow next output
   - Task description and type
   - These checkpoint instructions (copy verbatim to sub-agent):
     > On success: \`echo 'one-line summary' | node flow.js checkpoint <id>\`
     > On failure: \`node flow.js checkpoint <id> FAILED\`
     > Then reply ONLY "Task <id> done." — do NOT return any other content.
3. After all sub-agents return, continue the loop.
4. When all tasks are done, run \`node flow.js finish\`.

### Requirement Decomposition
Use /superpowers:brainstorming to brainstorm, then pipe the task list into \`echo '...' | node flow.js init\`.

### Sub-Agent Rules
- Before executing, search for matching Skills or MCP tools in the current environment. If found, MUST use them.
- type=frontend → use /frontend-design skill
- type=backend → use /feature-dev skill
- type=general → search for matching skill/MCP; if none, execute directly
- For unfamiliar library/framework APIs → MUST query official docs via context7 MCP first. Never guess from memory.
- After checkpoint, reply ONLY "Task xxx done." — do NOT return detailed content.

### Security Rules (sub-agents MUST follow)
- SQL injection: use parameterized queries. Never concatenate user input.
- XSS: never use v-html/innerHTML with unsanitized user input.
- Auth: read secrets from env vars. Use bcrypt for passwords. Set token expiry.
- Input validation: validate type/length/format at entry points. Check MIME and size for uploads.
- Sensitive data: never log plaintext passwords. Enforce HTTPS. Never commit .env to git.

### Finalization
Dispatch a sub-agent to run /code-review:code-review on all changes. Fix issues if any, then run \`node flow.js finish\`.

### Crash Recovery
After compact / crash / window close → \`claude --dangerously-skip-permissions --continue\` → say "开始" → auto-resume.
<!-- flowpilot:end -->`;
}

export class FsWorkflowRepository implements WorkflowRepository {
  private readonly root: string;
  private readonly ctxDir: string;

  private readonly base: string;

  constructor(basePath: string) {
    this.base = basePath;
    this.root = join(basePath, '.workflow');
    this.ctxDir = join(this.root, 'context');
  }

  projectRoot(): string { return this.base; }

  private async ensure(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  /** 文件锁：用 O_EXCL 创建 lockfile，防止并发读写 */
  async lock(maxWait = 5000): Promise<void> {
    await this.ensure(this.root);
    const lockPath = join(this.root, '.lock');
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const fd = openSync(lockPath, 'wx');
        closeSync(fd);
        return;
      } catch {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    // 超时强制清除死锁
    try { await unlink(lockPath); } catch {}
  }

  async unlock(): Promise<void> {
    try { await unlink(join(this.root, '.lock')); } catch {}
  }

  // --- progress.md 读写 ---

  async saveProgress(data: ProgressData): Promise<void> {
    await this.ensure(this.root);
    const lines = [
      `# ${data.name}`,
      '',
      `状态: ${data.status}`,
      `当前: ${data.current ?? '无'}`,
      '',
      '| ID | 标题 | 类型 | 依赖 | 状态 | 重试 | 摘要 | 描述 |',
      '|----|------|------|------|------|------|------|------|',
    ];
    for (const t of data.tasks) {
      const deps = t.deps.length ? t.deps.join(',') : '-';
      const esc = (s: string) => (s || '-').replace(/\|/g, '∣').replace(/\n/g, ' ');
      lines.push(`| ${t.id} | ${esc(t.title)} | ${t.type} | ${deps} | ${t.status} | ${t.retries} | ${esc(t.summary)} | ${esc(t.description)} |`);
    }
    await writeFile(join(this.root, 'progress.md'), lines.join('\n') + '\n', 'utf-8');
  }

  async loadProgress(): Promise<ProgressData | null> {
    try {
      const raw = await readFile(join(this.root, 'progress.md'), 'utf-8');
      return this.parseProgress(raw);
    } catch {
      return null;
    }
  }

  private parseProgress(raw: string): ProgressData {
    const lines = raw.split('\n');
    const name = (lines[0] ?? '').replace(/^#\s*/, '').trim();
    let status = 'idle' as ProgressData['status'];
    let current: string | null = null;
    const tasks: TaskEntry[] = [];

    for (const line of lines) {
      if (line.startsWith('状态: ')) status = line.slice(4).trim() as ProgressData['status'];
      if (line.startsWith('当前: ')) current = line.slice(4).trim();
      if (current === '无') current = null;

      const m = line.match(/^\|\s*(\d{3})\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|\s*([^|]*?)\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/);
      if (m) {
        const depsRaw = m[4].trim();
        tasks.push({
          id: m[1], title: m[2], type: m[3] as TaskEntry['type'],
          deps: depsRaw === '-' ? [] : depsRaw.split(',').map(d => d.trim()),
          status: m[5] as TaskEntry['status'],
          retries: parseInt(m[6], 10),
          summary: m[7] === '-' ? '' : m[7],
          description: m[8] === '-' ? '' : m[8],
        });
      }
    }

    // 从 tasks.md 补充 deps 信息
    return { name, status, current, tasks };
  }

  // --- context/ 任务详细产出 ---

  async saveTaskContext(taskId: string, content: string): Promise<void> {
    await this.ensure(this.ctxDir);
    await writeFile(join(this.ctxDir, `task-${taskId}.md`), content, 'utf-8');
  }

  async loadTaskContext(taskId: string): Promise<string | null> {
    try {
      return await readFile(join(this.ctxDir, `task-${taskId}.md`), 'utf-8');
    } catch {
      return null;
    }
  }

  // --- summary.md ---

  async saveSummary(content: string): Promise<void> {
    await this.ensure(this.ctxDir);
    await writeFile(join(this.ctxDir, 'summary.md'), content, 'utf-8');
  }

  async loadSummary(): Promise<string> {
    try {
      return await readFile(join(this.ctxDir, 'summary.md'), 'utf-8');
    } catch {
      return '';
    }
  }

  // --- protocol.md / tasks.md ---

  async saveProtocol(content: string): Promise<void> {
    await this.ensure(this.root);
    await writeFile(join(this.root, 'protocol.md'), content, 'utf-8');
  }

  async saveTasks(content: string): Promise<void> {
    await this.ensure(this.root);
    await writeFile(join(this.root, 'tasks.md'), content, 'utf-8');
  }

  async loadTasks(): Promise<string | null> {
    try {
      return await readFile(join(this.root, 'tasks.md'), 'utf-8');
    } catch {
      return null;
    }
  }

  async ensureClaudeMd(): Promise<boolean> {
    const base = join(this.root, '..');
    const path = join(base, 'CLAUDE.md');
    const marker = '<!-- flowpilot:start -->';
    const block = generateClaudeMdBlock();
    try {
      const content = await readFile(path, 'utf-8');
      if (content.includes(marker)) return false;
      await writeFile(path, content.trimEnd() + '\n\n' + block + '\n', 'utf-8');
    } catch {
      await writeFile(path, '# Project\n\n' + block + '\n', 'utf-8');
    }
    return true;
  }
}
