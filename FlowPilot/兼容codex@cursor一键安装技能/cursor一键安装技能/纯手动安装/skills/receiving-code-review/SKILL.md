---
name: receiving-code-review
description: Use when acting on code review feedback in Cursor, especially if suggestions seem unclear, debatable, or risky. Helps evaluate feedback technically before changing code.
---
# Receiving Code Review

## Goal
Respond to feedback with technical judgment, not automatic agreement.

## Workflow
1. Read the feedback fully.
2. Restate each actionable point in technical terms.
3. Verify whether it applies to this codebase and this change.
4. Ask for clarification if any point is ambiguous.
5. Implement validated feedback in a safe order.
6. Re-test the affected behavior.

## Rules
- Do not blindly apply every suggestion.
- Do not start coding until unclear feedback is clarified.
- Push back politely when a suggestion is incorrect, out of scope, or harmful.
- Prefer one fix at a time when multiple review items interact.

## Good Responses
- "I understand the issue as X. I will verify it against the current flow."
- "Items 1 and 2 are clear. Item 3 needs clarification before I change behavior."
- "This suggestion appears to conflict with the existing API contract; here is why."