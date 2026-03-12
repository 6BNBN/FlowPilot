---
name: requesting-code-review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements.
---

# Requesting Code Review

Dispatch a review subagent or run the code-review workflow before issues compound.

## When to Request Review

**Mandatory:**
- After each task in subagent-driven development
- After a major feature lands
- Before merge to main

**Optional but valuable:**
- When stuck and you want a fresh perspective
- Before a risky refactor
- After fixing a subtle bug

## How to Request

1. Gather the context to review:
   - what changed
   - what it was supposed to do
   - the relevant diff or commit range

2. Dispatch a review subagent:
   - use spawn_agent
   - give it the requirements, diff context, and any relevant AGENTS.md guidance
   - when reviewing GitHub PRs, include the PR number and gh workflow details if available

3. Act on the findings:
   - fix critical issues immediately
   - fix important issues before proceeding
   - document any deferred minor issues

## Review Prompt Inputs

- WHAT_WAS_IMPLEMENTED
- PLAN_OR_REQUIREMENTS
- BASE_SHA
- HEAD_SHA
- DESCRIPTION

## Red Flags

- Skipping review because the change feels simple
- Ignoring critical issues
- Proceeding with unfixed important issues
- Accepting review feedback without technical verification

See code-reviewer.md for the reusable review prompt template.