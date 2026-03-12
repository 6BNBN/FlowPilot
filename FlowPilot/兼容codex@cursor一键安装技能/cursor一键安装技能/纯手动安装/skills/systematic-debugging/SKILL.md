---
name: systematic-debugging
description: Use when diagnosing a bug, failing test, build issue, or unexpected behavior in Cursor before proposing a fix. Focus on reproducing the issue, tracing the cause, and validating the repair.
---
# Systematic Debugging

## Goal
Find the root cause before making changes.

## Workflow
1. Reproduce the issue reliably.
2. Read the exact error output and identify where it surfaces.
3. Check recent changes, configuration, and environmental differences.
4. Compare the broken path to a working example when possible.
5. Form one concrete hypothesis at a time.
6. Make the smallest change needed to test that hypothesis.
7. Verify the result before moving on.

## Rules
- Do not stack multiple speculative fixes together.
- Do not call something fixed without reproducing the original path again.
- If three attempted fixes fail, step back and question the design or architecture.
- For behavior bugs, pair this with `test-driven-development` when possible.
- Before declaring success, use `verification-before-completion`.

## Debugging Notes
- Log key boundaries in multi-step systems.
- Trace bad values back to their origin rather than patching symptoms.
- Prefer evidence and comparison over intuition.
- Ask for clarification when the system behavior or expected outcome is unclear.