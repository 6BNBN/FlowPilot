---
name: dispatching-parallel-agents
description: Use when facing two or more independent tasks in Cursor that can be investigated or executed in parallel without conflicting edits or shared state.
---
# Dispatching Parallel Agents

## Goal
Speed up independent work by splitting it into isolated parallel tasks.

## When To Use
- unrelated failures in different areas
- separate review tasks on different files
- exploration tasks that do not depend on each other
- implementation tasks that touch different code paths

## Rules
- Only split work that is genuinely independent.
- Avoid parallel edits to the same files unless the plan is coordinated.
- Give each parallel task a narrow scope and a clear expected output.
- Integrate and review the results before declaring success.