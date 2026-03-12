---
name: writing-skills
description: Use when creating, editing, or validating Cursor custom skills, especially when deciding where they should live, how they should be named, and how to describe when they apply.
---
# Writing Skills

## Goal
Create skills that Cursor can discover and apply effectively.

## Storage Locations
- Personal skills: `~/.cursor/skills/`
- Project skills: `.cursor/skills/`

Do not create custom skills in `~/.cursor/skills-cursor/`; that directory is reserved for Cursor's built-in skills.

## Good Skill Structure
Each skill should live in its own directory:

```text
skill-name/
  SKILL.md
  optional-reference.md
  optional-examples.md
```

## SKILL.md Requirements
- YAML frontmatter with `name` and `description`
- concise body with clear instructions
- optional references for heavier material

## Naming Rules
- lowercase letters, numbers, and hyphens
- short, descriptive, and easy to trigger from user language

## Description Rules
- say what the skill is for and when to use it
- include likely trigger words
- avoid vague labels like "helper" or "workflow"

## Authoring Advice
- optimize for real usage, not theory
- keep the main file concise
- move heavier references into separate files
- test the skill on realistic prompts after writing it