# Codex-Native Pull Request Review Command

Use this workflow to review a pull request or diff with Codex CLI:

1. Confirm the change still needs review.
2. Gather relevant AGENTS.md files for the touched paths.
3. Summarize the change once.
4. Launch parallel review passes with different lenses.
5. Re-check each finding for confidence and false positives.
6. Filter down to actionable, high-signal issues only.
7. Present the findings or post them with gh if requested.

## Final Output

`markdown
### Code review

Found N issues:

1. Brief issue summary
   - Why it matters
   - Evidence: precise file path or GitHub URL with full commit SHA
`

If no issues survive filtering:

`markdown
### Code review

No actionable issues found. Checked for correctness, local guidance, and regression risk.
`