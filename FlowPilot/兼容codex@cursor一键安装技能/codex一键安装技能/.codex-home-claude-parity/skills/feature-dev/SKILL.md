---
name: feature-dev
description: Use when the user asks to build a new feature and wants a structured Codex CLI workflow with discovery, clarifying questions, architecture comparison, implementation, and review.
---

# Codex-Native Feature Development

Use this workflow when a feature request needs structured discovery before implementation. Keep update_plan current throughout, and use parallel explorer subagents for research only when their scopes are independent.

## Source of truth
- eferences/feature-dev-command.md
- eferences/agent-prompts/code-architect.md
- eferences/agent-prompts/code-explorer.md
- eferences/agent-prompts/code-reviewer.md

## Core Principles

- **Ask clarifying questions early** when behavior, edge cases, or scope are underspecified.
- **Understand before acting** by reading existing code patterns first.
- **Read the files surfaced by subagents** instead of relying on summaries alone.
- **Prefer simple, maintainable designs** over clever abstractions.
- **Use update_plan** to track progress and checkpoints.

## Phase 1: Discovery

**Goal:** Understand what needs to be built.

**Actions:**
1. Create a plan that covers discovery, design, implementation, and review.
2. If the request is underspecified, ask concrete clarifying questions.
3. Summarize your understanding and confirm it with the user.

## Phase 2: Codebase Exploration

**Goal:** Understand relevant code and patterns.

**Actions:**
1. Spawn 2-3 explorer subagents in parallel with disjoint research scopes.
2. Ask each subagent to return the 5-10 most important files to read next.
3. Read the returned files yourself and consolidate the patterns you found.

## Phase 3: Clarifying Questions

**Goal:** Resolve ambiguities before design.

**Actions:**
1. Review the request and the exploration findings.
2. Identify missing details around scope, data flow, UX, errors, compatibility, and testing.
3. Present the open questions clearly.
4. Wait for user answers before designing architecture.

## Phase 4: Architecture Design

**Goal:** Compare implementation approaches with trade-offs.

**Actions:**
1. If the feature is large enough to justify it, spawn 2-3 explorer or worker subagents to propose different architectural approaches.
2. Compare the approaches by change size, maintainability, risk, and implementation speed.
3. Recommend one approach and explain why it fits best.
4. Ask the user to confirm the direction.

## Phase 5: Implementation

**Goal:** Build the chosen solution.

**Actions:**
1. Do not start coding until the user approves the design.
2. Re-read the relevant files before editing.
3. Implement the approved approach with minimal, focused changes.
4. Update update_plan as work progresses.

## Phase 6: Quality Review

**Goal:** Catch bugs, unnecessary complexity, and convention drift.

**Actions:**
1. Spawn review subagents with different lenses such as correctness, simplicity, and conventions.
2. Consolidate the findings into a short actionable list.
3. Present the findings and recommended fixes.
4. Address the agreed changes before final handoff.

## Phase 7: Summary

**Goal:** Hand off the finished work clearly.

**Actions:**
1. Mark the plan complete.
2. Summarize what was built, key decisions, files touched, and suggested next steps.