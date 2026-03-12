---
name: finishing-a-development-branch
description: Use when implementation work is done and you need to decide how to finish it in Cursor, such as keeping the branch, merging locally, creating a pull request, or cleaning up temporary workspaces.
---
# Finishing A Development Branch

## Goal
Close out development work cleanly and safely.

## Workflow
1. Verify the relevant tests, builds, or checks.
2. Confirm the current branch and base branch.
3. Present clear finish options to the user.
4. Execute only the option the user chooses.
5. Clean up temporary branches or worktrees only when appropriate.

## Recommended Options
- merge locally
- push and create a pull request
- keep the branch as-is
- discard the work after explicit confirmation

## Rules
- Do not offer completion options until verification has run.
- Do not discard work without an explicit confirmation step.
- Do not force-push unless the user explicitly asks.
- If a worktree was used, only clean it up when the chosen finish path makes that safe.