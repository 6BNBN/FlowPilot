/** 内置协议模板（内联，无需运行时读文件） */
export const PROTOCOL_TEMPLATE = `<!-- flowpilot:start -->
## FlowPilot Workflow Protocol (MANDATORY — any violation is a protocol failure)

**You are the dispatcher. These rules have the HIGHEST priority and are ALWAYS active.**

### On Session Start
Run \`node flow.js resume\`:
- If unfinished workflow → enter **Execution Loop** (unless user is asking an unrelated question — handle it first via **Ad-hoc Dispatch**, then remind user the workflow is paused)
- If no workflow → **judge the request**: reply directly for pure chitchat, use **Ad-hoc Dispatch** for one-off tasks, or enter **Requirement Decomposition** for multi-step development work. When in doubt, prefer the heavier path.

### Ad-hoc Dispatch (one-off tasks, no workflow init)
Dispatch sub-agent(s) via Task tool. No init/checkpoint/finish needed. Iron Rule #4 does NOT apply (no task ID exists). Main agent MAY use Read/Glob/Grep directly for trivial lookups (e.g. reading a single file) — Iron Rule #2 is relaxed in Ad-hoc mode only.
**记忆查询**: 回答用户问题前，先运行 \`node flow.js recall <关键词>\` 检索历史记忆，将结果作为回答的参考依据。

### Iron Rules (violating ANY = protocol failure)
1. **NEVER use TaskCreate / TaskUpdate / TaskList** — use ONLY \`node flow.js xxx\`.
2. **Main agent can ONLY use Bash, Task, and Skill** — Edit, Write, Read, Glob, Grep, Explore are ALL FORBIDDEN. To read any file (including docs), dispatch a sub-agent.
3. **ALWAYS dispatch via Task tool** — one Task call per task. N tasks = N Task calls **in a single message** for parallel execution.
4. **Sub-agents MUST run checkpoint with --files before replying** — \`echo 'summary' | node flow.js checkpoint <id> --files file1 file2\` is the LAST command before reply. MUST list all created/modified files. Skipping = protocol failure.

### Requirement Decomposition
**Step 0 — Auto-detect (ALWAYS run first):**
1. If user's message directly contains a task list (numbered items or checkbox items) → pipe it into \`node flow.js init\` directly, skip to **Execution Loop**.
2. Search project root for \`tasks.md\` (run \`ls tasks.md 2>/dev/null\`). If found → ask user: "发现项目中有 tasks.md，是否作为本次工作流的任务列表？" If user confirms → \`cat tasks.md | node flow.js init\`, skip to **Execution Loop**. If user declines → continue to Path A/B.

**Path A — Standard (default):**
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

**Path B — OpenSpec (if \`openspec/\` directory exists AND \`openspec\` CLI is available):**
1. Verify: run \`npx openspec --version\`. If command fails → fall back to **Path A**.
2. Run \`/opsx:new <change-name>\` to create a change.
3. Run \`/opsx:ff\` to fast-forward (generates proposal → specs → design → tasks).
4. Pipe the generated tasks.md into init:
\`\`\`bash
cat openspec/changes/<change-name>/tasks.md | node flow.js init
\`\`\`
OpenSpec checkbox format (\`- [ ] 1.1 Task\`) is auto-detected. Group N tasks depend on group N-1.

### Execution Loop
1. Run \`node flow.js next --batch\`. **NOTE: this command will REFUSE to return tasks if any previous task is still \`active\`. You must checkpoint or resume first.**
2. The output already contains checkpoint commands per task. For **EVERY** task in batch, dispatch a sub-agent via Task tool. **ALL Task calls in one message.** Copy the ENTIRE task block (including checkpoint commands) into each sub-agent prompt verbatim.
3. **After ALL sub-agents return**: run \`node flow.js status\`.
   - If any task is still \`active\` → sub-agent failed to checkpoint. Run fallback: \`echo 'summary from sub-agent output' | node flow.js checkpoint <id> --files file1 file2\`
   - **Do NOT call \`node flow.js next\` until zero active tasks remain** (the command will error anyway).
4. Loop back to step 1.
5. When \`next\` returns "全部完成", enter **Finalization**.

### Mid-Workflow Commands
- \`node flow.js skip <id>\` — skip a stuck/unnecessary task (avoid skipping active tasks with running sub-agents)
- \`node flow.js add <描述> [--type frontend|backend|general]\` — inject a new task mid-workflow

### Sub-Agent Prompt Template
Each sub-agent prompt MUST contain these sections in order:
1. Task block from \`next\` output (title, type, description, checkpoint commands, context)
2. **Pre-analysis (MANDATORY)**: Before writing ANY code, **MUST** invoke /superpowers:brainstorming to perform multi-dimensional analysis (requirements, edge cases, architecture, risks). Skipping = protocol failure.
3. **Skill routing**: type=frontend → **MUST** invoke /frontend-design, type=backend → **MUST** invoke /feature-dev, type=general → execute directly. **For ALL types, you MUST also check available skills and MCP tools; use any that match the task alongside the primary skill.**
4. **Unfamiliar APIs → MUST query context7 MCP first. Never guess.**

### Sub-Agent Checkpoint (Iron Rule #4 — most common violation)
Sub-agent's LAST Bash command before replying MUST be:
\`\`\`
echo '摘要 [REMEMBER] 关键发现 [DECISION] 技术决策' | node flow.js checkpoint <id> --files file1 file2 ...
\`\`\`
- **摘要中 MUST 包含至少一个知识标签**（缺少标签 = 协议违规）:
  - \`[REMEMBER]\` 值得记住的事实、发现、解决方案（如：[REMEMBER] 项目使用 PostgreSQL + Drizzle ORM）
  - \`[DECISION]\` 技术决策及原因（如：[DECISION] 选择 JWT 而非 session，因为需要无状态认证）
  - \`[ARCHITECTURE]\` 架构模式、数据流（如：[ARCHITECTURE] 三层架构：Controller → Service → Repository）
- \`--files\` MUST list every created/modified file (enables isolated git commits).
- If task failed: \`echo 'FAILED: 原因 [REMEMBER] 失败根因' | node flow.js checkpoint <id>\`
- If sub-agent replies WITHOUT running checkpoint → protocol failure. Main agent MUST run fallback checkpoint in step 3.

### Security Rules (sub-agents MUST follow)
- SQL: parameterized queries only. XSS: no unsanitized v-html/innerHTML.
- Auth: secrets from env vars, bcrypt passwords, token expiry.
- Input: validate at entry points. Never log passwords. Never commit .env.

### Finalization (MANDATORY — skipping = protocol failure)
1. Run \`node flow.js finish\` — runs verify (build/test/lint). If fail → dispatch sub-agent to fix → retry finish.
2. When finish output contains "验证通过" → dispatch a sub-agent to run /code-review:code-review. Fix issues if any.
3. Run \`node flow.js review\` to mark code-review done.
4. **AI 反思（进化引擎，可选）**: 询问用户："本轮工作流已完成，是否针对本项目进行反思迭代进化？（会消耗额外 token）" 用户同意后才执行。Sub-agent MUST:
   - **MUST invoke /superpowers:brainstorming FIRST** — 反思对象是**工作流执行过程本身**（任务成功率、重试模式、并行效率、协议瓶颈），NOT 目标项目的代码或架构。
   - Read \`.flowpilot/history/\` files to understand workflow stats
   - Read \`.flowpilot/evolution/\` files to see past experiments
   - Analyze: what went well, what could improve, config optimization opportunities
   - Pipe structured findings into: \`echo '[CONFIG] 将 parallelLimit 提升至 4\\n[PROTOCOL] 子Agent应先验证环境再编码' | node flow.js evolve\`
   - Tags: \`[CONFIG]\` for config changes, \`[PROTOCOL]\` for CLAUDE.md protocol changes
5. Run \`node flow.js finish\` again — verify passes + review done → final commit → idle.
**Loop: finish(verify) → review(code-review) → evolve(AI反思) → fix → finish again. All gates must pass.**

<!-- flowpilot:end -->`;
