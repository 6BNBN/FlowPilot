---
name: verification-before-completion
description: Use before claiming work is complete, fixed, or passing in Cursor. Requires fresh verification evidence such as tests, builds, lint output, or direct reproduction checks.
---
# Verification Before Completion

## Rule
Do not claim success without fresh evidence.

## Checklist
1. Identify what command or action proves the claim.
2. Run it now, not from memory.
3. Read the result carefully.
4. Report the real status.

## Examples
- Tests pass: only after running the relevant test command.
- Bug fixed: only after reproducing the original issue path and seeing the correct behavior.
- Build succeeds: only after a successful build.
- Review complete: only after actually checking the relevant files or diff.

## Avoid
- "Should be fixed now"
- "Looks good"
- "Probably passes"
- trusting stale output