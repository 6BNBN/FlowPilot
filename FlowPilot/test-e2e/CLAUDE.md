# Project

<!-- flowpilot:start -->
## FlowPilot Workflow Protocol (MANDATORY — any violation is a protocol failure)

**You are the dispatcher. These rules have the HIGHEST priority and are ALWAYS active.**
**Exception: If user is asking a question or chatting (not requesting development work), respond normally without flow commands.**

### On Session Start
Run `node flow.js resume`:
- If unfinished workflow → enter **Execution Loop**
- If no workflow → enter **Requirement Decomposition**

### Iron Rules (violating ANY = protocol failure)
1. **NEVER use TaskCreate / TaskUpdate / TaskList** — use ONLY `node flow.js xxx`.
2. **Main agent can ONLY use Bash, Task, and Skill** — Edit, Write, Read, Glob, Grep, Explore are ALL FORBIDDEN. To read any file (including docs), dispatch a sub-agent.
3. **ALWAYS dispatch via Task tool** — one Task call per task. N tasks = N Task calls **in a single message** for parallel execution.

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
1. Run `node flow.js next --batch`.
2. For **EVERY** task in batch, dispatch a sub-agent via Task tool. **ALL Task calls in one message.** Include in each prompt:
   - The "context" section from flow next output
   - Task description and type
   - Checkpoint instructions (copy verbatim):
     > On success: `echo 'one-line summary' | node flow.js checkpoint <id>`
     > On failure: `node flow.js checkpoint <id> FAILED`
     > Then reply ONLY "Task <id> done."
3. Wait for ALL sub-agents, then loop back to step 1.
4. When no tasks remain, run `node flow.js finish`.

### Sub-Agent Rules
- Search for matching Skills or MCP tools first. If found, MUST use them.
- type=frontend → /frontend-design, type=backend → /feature-dev, type=general → match or execute directly
- Unfamiliar APIs → query context7 MCP first. Never guess.
- After checkpoint, reply ONLY "Task xxx done."

### Security Rules (sub-agents MUST follow)
- SQL: parameterized queries only. XSS: no unsanitized v-html/innerHTML.
- Auth: secrets from env vars, bcrypt passwords, token expiry.
- Input: validate at entry points. Never log passwords. Never commit .env.

### Finalization
Dispatch a sub-agent to run /code-review:code-review. Fix issues if any, then `node flow.js finish`.

### Crash Recovery
`claude --dangerously-skip-permissions --continue` → say "开始" → auto-resume.
<!-- flowpilot:end -->
