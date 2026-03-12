---
name: feature-dev
description: Use when building a new feature or substantial behavior change in Cursor and the user wants a structured workflow from discovery through implementation and review.
---
# Feature Development

## Goal
Build features with a clear, reviewable flow: understand first, design second, implement third, verify last.

## Workflow
### 1. Discovery
- Restate the feature in plain language.
- Identify success criteria, constraints, and unclear details.
- Ask questions before designing if important behavior is unspecified.

### 2. Codebase Exploration
- Read the most relevant files and similar features.
- Reuse existing patterns for architecture, UI, state, tests, and naming.
- Note extension points and project conventions before proposing changes.

### 3. Design
- Present one recommended approach or 2-3 approaches if trade-offs are meaningful.
- Explain the impact on files, behavior, tests, and user experience.
- Get user approval before implementation.

### 4. Implementation
- Keep scope aligned with the approved plan.
- Prefer incremental edits over broad refactors.
- Add or update tests when behavior changes.
- For design-heavy UI work, combine with `frontend-design` after the approach is approved.

### 5. Review And Verification
- Self-check for regressions, accessibility issues, and confusing behavior.
- Run the most relevant validation steps for the change.
- Use `code-review` for a focused review if the task is non-trivial.

### 6. Summary
Report:
- What was built
- Key assumptions or decisions
- What was verified
- Any remaining risks or follow-up work

## Output Structure
When helpful, organize responses as:
- Summary
- Questions or assumptions
- Proposed approach
- Implementation
- Verification