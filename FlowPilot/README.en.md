# FlowPilot

[中文](README.md)

**One file, one requirement, fully automated development.**

Drop `flow.js` into any project, open Claude Code, describe what you want, then go grab a coffee.
When you come back, the code is written, tests have passed, and git commits are done.

---

## Why FlowPilot

Traditional CC development: you're the project manager — breaking down tasks, assigning, following up, reviewing, watching the whole time.
FlowPilot: you're the client — just say what you want, everything else is automatic.

| Traditional CC Development | FlowPilot Development |
|---|---|
| Manually break down tasks, tell CC one by one | One requirement, auto-decompose into 10+ tasks |
| Context full? Start over | New window, one sentence, resume from breakpoint, zero loss |
| Can only do one thing at a time | Multiple sub-agents develop in parallel, double the speed |
| Forget previous decisions halfway through | Three-layer memory auto-records, 100 tasks without getting lost |
| Manual git commit every time | Auto-commit per task, auto-run tests at finalization |
| Reconfigure for each project | 44KB single file, copy and use — Node/Rust/Go/Python/Java/C++/Makefile all supported |

### How It Compares

**vs Claude Code Native Sub-Agents (Task Tool)**

CC's built-in Task tool can dispatch sub-agents, but it's **stateless** — context is bound to the current conversation, close the window and it's gone. FlowPilot solves three things native can't do:

1. **Interruption-proof**: All state persisted to disk — compact, crash, close window, doesn't matter. `resume` to continue instantly
2. **Bloat-proof**: Main agent only reads progress.md (< 100 lines), stays fast even with 100 tasks
3. **Auto-parallel**: Dependency graph analysis + batch dispatch, no manual scheduling needed

| | Native Task | FlowPilot |
|---|---|---|
| State persistence | In conversation, lost on compact | Disk files, never lost |
| Interruption recovery | Depends on conversation history, state easily lost after compact | Disk recovery, `resume` to continue |
| Parallel scheduling | Manual | Auto dependency analysis, batch dispatch |
| Context bloat | Main agent gets slower over time | Three-layer memory, main agent < 100 lines |
| Git commits | Manual | Auto-commit per task |
| Final verification | None | Auto build/test/lint |

**vs OpenSpec (Spec-Driven Framework)**

[OpenSpec](https://github.com/Fission-AI/OpenSpec) solves "how to think through requirements before writing code", producing proposal/spec/design documents. FlowPilot solves "how to fully automate execution after requirements are clear", producing runnable code and git history.

| | OpenSpec | FlowPilot |
|---|---|---|
| Focus | Planning layer: requirements → spec documents | Execution layer: tasks → code → commits |
| Output | Markdown documents | Runnable code + git history |
| Execution | Documents done, still need manual/AI implementation one by one | Fully automated dispatch, parallel execution, auto-commit |
| Scope | Tool-agnostic, 20+ AI assistants | Claude Code exclusive, deep integration |

FlowPilot's core advantage is **end-to-end automation** — from requirements to code to commits to verification, no human needed in between. OpenSpec is stronger at the planning stage; the two are complementary: use OpenSpec for requirement planning, then FlowPilot for execution.

## 30-Second Demo

```bash
cp dist/flow.js your-project/
cd your-project
node flow.js init
```

Open Claude Code and describe your requirements:

```
You: Build an e-commerce system with user registration, product management, shopping cart, and order payment

(Then just walk away)
```

CC will automatically: decompose tasks → identify dependencies → dispatch sub-agents in parallel → write code → checkpoint → git commit → run build/test/lint → done.

## Core Advantages

### Unlimited Context — 100 Tasks Without Compact Loss

Three-layer memory architecture, main agent context always < 100 lines:

| Layer | Reader | Content |
|-------|--------|---------|
| progress.md | Main agent | Minimal status table (one line per task) |
| task-xxx.md | Sub-agent | Detailed output and decisions per task |
| summary.md | Sub-agent | Rolling summary (auto-compressed after 10 tasks) |

Sub-agents record their own output, main agent doesn't bloat. Even after compact, files remain — resume and continue.

### Parallel Development — Not One by One, All at Once

```
Sequential: DB → User API → Product API → User Page → Product Page    (5 rounds)
Parallel:   DB → [User API, Product API] → [User Page, Product Page]  (3 rounds)
```

`flow next --batch` automatically finds all parallelizable tasks, main agent dispatches multiple sub-agents simultaneously in a single message.

### Zero-Drift Recovery — Never Lose a Step

Close window, lose network, compact, CC crash — bring it on:

```
New window → Say: continue task → flow resume → detect interruption → reset unfinished tasks → continue
```

All state persisted in files, independent of conversation history. Even if 3 sub-agents are interrupted simultaneously during parallel execution, all are re-dispatched after recovery.

### Iterative Review — Run Another Round, Keep Improving

After a workflow round completes automatically, you can start a new workflow round to review the previous output: check if implementation drifted from requirements, patch gaps, improve code quality. The whole process is extremely fast — iterating a few more rounds costs very little. Compared to manually orchestrating CC Agent Teams natively, the efficiency gain is significant and highly cost-effective — why not spend the saved time with your family?

```
Round 1: Requirements → Fully automated implementation → Code output
Round 2: Review → Find drift/defects → Auto-patch
Round 3: Polish → Code quality improvement → Final verification
```

### 44KB Does It All — Zero Dependencies, Copy and Use

- Single file `dist/flow.js`, 44KB
- Zero runtime dependencies, only needs Node.js
- Auto-detects 8 project types, runs corresponding build/test/lint at finalization

## Documentation

- [Quick Start](docs/quick-start.en.md) — No theory needed, 3 steps to fully automated development
- [Usage Guide](docs/usage-guide.en.md) — Complete command reference, parallel development tips, task design examples

## Prerequisites

Install plugins first for best results (sub-agent functionality degrades without them). Run `/plugin` in CC to open the plugin store and install:

- `superpowers` — Requirement decomposition brainstorming
- `frontend-design` — Frontend tasks
- `feature-dev` — Backend tasks
- `code-review` — Finalization code review
- `context7` — Real-time third-party library documentation lookup

Also enable **Agent Teams** by adding to `~/.claude/settings.json`:

```json
"env": {
  "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
}
```

`node flow.js init` auto-generates the protocol and Hooks, and warns about missing plugins in the output.

## Quick Start

```bash
# Build single file
cd FlowPilot && npm install && npm run build

# Copy to any project
cp dist/flow.js /your/project/
cd /your/project

# Initialize (protocol embedded in CLAUDE.md + Hooks injected)
node flow.js init

# Launch CC in fully automated mode, describe your requirements, everything else is automatic
claude --dangerously-skip-permissions
```

> `--dangerously-skip-permissions` skips all permission prompts for truly unattended operation.

Interruption recovery:
```bash
claude --dangerously-skip-permissions --continue   # Resume most recent conversation
claude --dangerously-skip-permissions --resume     # Pick from conversation history
```

## Architecture Overview

```
Main Agent (dispatcher, < 100 lines context)
  │
  ├─ node flow.js next ──→ Returns tasks + dependency context
  │
  ├─ Sub-Agents (dispatched via Task tool)
  │   ├─ frontend → /frontend-design plugin + other matching Skills/MCP
  │   ├─ backend  → /feature-dev plugin + other matching Skills/MCP
  │   └─ general  → Direct execution + other matching Skills/MCP
  │
  ├─ node flow.js checkpoint ──→ Record output + git commit
  │
  └─ .workflow/ (persistence layer)
      ├─ progress.md        # Task status table (main agent reads)
      ├─ tasks.md           # Complete task definitions
      └─ context/
          ├─ summary.md     # Rolling summary
          └─ task-xxx.md    # Detailed output per task
```

## Three-Layer Memory

| Layer | File | Reader | Content |
|-------|------|--------|---------|
| Layer 1 | progress.md | Main agent | Minimal status table (ID/title/status/summary) |
| Layer 2 | context/task-xxx.md | Sub-agent | Detailed output and decision records per task |
| Layer 3 | context/summary.md | Sub-agent | Rolling summary (tech stack/architecture decisions/completed modules) |

`flow next` auto-assembles: summary + dependency task contexts → injected into sub-agent prompt.
Main agent only ever reads progress.md, minimal context footprint.

## Command Reference

```bash
node flow.js init [--force]       # Initialize/take over project
node flow.js next [--batch]       # Get next/all parallelizable tasks
node flow.js checkpoint <id>      # Record task completion (stdin/--file/inline) [--files f1 f2 ...]
node flow.js skip <id>            # Manually skip a task
node flow.js review               # Mark code-review as done (required before finish)
node flow.js finish               # Smart finalization (verify+summarize+commit, requires review first)
node flow.js status               # View global progress
node flow.js resume               # Interruption recovery
node flow.js add <desc> [--type]  # Add task (frontend/backend/general)
```

## Execution Flow (Fully Automated)

```
node flow.js init
       ↓
  Protocol embedded in CLAUDE.md + Hooks injected
       ↓
  User describes requirements / provides dev docs
       ↓                          ← Everything below is fully automated, no human intervention
  ┌─→ flow next (--batch) ──→ Get tasks + context
  │        ↓
  │   Sub-agent executes (auto-selects plugins)
  │        ↓
  │   flow checkpoint ──→ Record output + git commit
  │        ↓
  └── More tasks? ──→ Yes → Loop
                   No ↓
              flow finish ──→ build/test/lint
                   ↓
              code-review ──→ flow review
                   ↓
              flow finish ──→ Final commit → Clean .workflow/ → idle
```

## Error Handling

- **Task failure** — Auto-retry 3 times, still failing after 3 → mark `failed` and skip
- **Cascade skip** — Downstream tasks depending on failed tasks auto-marked `skipped`
- **Interruption recovery** — `active` tasks reset to `pending`, redo from scratch
- **Verification failure** — `flow finish` reports error, dispatch sub-agent to fix, retry finish

## Development

```bash
cd FlowPilot
npm install
npm run build        # Build → dist/flow.js
npm run dev          # Dev mode
npm test             # Run tests
```

### Source Structure

```
src/
├── main.ts                          # Entry point, dependency injection
├── domain/
│   ├── types.ts                     # TaskEntry, ProgressData and other types
│   ├── task-store.ts                # Task state management (pure functions)
│   ├── workflow.ts                  # WorkflowDefinition
│   └── repository.ts               # Repository interface
├── application/
│   └── workflow-service.ts          # Core use cases (11)
├── infrastructure/
│   ├── fs-repository.ts             # File system implementation + CLAUDE.md protocol embedding + Hooks injection
│   ├── markdown-parser.ts           # Task Markdown parser
│   ├── git.ts                       # Auto git commits
│   └── verify.ts                    # Multi-language project verification
└── interfaces/
    ├── cli.ts                       # Command routing
    ├── formatter.ts                 # Output formatting
    └── stdin.ts                     # Stdin reading
```

### Dependency Direction

```
interfaces → application → domain ← infrastructure
```

Zero runtime external dependencies, only Node.js built-in modules (fs, path, child_process).
