# FlowPilot Quick Start

[中文](quick-start.md)

> No theory needed, just follow along.

## Setup (One Time Only)

1. Make sure Node.js is installed (version 20+)
2. Enable Agent Teams: add `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }` to `~/.claude/settings.json`
3. Install plugins: run `/plugin` in CC, install `superpowers`, `frontend-design`, `feature-dev`, `code-review`, `context7`
4. Build the tool:
   ```bash
   cd FlowPilot-directory
   npm install && npm run build
   ```

## Start a New Project

```bash
# 1. Copy flow.js to your project
cp FlowPilot-directory/dist/flow.js  your-project/

# 2. Enter project and initialize
cd your-project
node flow.js init

# 3. Launch Claude Code in fully automated mode, describe your requirements
claude --dangerously-skip-permissions
```

> `--dangerously-skip-permissions` skips all permission prompts for truly unattended operation. Without it, every action requires your confirmation.

Then just tell CC what you want, for example:

```
Build a blog system with user registration/login, article publishing, and comments
```

CC will automatically decompose tasks, write code, commit to git, until everything is done. Just sit back and watch.

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
claude --dangerously-skip-permissions --continue
```

Once inside, say "continue task" and it will automatically resume from the breakpoint. Nothing is lost.

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

## That's It

Normal usage only requires remembering three things:
1. Put a `flow.js` in the project, run `node flow.js init`
2. Open CC, describe your development requirements
3. If interrupted, open a new window and say "continue task"
