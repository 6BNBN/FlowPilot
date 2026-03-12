# Skill authoring best practices

Use these principles when writing Codex CLI skills:

## Keep the trigger sharp

- Start descriptions with Use when...
- Name the concrete situation, symptom, or decision point
- Avoid explaining the whole workflow in the description

## Keep the main file concise

- Put the core pattern in SKILL.md
- Move heavy references into supporting files
- Keep examples compact and reusable

## Optimize for discovery

- Use the same words users naturally type
- Mention the failure symptoms that should trigger the skill
- Put the most useful context near the top of the file

## Optimize for execution

- Include steps the agent can actually follow
- Prefer direct instructions over narrative storytelling
- Provide one strong example instead of many mediocre ones

## Validate before shipping

- Test the description against realistic prompts
- Test whether the workflow changes behavior under pressure
- Re-check for invalid frontmatter or stale platform-specific wording