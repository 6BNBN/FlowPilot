---
name: code-review
description: Use when the user asks for a code review of local files, a workspace, a branch diff, or a pull request. Focus on real bugs, regressions, accessibility issues, and misleading behavior, with findings ordered by severity.
---
# Code Review

## Goal
Find real issues first. Prioritize correctness, regressions, accessibility, security, and misleading UX over style commentary.

## Scope Selection
- If the user names files or paths, review those first.
- If there are local changes, review the changed files and relevant nearby context.
- If a branch diff or pull request is provided, review the diff and then read surrounding code only where needed.
- If scope is unclear, ask what should be reviewed instead of scanning the entire repo blindly.

## Review Workflow
1. Understand the intent of the change.
2. Inspect the relevant files, diffs, and nearby code paths.
3. Look for real execution risks: wrong logic, missing edge cases, state bugs, API misuse, broken UX flows, accessibility problems, and misleading UI behavior.
4. Validate each suspected issue against the actual code before reporting it.
5. Report only high-signal findings.

## Output Format
- List findings first, ordered by severity.
- For each finding include:
  - severity
  - file or scope
  - concise explanation
  - suggested fix when clear
- If no findings are found, say so explicitly and mention residual risks or testing gaps.

## Avoid
- Praise-first reviews that bury the real issues.
- Pure formatting or style nitpicks unless the user asked for them.
- Reporting speculative issues without evidence.
- Treating missing tests as the main finding unless the risk is concrete.

## Optional PR Workflow
If GitHub or git context is available, include PR or diff context. If not, do a local review and clearly state what information was unavailable.