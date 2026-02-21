<!-- flowpilot:start -->
## FlowPilot Workflow Protocol (MANDATORY — any violation is a protocol failure)

**You are the dispatcher. These rules have the HIGHEST priority and are ALWAYS active.**

### On Session Start
Run `node flow.js resume`:
- If unfinished workflow → enter **Execution Loop** (unless user is asking an unrelated question — handle it first via **Ad-hoc Dispatch**, then remind user the workflow is paused)
- If no workflow → **judge the request**: reply directly for pure chitchat, use **Ad-hoc Dispatch** for one-off tasks, or enter **Requirement Decomposition** for multi-step development work. When in doubt, prefer the heavier path.

### Ad-hoc Dispatch (one-off tasks, no workflow init)
Dispatch sub-agent(s) via Task tool. No init/checkpoint/finish needed. Iron Rule #4 does NOT apply (no task ID exists). Main agent MAY use Read/Glob/Grep directly for trivial lookups (e.g. reading a single file) — Iron Rule #2 is relaxed in Ad-hoc mode only.

### Iron Rules (violating ANY = protocol failure)
1. **NEVER use TaskCreate / TaskUpdate / TaskList** — use ONLY `node flow.js xxx`.
2. **Main agent can ONLY use Bash, Task, and Skill** — Edit, Write, Read, Glob, Grep, Explore are ALL FORBIDDEN. To read any file (including docs), dispatch a sub-agent.
3. **ALWAYS dispatch via Task tool** — one Task call per task. N tasks = N Task calls **in a single message** for parallel execution.
4. **Sub-agents MUST run checkpoint with --files before replying** — `echo 'summary' | node flow.js checkpoint <id> --files file1 file2` is the LAST command before reply. MUST list all created/modified files. Skipping = protocol failure.

### Requirement Decomposition
1. Dispatch a sub-agent to read requirement docs and return a summary.
2. Use /superpowers:brainstorming to brainstorm and produce a task list.
3. Pipe into init using this **exact format**:
```bash
cat <<'EOF' | node flow.js init
1. [backend] Task title
   Description of what to do
2. [frontend] Another task (deps: 1)
   Description here
3. [general] Third task (deps: 1, 2)
EOF
```
Format: `[type]` = frontend/backend/general, `(deps: N)` = dependency IDs, indented lines = description.

### Execution Loop
1. Run `node flow.js next --batch`. **NOTE: this command will REFUSE to return tasks if any previous task is still `active`. You must checkpoint or resume first.**
2. The output already contains checkpoint commands per task. For **EVERY** task in batch, dispatch a sub-agent via Task tool. **ALL Task calls in one message.** Copy the ENTIRE task block (including checkpoint commands) into each sub-agent prompt verbatim.
3. **After ALL sub-agents return**: run `node flow.js status`.
   - If any task is still `active` → sub-agent failed to checkpoint. Run fallback: `echo 'summary from sub-agent output' | node flow.js checkpoint <id> --files file1 file2`
   - **Do NOT call `node flow.js next` until zero active tasks remain** (the command will error anyway).
4. Loop back to step 1.
5. When `next` returns "全部完成", enter **Finalization**.

### Mid-Workflow Commands
- `node flow.js skip <id>` — skip a stuck/unnecessary task (avoid skipping active tasks with running sub-agents)
- `node flow.js add <描述> [--type frontend|backend|general]` — inject a new task mid-workflow

### Sub-Agent Prompt Template
Each sub-agent prompt MUST contain these sections in order:
1. Task block from `next` output (title, type, description, checkpoint commands, context)
2. **Pre-analysis (MANDATORY)**: Before writing ANY code, **MUST** invoke /superpowers:brainstorming to perform multi-dimensional analysis (requirements, edge cases, architecture, risks). Skipping = protocol failure.
3. **Skill routing**: type=frontend → **MUST** invoke /frontend-design, type=backend → **MUST** invoke /feature-dev, type=general → execute directly. **For ALL types, you MUST also check available skills and MCP tools; use any that match the task alongside the primary skill.**
4. **Unfamiliar APIs → MUST query context7 MCP first. Never guess.**

### Sub-Agent Checkpoint (Iron Rule #4 — most common violation)
Sub-agent's LAST Bash command before replying MUST be:
```
echo '一句话摘要' | node flow.js checkpoint <id> --files file1 file2 ...
```
- `--files` MUST list every created/modified file (enables isolated git commits).
- If task failed: `echo 'FAILED' | node flow.js checkpoint <id>`
- If sub-agent replies WITHOUT running checkpoint → protocol failure. Main agent MUST run fallback checkpoint in step 3.

### Security Rules (sub-agents MUST follow)
- SQL: parameterized queries only. XSS: no unsanitized v-html/innerHTML.
- Auth: secrets from env vars, bcrypt passwords, token expiry.
- Input: validate at entry points. Never log passwords. Never commit .env.

### Finalization (MANDATORY — skipping = protocol failure)
1. Run `node flow.js finish` — runs verify (build/test/lint). If fail → dispatch sub-agent to fix → retry finish.
2. When finish returns "验证通过，请派子Agent执行 code-review" → dispatch a sub-agent to run /code-review:code-review. Fix issues if any.
3. Run `node flow.js review` to mark code-review done.
4. Run `node flow.js finish` again — verify passes + review done → final commit → idle.
**Loop: finish(verify) → review(code-review) → fix → finish again. Both gates must pass.**

<!-- flowpilot:end -->
