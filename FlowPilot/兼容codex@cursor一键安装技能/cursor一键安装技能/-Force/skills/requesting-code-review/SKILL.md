---
name: requesting-code-review
description: Use after completing meaningful implementation work in Cursor and before merging or declaring the change ready, so the result gets a focused review for bugs, regressions, and maintainability risks.
---
# Requesting Code Review

## Goal
Ask for a focused review at the right time, with the right scope.

## When To Use
- After finishing a substantial feature or bug fix
- Before merging or creating a pull request
- After a risky refactor
- When local changes affect behavior, API contracts, or UI flows

## How To Ask
Provide:
- what changed
- which files or diff should be reviewed
- what behavior matters most
- any specific concerns such as accessibility, regressions, or edge cases

## Good Prompt Shape
- "Review the changed files for real bugs and regressions."
- "Review this branch diff and focus on API behavior and edge cases."
- "Review this UI change for accessibility and misleading interaction states."

## After Review
- Fix high-severity issues first.
- Clarify or push back when a suggestion does not fit the codebase.
- Re-run relevant verification before declaring the work ready.