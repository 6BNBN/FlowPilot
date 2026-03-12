# FlowPilot Quick Start

[中文](quick-start.md)

> No theory needed, just follow along.

## Setup (One Time Only)

1. Make sure Node.js is installed (version 20+)
2. Enable parallel / auto-run according to your client:
   - `Claude Code`: add `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }` to `~/.claude/settings.json`
   - `Codex`: add to `~/.codex/config.toml`
     ```toml
     [features]
     multi_agent = true
     ```
     For unattended execution, prefer `codex --yolo`
   - `Cursor`: enable `Agents` in settings and set `Auto-Run Mode` to `Run Everything`
   - `Other clients`: self-test multi-agent / auto-run behavior with that client
3. Install plugins / skills (optional; skipping only degrades capability)
4. (Optional) Configure environment variables to enable LLM-powered smart extraction and deep analysis:
   Add to the `env` section of `~/.claude/settings.json`:
   ```json
   {
     "env": {
       "ANTHROPIC_API_KEY": "sk-ant-...",
       "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
     }
   }
   ```
   > `ANTHROPIC_API_KEY` can also be `ANTHROPIC_AUTH_TOKEN`. `ANTHROPIC_BASE_URL` is optional for custom API endpoints.
   > Works fine without these — memory extraction falls back to rule engine mode.
5. Build the tool:
   ```bash
   cd FlowPilot-directory
   npm install && npm run build
   npm run test:smoke
   ```
6. Handy automation scripts:
   - `npm run test:run`: run the full Vitest suite once in CI-friendly mode
   - `npm run test:smoke`: run only workflow-boundary smoke tests for doc/script changes and pre-release checks

## Start a New Project

```bash
# 1. Copy flow.js to your project
cp FlowPilot-directory/dist/flow.js  your-project/

# 2. Enter project and initialize
cd your-project
node flow.js init
# Ensures .workflow/, .flowpilot/, .claude/settings.json, and .claude/worktrees/ are added to .gitignore when missing
# Choosing Claude Code creates CLAUDE.md by default on first setup; Codex / Cursor / Other default to AGENTS.md

# 3. Launch your client and describe your requirements
claude --dangerously-skip-permissions

# Codex can be started with:
codex --yolo
```

> The more Claude-like output upgrade only changes wording and layout. It does not change task scheduling, protocol priority, command semantics, or checkpoint rules.

> `--dangerously-skip-permissions` skips all permission prompts for truly unattended operation. Without it, every action requires your confirmation.

Then just tell the client what you want, for example:

```
Build a blog system with user registration/login, article publishing, and comments
```

CC will automatically decompose tasks, write code, commit to git, until everything is done. Just sit back and watch.

> Tip: Sub-agents can use knowledge tags in their checkpoint summaries to record key information. These are permanently saved and searchable across workflows:
> - `[REMEMBER]` Facts worth remembering (e.g., `[REMEMBER] Project uses PostgreSQL + Drizzle ORM`)
> - `[DECISION]` Technical decisions (e.g., `[DECISION] Chose JWT over sessions for stateless auth`)
> - `[ARCHITECTURE]` Architecture patterns (e.g., `[ARCHITECTURE] Three-layer: Controller → Service → Repository`)

## Add Features to an Existing Project

```bash
# 1. Copy flow.js to the project (if not already there)
cp FlowPilot-directory/dist/flow.js  your-project/

# 2. Initialize
cd your-project
node flow.js init

# 3. Open CC, describe your development requirements:
Add a search feature to the existing system, supporting search by title and content
```

## What If It Gets Interrupted

Whether the computer shuts down, CC crashes, or context fills up, it's all the same:

```bash
# Resume the most recent conversation, fully automated
# Claude Code
claude --dangerously-skip-permissions --continue

# Codex
codex --yolo
```

Once inside, say "continue task" and it will automatically resume from the breakpoint. Nothing is lost.

- `Claude Code`: prefer `--continue` / `--resume`
- `Codex`: re-enter the project directory, launch `codex --yolo`, then say "continue task"
- `Cursor`: reopen the project and continue in the existing chat or a new one
- `snow-cli` / other clients: reopen the project, restore or start a new session, then say "continue task"

If the worktree still has unarchived changes, `resume` now tells the truth about what survived:
- baseline unarchived changes that already existed before the workflow started and are still present
- explicitly owned task changes that can be adopted as residue
- workflow-period additions with ambiguous ownership, which may include manual user edits/deletions and will not be auto-restored by FlowPilot
- if pending worktree changes exist, the workflow enters `reconciling` and requires `adopt` or restart after handling only the listed task-owned changes
- when the dirty baseline is missing, an explicit warning that FlowPilot cannot prove this is a clean restart or distinguish user changes from task residue

To pick from conversation history:
```bash
claude --dangerously-skip-permissions --resume
```

## Want to Add Requirements Mid-Way

Just tell CC directly:

```
Add a PDF export feature too
```

CC will automatically append the task and continue execution.

## Want It to Run Faster

When describing requirements, separate things that don't depend on each other, and CC will automatically process them in parallel.

Slow approach:
```
First do the database, then the API, then the pages
```

Fast approach:
```
Build an e-commerce system:
- Backend: user module, product module, order module (all depend on database)
- Frontend: homepage, product page, cart page (each depends on corresponding backend API)
- Finally do integration tests
```

The second approach lets CC automatically identify which tasks can run simultaneously, with multiple sub-agents developing in parallel.

## Check Progress

```bash
node flow.js status
```

Or just ask CC: "How's the progress?"

`status` now emphasizes what a human wants to know first:
- what is already done
- what is actively running
- what is blocked
- what the next step is

When sub-agents continuously report their stage, the status output can also show richer live cards such as:
- `Analyzing / Implementing / Verifying / Blocked`
- last activity time
- a short recent progress note

## When finish refuses the final commit

`node flow.js finish` only creates the final commit after verification passes, `node flow.js review` has been completed, and the worktree boundary is still provably safe.

Finish will explicitly refuse the final commit instead of guessing when it sees:
- newly dirty files that were never owned by a workflow checkpoint
- leftover user changes in the instruction file (`AGENTS.md`, or legacy `CLAUDE.md`), `.claude/settings.json`, or `.gitignore` after cleanup runs
- a missing dirty baseline, so FlowPilot can no longer prove which dirty files predated the workflow

In short: FlowPilot only final-commits business files that this workflow explicitly owned. Everything else must be resolved first.

## That's It

Normal usage only requires remembering three things:
1. Put a `flow.js` in the project, run `node flow.js init`
2. Open CC, describe your development requirements
3. If interrupted, open a new window and say "continue task"

## Optional: One-Click Skill Installation (Codex / Cursor)

> FlowPilot works without these installers. Skipping them only means some skill-driven capabilities may degrade.

The repository includes bundled installers compatible with both `Codex` and `Cursor`:

- Root folder: [`兼容codex@cursor一键安装技能/`](/work2026/tools/FlowPilot/兼容codex@cursor一键安装技能)
- Codex package: [`兼容codex@cursor一键安装技能/codex一键安装技能/`](/work2026/tools/FlowPilot/兼容codex@cursor一键安装技能/codex一键安装技能)
- Cursor package: [`兼容codex@cursor一键安装技能/cursor一键安装技能/`](/work2026/tools/FlowPilot/兼容codex@cursor一键安装技能/cursor一键安装技能)

How to choose:
- If you want skills/MCP for `Codex CLI`, use `codex一键安装技能/`
- If you want skills/MCP for `Cursor`, use `cursor一键安装技能/`

Common entry points:

```bash
# Codex (macOS / Linux)
cd "兼容codex@cursor一键安装技能/codex一键安装技能"
chmod +x install.sh repair.sh
./install.sh --force

# Cursor (macOS / Linux)
cd "兼容codex@cursor一键安装技能/cursor一键安装技能"
chmod +x install_cursor_skills.sh repair_cursor_skills.sh self_check_cursor_skills.sh
./install_cursor_skills.sh
```

On Windows, use the bundled `.bat` / `.ps1` launchers in each package directory.

After installation:
- restart `Codex CLI` for Codex
- restart `Cursor` for Cursor

## Uninstalling FlowPilot

If you no longer want FlowPilot in a project, remove the files it copied in or generated at runtime:

- `flow.js` (the single-file tool you copied into the project)
- the instruction file:
  - usually `CLAUDE.md` in `Claude Code` mode
  - usually `AGENTS.md` in `Codex / Cursor / Other` mode
  - the existing instruction file is reused for legacy-compatible setups
  - `ROLE.md` as well in `snow-cli` mode
- `.claude/settings.json` (if FlowPilot generated it in `Claude Code` mode)
- `.workflow/` (local transient runtime state)
- `.flowpilot/` (local persistent state)

Typical cleanup:

```bash
rm -rf flow.js AGENTS.md CLAUDE.md ROLE.md .claude/settings.json .workflow .flowpilot
```

If this leaves `.claude/` empty, you can remove that directory too.
If you manually added project guidance into any of those files later, keep what you need before deleting them.
