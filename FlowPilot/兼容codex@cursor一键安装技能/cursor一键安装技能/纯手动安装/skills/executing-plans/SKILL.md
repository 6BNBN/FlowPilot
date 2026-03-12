---
name: executing-plans
description: Use when a written implementation plan already exists in Cursor and the next step is to execute it in small batches with checkpoints and verification.
---
# Executing Plans

## Goal
Carry out an existing plan without drifting away from it.

## Workflow
1. Read the plan completely.
2. Raise any blockers or contradictions before editing.
3. Execute tasks in small batches.
4. Verify each batch before moving on.
5. Report progress and remaining work clearly.

## Rules
- Follow the approved plan unless the user asks to change direction.
- Stop and ask when a plan step is unclear or wrong.
- Keep edits scoped to the current batch.
- Use `verification-before-completion` before reporting success.

## Good Batch Report
- completed tasks
- files changed
- verification run
- blockers or follow-ups