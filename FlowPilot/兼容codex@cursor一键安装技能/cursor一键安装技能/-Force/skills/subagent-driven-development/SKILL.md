---
name: subagent-driven-development
description: Use when executing a larger plan in Cursor with parallel or delegated work, while keeping tasks narrowly scoped and reviewed between steps.
---
# Subagent-Driven Development

## Goal
Break a larger implementation plan into isolated tasks that can be executed and reviewed without losing control of scope.

## Workflow
1. Read the full plan.
2. Separate independent tasks from tightly coupled ones.
3. Delegate only the parts that can be worked on safely in isolation.
4. Review outputs between tasks before continuing.
5. Re-run verification after integration.

## Rules
- Do not split tightly coupled edits across independent workers.
- Keep each delegated task narrow and self-contained.
- Integrate and review after each meaningful chunk.
- Prefer clarity over maximum parallelism.