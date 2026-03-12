---
name: using-git-worktrees
description: Use when starting feature work that should be isolated from the current checkout, especially in git repositories where a separate worktree would reduce risk.
---
# Using Git Worktrees

## Goal
Create an isolated workspace for risky or long-running changes without disturbing the current checkout.

## When To Use
- large feature work
- risky refactors
- parallel efforts on different branches
- keeping the current workspace stable while another branch is explored

## Rules
- Only use this in git repositories.
- Confirm the target location before creating a new worktree if project conventions are unclear.
- Make sure the worktree path will not be accidentally committed.
- After creating the worktree, run the project's normal setup before making claims about readiness.