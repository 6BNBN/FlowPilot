---
name: code-review
description: Use when the user asks to review a pull request or diff with a structured Codex CLI workflow using parallel review passes and filtered actionable findings.
---

# Codex-Native PR Code Review

Use this workflow to review a pull request or diff with gh when available. Keep findings high-signal, actionable, and grounded in the actual change.

## Source of truth
- eferences/code-review-command.md

## Review Workflow

1. **Eligibility check**
   - Confirm the PR is still open and ready for review.
   - Skip review if it is clearly out of scope, already handled, or obviously trivial.

2. **Collect local guidance**
   - Identify the relevant AGENTS.md files for the touched paths.
   - Treat those files as code-review guidance when applicable.

3. **Summarize the change**
   - Use one fast subagent to summarize the PR and changed areas.

4. **Run parallel review passes**
   - Launch independent review subagents with different lenses:
     - conventions and AGENTS.md compliance
     - correctness and bug risk
     - history and git blame context
     - prior PR or discussion context when relevant
     - comments or invariants near the changed code

5. **Confidence-check findings**
   - Re-check each finding with a separate pass before surfacing it.
   - Drop weak or speculative issues.

6. **Filter for signal**
   - Ignore trivial lint, formatting, or typecheck issues that CI should catch separately.
   - Ignore pre-existing issues unless the current PR makes them worse.
   - Keep only the issues that matter to a senior engineer reviewing this change.

7. **Comment or report**
   - If the user asked for a GitHub comment, use gh to post it.
   - Otherwise, present the findings directly in the session.

## Comment Format

Use this structure for final findings:

`markdown
### Code review

Found 2 issues:

1. Brief description of issue
   - Why it matters
   - Evidence: file path or URL with full commit SHA when linking to GitHub

2. Brief description of issue
   - Why it matters
   - Evidence: file path or URL with full commit SHA when linking to GitHub
`

If no issues remain after filtering:

`markdown
### Code review

No actionable issues found. Checked for correctness, local guidance, and regression risk.
`

## Review Rules

- Use gh for GitHub operations when available.
- Prefer concrete evidence over speculation.
- Keep comments brief and free of signatures or emojis.
- Cite paths or links precisely when pointing to code.