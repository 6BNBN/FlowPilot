# FlowPilot - Usage Guide

[中文](usage-guide.md)

## What Is This

A 99KB single-file tool that turns Claude Code into a fully automated development machine.
Copy one file into your project, describe one requirement, and it will automatically decompose requirements, assign tasks, write code, commit to git, run tests, until everything is done.

## Prerequisites

- Node.js >= 20
- Claude Code (CC) installed
- **Agent Teams must be enabled**:
  - Add `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }` to `~/.claude/settings.json`
  - This is a core dependency — sub-agent task dispatch won't work without it
- **Plugins recommended** (sub-agent functionality degrades without them):
  Run `/plugin` in CC to open the plugin store and install:
  `superpowers`, `frontend-design`, `feature-dev`, `code-review`, `context7`

## Quick Start

### Step 1: Copy flow.js to Your Project

```bash
cp /path/to/workflow-engine/dist/flow.js  your-project-directory/
```

### Step 2: Initialize

```bash
cd your-project-directory
node flow.js init
```

This auto-generates:
- `CLAUDE.md` — Embedded dispatch protocol (`<!-- flowpilot:start/end -->` markers)
- `.workflow/` directory — local transient runtime state
- local-state `.gitignore` rules when missing — by default `.workflow/`, `.flowpilot/`, `.claude/settings.json`, and `.claude/worktrees/`

### Step 3: Describe Your Requirements

Open a CC window and directly describe what you want to build:

```
Build a blog system with user registration/login, article publishing, and comments
```

CC will automatically:
1. Check for unfinished workflows (if found, resume from breakpoint)
2. If none → decompose your requirements and start fully automated execution

## Usage Scenarios

### Scenario 1: New Project from Scratch

```
You: Build a blog system with user registration/login, article publishing, and comments
CC: (Auto-decomposes into 10+ tasks, executes in dependency order)
```

### Scenario 2: Incremental Development on Existing Project

```bash
cd existing-project
node flow.js init    # Take over project
# Open CC, describe development requirements
You: Add a search feature to the existing system
```

### Scenario 3: Interruption Recovery

Computer shut down, CC crashed, context full — no problem:

```
# Open a new CC window
You: Continue task
CC: Resuming workflow: Blog System | Progress: 7/12 | Interrupted task 008 reset and will be re-run
```

If the worktree is still dirty, `resume` also reports the real boundary state instead of using a generic success message:
- baseline dirty files that existed before the workflow and are still present
- newly dirty business files left behind by interrupted tasks and intentionally preserved
- a conservative warning when the dirty baseline is missing and FlowPilot can no longer prove this is a clean restart

## Command Reference

| Command | Purpose |
|---------|---------|
| `node flow.js init` | Initialize/take over project |
| `node flow.js init --force` | Force re-initialize (overwrite existing workflow) |
| `node flow.js status` | View current progress |
| `node flow.js next` | Get next task (with dependency context) |
| `node flow.js next --batch` | Get all parallelizable tasks |
| `node flow.js checkpoint <id>` | Mark task complete (stdin/--file/inline) [--files f1 f2 ...] |
| `node flow.js skip <id>` | Skip a task |
| `node flow.js resume` | Interruption recovery (reset active→pending) |
| `node flow.js review` | Mark code-review as done (required before finish) |
| `node flow.js finish` | Smart finalization (verify+report passed/skipped steps+refuse unsafe final commits, requires review) |
| `node flow.js add <desc> [--type T]` | Add new task (argument order flexible) |
| `node flow.js recall <keyword>` | Search historical memories (BM25 + MMR + temporal decay) |
| `node flow.js evolve` | Accept AI reflection results and apply evolution (stdin) |

> Note: During normal use you don't need to run these commands manually — CC calls them automatically per protocol.

## Task Input Format

`node flow.js init` receives a task list via stdin:

```markdown
# Blog System

Full-stack blog application

1. [backend] Database design
   PostgreSQL + Prisma, users/articles/comments tables
2. [backend] API routes (deps: 1)
   RESTful API, CRUD endpoints
3. [frontend] Homepage (deps: 2)
   Article list, pagination
4. [general] Deployment config (deps: 2,3)
   Docker + nginx configuration
```

Format rules:
- `[type]` — frontend / backend / general
- `(deps: id)` — Dependent prerequisite tasks (optional)
- Indented lines — Task description (optional)

## Generated File Structure

```
your-project/
├── flow.js                    # The tool itself (copied by you)
├── CLAUDE.md                  # CC config (embedded dispatch protocol)
└── .workflow/
    ├── progress.md            # Task status table (core memory)
    ├── tasks.md               # Original task definitions
    └── context/
        ├── summary.md         # Rolling summary (global context)
        ├── task-001.md        # Task 1 detailed output
        ├── task-002.md        # Task 2 detailed output
        └── ...
```

## How It Works

```
User describes development requirements
    ↓
CC reads CLAUDE.md → Finds embedded protocol → Enters dispatch mode
    ↓
flow resume → Check for unfinished workflow
    ↓
flow next --batch → Return all parallelizable tasks + dependency context
    ↓
CC dispatches sub-agents in parallel via Task tool (Agent Teams)
    ↓
Sub-agents checkpoint themselves → Record output + auto git commit
    ↓
Main agent confirms progress → Loop until all complete
    ↓
code-review → flow review → Unlock finish
    ↓
flow finish → Auto run build/test/lint → Report completed/skipped/failed → Clean .workflow/ → Final commit
    ↓
Return to standby, await next requirement
```

## Agent Teams Parallel Development In-Depth

This is FlowPilot's most powerful capability. Understanding the parallel mechanism can double your development efficiency.

### How Parallel Works

```
Main Agent (dispatcher)
  │
  ├── flow next --batch
  │   Returns all tasks with satisfied dependencies (e.g. 3)
  │
  ├── Dispatch 3 sub-agents simultaneously (one message, 3 Task tool calls)
  │   ├── Sub-Agent-A → Execute task 001 → Self-checkpoint
  │   ├── Sub-Agent-B → Execute task 002 → Self-checkpoint
  │   └── Sub-Agent-C → Execute task 003 → Self-checkpoint
  │
  └── After all 3 sub-agents return
      Main agent runs flow status to confirm → Continue next round
```

Key points:
- Main agent uses `flow next --batch` to get all parallelizable tasks at once
- Dispatches in parallel via multiple Task tool calls **in a single message**
- Each sub-agent **works independently, checkpoints independently, commits independently**
- Main agent context doesn't bloat from sub-agent output (sub-agents record their own)

### Designing Task Dependencies to Maximize Parallelism

Core principle: **Tasks without dependency relationships are automatically executed in parallel.**

Bad design (fully sequential, one after another):
```markdown
1. [backend] Database design
2. [backend] User API (deps: 1)
3. [backend] Article API (deps: 2)      ← Doesn't actually depend on User API
4. [frontend] User page (deps: 3)       ← Actually only depends on User API
5. [frontend] Article page (deps: 4)    ← Actually only depends on Article API
```

Good design (fully parallel):
```markdown
1. [backend] Database design
2. [backend] User API (deps: 1)
3. [backend] Article API (deps: 1)       ← Only depends on DB, parallel with 2
4. [frontend] User page (deps: 2)        ← Only depends on User API
5. [frontend] Article page (deps: 3)     ← Only depends on Article API, parallel with 4
6. [general] Integration tests (deps: 4,5)
```

Timeline comparison:
```
Bad design:  1 → 2 → 3 → 4 → 5          (5 rounds)
Good design: 1 → [2,3] → [4,5] → 6      (4 rounds, tasks 2&3 parallel, 4&5 parallel)
```

### Real-World Example: E-Commerce System

```markdown
# E-Commerce Platform

Full-stack e-commerce application

1. [backend] Database design
   PostgreSQL: users, products, orders, payments, cart
2. [backend] Auth module (deps: 1)
   JWT + bcrypt, register/login/refresh token
3. [backend] Product API (deps: 1)
   CRUD + paginated search + image upload
4. [backend] Order API (deps: 1)
   Order/payment/refund flow
5. [frontend] Shared component library
   Header/Footer/Card/Modal/Form components
6. [frontend] Product list page (deps: 3,5)
   Product cards, filters, pagination
7. [frontend] Cart page (deps: 3,5)
   CRUD, quantity adjustment
8. [frontend] Login/register page (deps: 2,5)
   Form validation, error messages
9. [frontend] Order page (deps: 4,8)
   Order flow, order history
10. [general] E2E tests (deps: 6,7,8,9)
    Playwright core flow tests
```

Execution timeline:
```
Round 1: [1, 5]           ← Database and frontend component library in parallel
Round 2: [2, 3, 4]        ← Three API modules in parallel
Round 3: [6, 7, 8]        ← Three frontend pages in parallel
Round 4: [9]              ← Order page (depends on login and order API)
Round 5: [10]             ← E2E tests
```

10 tasks in only 5 rounds — sequential would take 10.

### Parallel Interruption and Recovery

If interrupted during parallel execution (CC crash, compact, close window), all running sub-agent tasks remain in `active` state.

Recovery flow:
```
New window → Say: continue task → flow resume
  ↓
Detect 3 active tasks → Reset all to pending
  ↓
flow next --batch → Re-dispatch all 3 tasks in parallel
```

`flow resume` resets **all** active tasks to pending, regardless of count. This means after a parallel interruption, that entire batch is redone. Already checkpointed tasks are unaffected.

At the same time, resume now reports the dirty-worktree state truthfully:
- `Current worktree has no leftover dirty business files; this resume is a clean restart`
- `N dirty files from before workflow start are still preserved`
- `Preserved N dirty business files left behind by interrupted tasks`
- `Dirty baseline missing; cannot reliably distinguish pre-existing dirt from interrupted-task residue`

These lines are boundary diagnostics, not errors. Their job is to prevent a dirty worktree from being mislabeled as perfectly clean.

### Parallel Development Notes

1. **File conflicts**: Parallel sub-agents may modify the same file. Design tasks so parallel tasks operate on different files
2. **When in doubt, add dependencies**: If unsure whether two tasks are dependent, adding the dependency is safer. Incorrect parallelism is more dangerous than sequential execution
3. **Right-sized tasks**: Too large = low parallel benefit, too small = high dispatch overhead. Each task should correspond to one independent module or feature

## Supported Project Types

During finalization, `flow finish` auto-detects and runs verification:

| Project Type | Detection File | Commands |
|---|---|---|
| Node.js | package.json | Whatever scripts exist among build/test/lint, in order; in this repo that means `npm run build` and `npm run test` |
| Rust | Cargo.toml | cargo build/test |
| Go | go.mod | go build/test |
| Python | pyproject.toml | pytest/ruff/mypy |
| Java (Maven) | pom.xml | mvn compile/test |
| Java (Gradle) | build.gradle | gradle build |
| C/C++ | CMakeLists.txt | cmake --build/ctest |
| Generic | Makefile | make build/test/lint |

Verification results are intentionally explicit:
- **passed**: the command ran successfully, for example `- Passed: npm run build`
- **skipped**: the command ran but confirmed there was nothing to do, such as Vitest reporting `No test files found`
- **not found**: the repository has no runnable verification commands at all, so finish prints `Verification result: no runnable verification commands found`

In other words, finish does not blur together “no command exists” and “a command failed.”

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | Yes | Set to `1` to enable Agent Teams (configure in `env` section of `~/.claude/settings.json`) |
| `ANTHROPIC_API_KEY` | No | Anthropic API Key, enables LLM smart extraction and deep reflection analysis |
| `ANTHROPIC_AUTH_TOKEN` | No | Alternative to `ANTHROPIC_API_KEY` (use either one) |
| `ANTHROPIC_BASE_URL` | No | Custom API endpoint, defaults to `https://api.anthropic.com` |

Configuration (in `~/.claude/settings.json`):

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
  }
}
```

> Without an API Key, memory extraction and evolution reflection both fall back to pure rule engine mode. Core functionality is unaffected.

## FAQ

**Q: What happens if Agent Teams isn't enabled?**
The protocol will instruct CC to stop immediately and prompt you to enable it. Add `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }` to `~/.claude/settings.json`.

**Q: What if context fills up?**
After CC auto-compacts, just say "continue task" to resume. All state is in files, independent of conversation history.

**Q: What if a task fails?**
Auto-retry 3 times. If still failing after 3, it's skipped and the next task continues. Finish reports all skipped and failed tasks.

**Q: Can I add requirements mid-way?**
Yes. Just tell CC the new requirement and it will run `flow add` to append a task. Argument order is flexible: `flow add search feature --type frontend` or `flow add --type frontend search feature` both work.

**Q: What if I don't want a certain plugin?**
Plugins are optional. Without the frontend-design plugin, frontend tasks execute in general mode.

**Q: Why did `flow finish` refuse the final commit?**
The most common causes are:
1. newly dirty files that were never owned by any checkpoint `--files` declaration
2. leftover user changes in `CLAUDE.md`, `.claude/settings.json`, or `.gitignore` after cleanup
3. a missing dirty baseline, so FlowPilot can no longer prove the workflow boundary is safe

When this happens, FlowPilot stays in `finishing` state and lists the suspicious files instead of committing on your behalf.

**Q: Should .workflow be committed to git?**
Usually no. `.workflow/` is local transient runtime state, `flow finish` removes it on successful completion, and the default `.gitignore` policy ignores it.

**Q: How are `CLAUDE.md`, `.claude/settings.json`, and `.gitignore` cleaned up?**
They follow ownership-based symmetric cleanup:
- if FlowPilot created them during setup/init and the contents still exactly match the injected content, finish deletes them or restores them precisely
- if they already existed, finish removes only the FlowPilot-owned injected portion and keeps your original content
- the FlowPilot-owned `.gitignore` rules cover `.workflow/`, `.flowpilot/`, `.claude/settings.json`, and `.claude/worktrees/`, but do not ignore the entire `.claude/` directory
- if user residue still remains after cleanup, finish refuses the final commit and names the file

**Q: Will summaries get too long with many tasks?**
No. After 10+ completed tasks, summaries auto-compress by type, keeping only the 3 most recent task names per group.

## Long-Term Memory System

FlowPilot includes a cross-workflow persistent memory system that lets AI accumulate project knowledge across multiple development rounds, avoiding repeated mistakes.

### Knowledge Tags

Sub-agents can tag key information during checkpoint. Tagged content is automatically extracted and permanently saved:

| Tag | Purpose | Example |
|-----|---------|---------|
| `[REMEMBER]` | Facts, discoveries, solutions worth remembering | `[REMEMBER] Project uses PostgreSQL + Drizzle ORM` |
| `[DECISION]` | Technical decisions and rationale | `[DECISION] Chose JWT over sessions for stateless auth` |
| `[ARCHITECTURE]` | Architecture patterns, data flows | `[ARCHITECTURE] Three-layer: Controller → Service → Repository` |

Checkpoint example:
```bash
echo 'Completed auth module [REMEMBER] passwords use bcrypt [DECISION] chose JWT auth' | node flow.js checkpoint 001 --files src/auth.ts
```

### Knowledge Extraction Paths

Memory extraction supports dual paths, automatically selecting the optimal approach:

| Path | Condition | Capability |
|------|-----------|------------|
| LLM Smart Extraction | `ANTHROPIC_API_KEY` present | Two-phase Extract→Decide: first extracts key facts, then deduplicates against existing memories (ADD/UPDATE/SKIP) |
| Rule Engine | No API Key or LLM call fails | Tagged line extraction + decision pattern matching (CN/EN) + tech stack/config detection |

Both paths process `[REMEMBER]`/`[DECISION]`/`[ARCHITECTURE]` tags. The LLM path additionally extracts implicit knowledge from natural language.

### Search Engine

Memory queries use three-source fusion retrieval:

1. **BM25 Sparse Search** — Multilingual tokenization (CJK forward maximum matching + Latin stemming) + BM25 cosine similarity + temporal decay
2. **BM25 Vector Search** — FNV-1a 20-bit sparse vector index, cosine similarity top-k
3. **Dense Embedding Search** — Calls embedding API for dense vectors (requires API Key)

Results from all three sources are fused via **RRF (Reciprocal Rank Fusion)**, then reranked with **MMR (Maximal Marginal Relevance)** to balance relevance and diversity.

Temporal decay: `score = exp(-ln2/halfLife * ageDays)`, half-life 30 days. Entries sourced from `architecture`/`decision`/`identity` never decay (evergreen).

### recall Command

Manually search historical memories:

```bash
node flow.js recall "database design"
node flow.js recall "authentication strategy"
```

Returns the top 5 most relevant memories, sorted by fused score. During normal workflows, the `next` command automatically queries related memories and injects them into task context — no manual recall needed.

## Self-Evolution System

FlowPilot includes a three-phase self-evolution cycle, inspired by [Memoh-v2](https://github.com/Kxiandaoyan/Memoh-v2)'s organic evolution architecture. Automatically reflects and optimizes after each workflow round — no manual trigger needed. **Both successful and failed workflows trigger evolution** — successes distill best practices, failures analyze root causes and adjust strategies.

### Three-Phase Cycle

**Phase 1: Reflect** — Auto-triggered at end of `finish()`

Analyzes the current workflow's success/failure patterns:
- Consecutive failure chain detection (≥2 consecutive failed tasks)
- Type failure concentration (>30% fail rate for a type)
- Retry hotspots (tasks with >2 retries)
- High skip rate (>20%)

Uses Claude Haiku for deep analysis when `ANTHROPIC_API_KEY` is available, falls back to rule engine otherwise.

**Phase 2: Experiment** — Auto-triggered at end of `finish()`

Auto-adjusts based on reflect report:
- **Config params**: `maxRetries`, `timeout`, `parallelLimit`, `verifyTimeout`
- **Protocol template**: Appends experience rules to protocol.md

Full snapshot saved before each modification for rollback support.

**Phase 3: Review** — Auto-triggered at start of `init()`

Validates previous experiment results:
- Compares failRate, skipRate, retryRate between last two workflow rounds
- Any metric worsened by >10 percentage points → auto-rollback to pre-experiment snapshot
- Checks config.json validity and protocol.md integrity

### Complete Evolution Loop

Evolution isn't a standalone step — it's a complete closed loop embedded in the finalization process:

```
finish(verify) → review(code-review) → evolve → finish(verify again)
```

Detailed flow:
1. `flow finish` — runs verification and prints each step as passed or skipped under `Verification result:`
2. On pass, prompts for code-review → `flow review` marks it done
3. `flow finish` again → runs cleanup first, then checks the dirty baseline and owned-file boundary; only a safe boundary can proceed to reflect + experiment + final commit
4. If verification fails, or if unowned dirty files / leftover user changes remain in setup-owned files, finish refuses the final commit; fix the issue and run finish again until verify + review + ownership boundary all pass

### Evolution Result Consumption

Parameters adjusted during the Experiment phase take effect in the next workflow round:

| Parameter | Description | Adjustment Scenario |
|-----------|-------------|-------------------|
| `maxRetries` | Max task retry count | Increased when retry hotspots are frequent, decreased when all succeed |
| `parallelLimit` | Max parallel sub-agents | Decreased when parallel conflicts occur |
| `hints` | Experience rules appended to protocol template | Specific advice distilled from failure patterns |
| `verifyTimeout` | Verification timeout | Increased when verification times out |

### evolve Command

Manually trigger evolution (normally called automatically by the protocol):

```bash
echo 'reflection result JSON' | node flow.js evolve
```

Accepts AI reflection results (JSON format) and executes the Experiment phase parameter adjustments. During normal workflows, `finish` triggers this automatically — no manual execution needed.

### Evolution Data Storage

```
.flowpilot/
├── evolution/
│   ├── reflect-2025-01-15T10-30-00.json   # Reflect report
│   ├── experiments.json                     # Experiment log (append mode)
│   └── review-2025-01-16T09-00-00.json    # Review result
├── history/
│   ├── workflow-1.json                      # Workflow statistics
│   └── workflow-2.json                      # Cross-round comparison data
└── config.json                              # Auto-tuned configuration
```

### Graceful Degradation

| Environment | Behavior |
|-------------|----------|
| ANTHROPIC_API_KEY present | LLM deep analysis + rule engine dual path |
| No API Key | Pure rule engine (failure chains/type concentration/retry hotspots/skip rate) |
| API call fails | Silent fallback to rule engine, workflow uninterrupted |
| No history data | All checks pass, no rollback |
