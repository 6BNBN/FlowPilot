# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent.

**Purpose:** Verify implementation is well-built, tested, and maintainable.

**Only dispatch after spec compliance review passes.**

`	ext
spawn_agent tool:
  role: reviewer
  description: "Review code quality for Task N"
  prompt: |
    Review the implementation with a code-quality lens.

    WHAT_WAS_IMPLEMENTED: [from implementer's report]
    PLAN_OR_REQUIREMENTS: Task N from [plan-file]
    BASE_SHA: [commit before task]
    HEAD_SHA: [current commit]
    DESCRIPTION: [task summary]
`

**Code reviewer returns:** strengths, issues (Critical/Important/Minor), and overall assessment.