---
name: dispatching-parallel-agents
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies.
---

# Dispatching Parallel Agents

## Overview

When you have multiple unrelated failures or investigations, handle them in parallel instead of forcing one agent to juggle everything.

**Core principle:** one agent per independent problem domain.

## When to Use

- Multiple failures with different root causes
- Separate subsystems or files
- No shared write set
- No sequential dependency between the tasks

## The Pattern

1. Identify the independent domains.
2. Give each agent a narrow, self-contained prompt.
3. Dispatch them in parallel.
4. Review the results and integrate carefully.

## Codex CLI Example

`	ext
spawn_agent(role=explorer, task="Investigate agent-tool-abort.test.ts failures")
spawn_agent(role=explorer, task="Investigate batch completion behavior failures")
spawn_agent(role=explorer, task="Investigate tool approval race conditions")
`

## Common Mistakes

- One prompt that covers unrelated problems
- Missing context or constraints
- Parallel work on overlapping files
- No integration pass after the agents return