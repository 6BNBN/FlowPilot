---
name: test-driven-development
description: Use when implementing a feature, fixing a bug, or changing behavior in Cursor and you want a disciplined red-green-refactor workflow.
---
# Test-Driven Development

## Goal
Write the failing test first, then the smallest implementation that makes it pass.

## Workflow
1. Write one failing test for one behavior.
2. Run it and confirm it fails for the right reason.
3. Implement the minimal code needed to pass.
4. Re-run the test and nearby checks.
5. Refactor while keeping everything green.
6. Repeat for the next behavior.

## Rules
- No production code before a failing test unless the user explicitly asks to skip TDD.
- Keep tests focused on behavior, not incidental implementation details.
- Prefer real code paths over heavy mocking.
- If the test passes immediately, you are probably testing existing behavior or the wrong thing.
- Use `verification-before-completion` before claiming the bug or feature is finished.

## Good Test Qualities
- one behavior
- clear name
- obvious expected outcome
- minimal setup
- catches the intended regression