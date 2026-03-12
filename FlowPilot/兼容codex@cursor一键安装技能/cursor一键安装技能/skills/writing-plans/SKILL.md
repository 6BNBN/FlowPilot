---
name: writing-plans
description: Use when the user wants a written implementation plan in Cursor before editing code, especially for multi-step tasks or changes touching several files.
---
# Writing Plans

## Goal
Create an implementation plan that another developer or future session can execute without guessing.

## What A Good Plan Contains
- Goal and scope
- Files likely to change
- Ordered tasks
- Verification steps
- Risks, constraints, or assumptions

## Workflow
1. Restate the objective.
2. Review enough project context to avoid a fantasy plan.
3. Break the work into small, concrete tasks.
4. Include exact file paths when known.
5. Include test or verification commands when they are relevant.
6. Flag open questions instead of inventing answers.

## Recommended Format
- Goal
- Constraints
- Proposed file changes
- Task list
- Verification plan
- Risks or open questions

## Rules
- Prefer task sizes that are easy to execute and review.
- Avoid vague steps like "handle edge cases"; name the actual edge cases.
- If implementation should wait for user approval, say so clearly.
- Save the plan to `docs/plans/YYYY-MM-DD-<topic>.md` when the task is substantial or the user wants a durable artifact.