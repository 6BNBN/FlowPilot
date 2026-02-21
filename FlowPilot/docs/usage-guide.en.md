# FlowPilot - Usage Guide

[中文](usage-guide.md)

## What Is This

A 44KB single-file tool that turns Claude Code into a fully automated development machine.
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
- `.workflow/` directory — Task state persistence

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
CC: Resuming workflow: Blog System | Progress: 7/12 | Continuing execution
```

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
| `node flow.js finish` | Smart finalization (verify+report skipped/failed+commit, requires review) |
| `node flow.js add <desc> [--type T]` | Add new task (argument order flexible) |

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

### Parallel Development Notes

1. **File conflicts**: Parallel sub-agents may modify the same file. Design tasks so parallel tasks operate on different files
2. **When in doubt, add dependencies**: If unsure whether two tasks are dependent, adding the dependency is safer. Incorrect parallelism is more dangerous than sequential execution
3. **Right-sized tasks**: Too large = low parallel benefit, too small = high dispatch overhead. Each task should correspond to one independent module or feature

## Supported Project Types

During finalization, `flow finish` auto-detects and runs verification:

| Project Type | Detection File | Commands |
|---|---|---|
| Node.js | package.json | npm run build/test/lint |
| Rust | Cargo.toml | cargo build/test |
| Go | go.mod | go build/test |
| Python | pyproject.toml | pytest/ruff/mypy |
| Java (Maven) | pom.xml | mvn compile/test |
| Java (Gradle) | build.gradle | gradle build |
| C/C++ | CMakeLists.txt | cmake --build/ctest |
| Generic | Makefile | make build/test/lint |

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

**Q: Should .workflow be committed to git?**
During development, committing is recommended so team members can see task progress and historical decisions. Note that `flow finish` auto-cleans the `.workflow/` directory on successful completion.

**Q: Will summaries get too long with many tasks?**
No. After 10+ completed tasks, summaries auto-compress by type, keeping only the 3 most recent task names per group.
