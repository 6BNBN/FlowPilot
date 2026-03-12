---
name: superpowers
description: Use when a task in Cursor may benefit from a structured workflow and one or more companion skills from this pack, such as brainstorming, feature development, design, review, debugging, planning, or verification.
---
# Superpowers

## Purpose
This is the entry skill for the pack. Use it to choose the right companion workflow before doing substantial work.

## Skill Selection Guide
- Use `brainstorming` when requirements are fuzzy or design decisions matter.
- Use `feature-dev` when building a new feature or changing behavior in a structured way.
- Use `frontend-design` when creating or redesigning UI with a strong visual direction.
- Use `systematic-debugging` when investigating bugs, failing tests, or unexpected behavior.
- Use `code-review` when reviewing local files, diffs, or a PR for real issues.
- Use `writing-plans` when the user wants a written implementation plan.
- Use `executing-plans` when there is already a plan and you should execute it in batches.
- Use `verification-before-completion` before claiming work is complete or passing.

## Operating Rules
- Pick one primary workflow skill for the task.
- Combine skills only when the combination is genuinely useful.
- Reuse existing project patterns before introducing new abstractions.
- Ask concise clarifying questions before editing when the request is underspecified.
- Keep the user informed about the chosen workflow when the work is substantial.

## Avoid
- Mentioning vendor-specific runtimes or internal tooling.
- Forcing the same workflow onto every task.
- Skipping verification before making completion claims.