---
name: writing-skills
description: Use when creating new skills, editing existing skills, or verifying skills before deployment in Codex CLI.
---

# Writing Skills

## Overview

Writing skills is TDD for process documentation: establish a failing baseline, write the minimum skill content that fixes the behavior, then refine it until the workflow is reliable.

**Personal skills live in ~/.codex/skills.**

## Core Principle

If you did not observe a realistic failure mode before writing the skill, you do not yet know what the skill needs to prevent.

## What a Skill Is

A skill is a reusable guide for patterns, tools, or workflows that future Codex sessions should be able to discover and apply.

**Skills are:**
- reusable workflows
- decision guides
- tool usage references
- proven implementation patterns

**Skills are not:**
- project-specific notes better suited for AGENTS.md
- narratives about one past debugging session
- mechanical rules better enforced by automation

## Directory Structure

`	ext
skills/
  skill-name/
    SKILL.md
    supporting-file.md
`

Use a flat namespace and keep supporting files only when the main file would otherwise become too heavy.

## Required SKILL.md Frontmatter

- Only 
ame and description
- 
ame uses letters, numbers, and hyphens only
- description starts with Use when...
- description explains when to load the skill, not the whole workflow

## Discovery Optimization

Future Codex sessions need to find the skill quickly. Optimize for that by:

1. Naming the trigger conditions clearly
2. Putting the highest-signal symptoms in the description
3. Using the same vocabulary users will naturally type
4. Keeping the first screen concise and actionable

## Authoring Workflow

### RED
- Reproduce the failure mode without the skill
- Capture the rationalizations or mistakes that appear

### GREEN
- Write the minimal skill content that closes those gaps
- Include only the steps, examples, and warnings needed to fix the observed failures

### REFACTOR
- Test again under pressure
- Add explicit counters for any new loopholes
- Remove anything that does not help discovery or compliance

## Quality Checklist

Mirror this checklist in update_plan when actively authoring a skill:

- Validate the trigger description
- Validate the frontmatter
- Keep the overview concise
- Include examples only when they improve execution
- Test discovery and compliance with realistic prompts
- Re-check for loopholes before deployment

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Description explains what the skill does | Rewrite it to explain when to load it |
| Frontmatter includes extra keys | Keep only 
ame and description |
| Long narrative examples | Replace with compact reusable examples |
| Supporting docs loaded by default | Move heavy references into separate files |
| No baseline failure observed | Reproduce a realistic failing scenario first |

## Testing

Use subagents or realistic prompts to test:
- discovery
- compliance under pressure
- resistance to shortcut rationalization

The goal is not just "looks good," but "changes behavior predictably."