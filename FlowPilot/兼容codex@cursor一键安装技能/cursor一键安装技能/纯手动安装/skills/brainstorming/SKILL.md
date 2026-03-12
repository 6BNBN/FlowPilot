---
name: brainstorming
description: Use before implementing a new feature, changing behavior, or making design-heavy decisions in Cursor. Helps clarify intent, explore approaches, and get approval before coding.
---
# Brainstorming

## Purpose
Turn an idea into an approved design before implementation starts.

## Workflow
1. Review the current project context.
2. Ask focused clarifying questions, preferably one at a time.
3. Summarize the problem, constraints, and success criteria.
4. Propose 2-3 approaches when trade-offs matter.
5. Recommend one approach with reasoning.
6. Present the design and get approval before coding.

## What To Cover
- User goal
- Scope boundaries
- Key UI or architecture decisions
- Data flow or state handling
- Error handling
- Testing and verification

## Rules
- Do not jump into implementation on an underspecified request.
- Prefer smaller scope unless the user explicitly wants more.
- If the user says "you decide", still present your recommendation before coding.
- If the task is large or the user wants a formal artifact, save the design to `docs/plans/YYYY-MM-DD-<topic>-design.md`.

## After Approval
- If the user wants a formal implementation plan, use `writing-plans`.
- If the user wants direct implementation, proceed using the approved design.