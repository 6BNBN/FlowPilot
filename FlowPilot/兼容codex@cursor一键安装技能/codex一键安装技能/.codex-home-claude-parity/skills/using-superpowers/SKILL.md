---
name: using-superpowers
description: Use when starting any conversation to discover relevant skills and open the right SKILL.md files before responding, including before clarifying questions.
---

<EXTREMELY-IMPORTANT>
If there is even a 1% chance that a skill applies, open it and follow it before responding.

If a relevant skill exists, you do not get to skip it because the task feels small or familiar.
</EXTREMELY-IMPORTANT>

## How to Access Skills

**In Codex CLI:** Open the relevant SKILL.md under ~/.codex/skills or the workspace-provided skill pack, then follow it directly.

**If a skill includes a checklist:** mirror the checklist in update_plan so progress stays visible while you work.

# Using Skills

## The Rule

**Open relevant or requested skills before any response or action.** Even a 1% chance that a skill applies means you should inspect it first. If a skill turns out not to fit, you can stop using it after reading it.

`dot
digraph skill_flow {
    "User message received" [shape=doublecircle];
    "About to start work?" [shape=doublecircle];
    "Already brainstormed?" [shape=diamond];
    "Open brainstorming skill" [shape=box];
    "Might a skill apply?" [shape=diamond];
    "Open matching SKILL.md" [shape=box];
    "Announce: Using [skill]" [shape=box];
    "Has checklist?" [shape=diamond];
    "Mirror checklist in update_plan" [shape=box];
    "Follow skill exactly" [shape=box];
    "Respond" [shape=doublecircle];

    "About to start work?" -> "Already brainstormed?";
    "Already brainstormed?" -> "Open brainstorming skill" [label="no"];
    "Already brainstormed?" -> "Might a skill apply?" [label="yes"];
    "Open brainstorming skill" -> "Might a skill apply?";

    "User message received" -> "Might a skill apply?";
    "Might a skill apply?" -> "Open matching SKILL.md" [label="yes, even 1%"];
    "Might a skill apply?" -> "Respond" [label="definitely not"];
    "Open matching SKILL.md" -> "Announce: Using [skill]";
    "Announce: Using [skill]" -> "Has checklist?";
    "Has checklist?" -> "Mirror checklist in update_plan" [label="yes"];
    "Has checklist?" -> "Follow skill exactly" [label="no"];
    "Mirror checklist in update_plan" -> "Follow skill exactly";
}
`

## Red Flags

These thoughts mean STOP and open the skill first:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes before clarifying questions. |
| "Let me explore quickly first" | Skills tell you how to explore. Check first. |
| "I remember this skill already" | Skills evolve. Read the current file. |
| "The skill is overkill" | Small tasks still benefit from the right workflow. |
| "I'll do one thing first" | Check before acting. |

## Skill Priority

When multiple skills could apply, use this order:

1. **Process skills first** - brainstorming, debugging, TDD, verification
2. **Implementation skills second** - frontend, review, feature workflows

## Skill Types

**Rigid** skills enforce a workflow and should be followed closely.

**Flexible** skills provide patterns you can adapt to context.

## User Instructions

User instructions say **what** to do. Skills tell you **how** to do it safely and consistently.