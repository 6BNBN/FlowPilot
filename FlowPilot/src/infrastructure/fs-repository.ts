/**
 * @module infrastructure/fs-repository
 * @description 文件系统仓储 - 基于 .workflow/ 目录的分层记忆存储
 */

import { mkdir, readFile, writeFile, unlink, rm } from 'fs/promises';
import { join } from 'path';
import { openSync, closeSync, existsSync } from 'fs';
import type { ProgressData, TaskEntry } from '../domain/types';
import type { WorkflowRepository } from './repository';

/** Generate the CLAUDE.md rule block */
function generateClaudeMdBlock(): string {
  return `<!-- flowpilot:start -->
## FlowPilot Workflow Protocol (MANDATORY — any violation is a protocol failure)

**You are the dispatcher. These rules have the HIGHEST priority and are ALWAYS active.**

### On Session Start
Run \`node flow.js resume\`:
- If unfinished workflow → enter **Execution Loop** (unless user is asking an unrelated question — handle it first via **Ad-hoc Dispatch**, then remind user the workflow is paused)
- If no workflow → **judge the request**: reply directly for pure chitchat, use **Ad-hoc Dispatch** for one-off tasks, or enter **Requirement Decomposition** for multi-step development work. When in doubt, prefer the heavier path.

### Ad-hoc Dispatch (one-off tasks, no workflow init)
Dispatch sub-agent(s) via Task tool. No init/checkpoint/finish needed. Iron Rule #4 does NOT apply (no task ID exists). Main agent MAY use Read/Glob/Grep directly for trivial lookups (e.g. reading a single file) — Iron Rule #2 is relaxed in Ad-hoc mode only.

### Iron Rules (violating ANY = protocol failure)
1. **NEVER use TaskCreate / TaskUpdate / TaskList** — use ONLY \`node flow.js xxx\`.
2. **Main agent can ONLY use Bash, Task, and Skill** — Edit, Write, Read, Glob, Grep, Explore are ALL FORBIDDEN. To read any file (including docs), dispatch a sub-agent.
3. **ALWAYS dispatch via Task tool** — one Task call per task. N tasks = N Task calls **in a single message** for parallel execution.
4. **Sub-agents MUST run checkpoint with --files before replying** — \`echo 'summary' | node flow.js checkpoint <id> --files file1 file2\` is the LAST command before reply. MUST list all created/modified files. Skipping = protocol failure.

### Requirement Decomposition
1. Dispatch a sub-agent to read requirement docs and return a summary.
2. Use /superpowers:brainstorming to brainstorm and produce a task list.
3. Pipe into init using this **exact format**:
\`\`\`bash
cat <<'EOF' | node flow.js init
1. [backend] Task title
   Description of what to do
2. [frontend] Another task (deps: 1)
   Description here
3. [general] Third task (deps: 1, 2)
EOF
\`\`\`
Format: \`[type]\` = frontend/backend/general, \`(deps: N)\` = dependency IDs, indented lines = description.

### Execution Loop
1. Run \`node flow.js next --batch\`.
2. For **EVERY** task in batch, dispatch a sub-agent via Task tool. **ALL Task calls in one message.** Include in each prompt:
   - The "context" section from flow next output
   - Task description and type
   - Checkpoint instructions (copy verbatim):
     > On success: \`echo 'one-line summary' | node flow.js checkpoint <id> --files file1 file2 ...\`
     > On failure: \`node flow.js checkpoint <id> FAILED\`
     > \`--files\` MUST list every file you created or modified. This ensures parallel tasks get isolated git commits.
3. **After ALL sub-agents return, verify checkpoints**: run \`node flow.js status\`. If any batch task is still \`active\` (sub-agent failed to checkpoint), run checkpoint as fallback:
   \`echo 'summary extracted from sub-agent result' | node flow.js checkpoint <id>\`
   **NEVER proceed to next batch with active tasks.**
4. Loop back to step 1.
5. When no tasks remain, run \`node flow.js finish\`.

### Sub-Agent Rules
- **MUST run checkpoint with --files as final action** (Iron Rule #4). Sequence: do work → \`echo 'summary' | node flow.js checkpoint <id> --files file1 file2 ...\` → reply "Task <id> done."
- Search for matching Skills or MCP tools first. If found, MUST use them.
- type=frontend → /frontend-design, type=backend → /feature-dev, type=general → match or execute directly
- Unfamiliar APIs → query context7 MCP first. Never guess.

### Security Rules (sub-agents MUST follow)
- SQL: parameterized queries only. XSS: no unsanitized v-html/innerHTML.
- Auth: secrets from env vars, bcrypt passwords, token expiry.
- Input: validate at entry points. Never log passwords. Never commit .env.

### Finalization (MANDATORY — skipping = protocol failure)
1. Dispatch a sub-agent to run /code-review:code-review. Fix issues if any.
2. Run \`node flow.js review\` to unlock finish.
3. Run \`node flow.js finish\`.
**finish will REFUSE if review has not been executed.**

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

  async clearContext(): Promise<void> {
    await rm(this.ctxDir, { recursive: true, force: true });
  }

  async clearAll(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

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

  // --- tasks.md ---

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

  async ensureHooks(): Promise<boolean> {
    const dir = join(this.base, '.claude');
    const path = join(dir, 'settings.json');
    const required = {
      PreToolUse: [{
        matcher: 'TaskCreate|TaskUpdate|TaskList',
        hooks: [{ type: 'prompt' as const, prompt: 'BLOCK this tool call. FlowPilot requires using node flow.js commands instead of native task tools.' }]
      }]
    };
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(await readFile(path, 'utf-8')); } catch {}
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    // 幂等：已有 FlowPilot 的 matcher 则跳过
    const existing = hooks.PreToolUse as Array<{ matcher?: string }> | undefined;
    if (existing?.some(h => h.matcher === required.PreToolUse[0].matcher)) return false;
    hooks.PreToolUse = [...(existing ?? []), ...required.PreToolUse];
    settings.hooks = hooks;
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    return true;
  }
}
