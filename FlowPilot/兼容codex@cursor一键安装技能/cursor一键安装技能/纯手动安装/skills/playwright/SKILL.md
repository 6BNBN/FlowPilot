---
name: "playwright"
description: "Use when the task requires automating a real browser from the terminal in Cursor, including navigation, form filling, snapshots, screenshots, data extraction, and UI-flow debugging via `playwright-cli` or the bundled wrapper scripts."
---

# Playwright CLI Skill

Drive a real browser from the terminal using `playwright-cli`. In Cursor, prefer the bundled wrapper scripts so the CLI can run even when it is not globally installed.
Treat this skill as CLI-first automation. Do not pivot to `@playwright/test` unless the user explicitly asks for test files.

## Prerequisite check

Before proposing commands, verify that `node`, `npm`, and `npx` are available.

PowerShell:

```powershell
node --version
npm --version
npx --version
```

Bash:

```bash
node --version
npm --version
npx --version
```

If they are missing, pause and ask the user to install Node.js first. A global install of `playwright-cli` is optional; the bundled wrappers use `npx`.

## Skill path in Cursor

When this skill is installed as a Cursor personal skill, it lives under `~/.cursor/skills/playwright/`.

Windows PowerShell:

```powershell
$PWCLI = Join-Path $env:USERPROFILE ".cursor\skills\playwright\scripts\playwright_cli.cmd"
```

Bash:

```bash
export PWCLI="$HOME/.cursor/skills/playwright/scripts/playwright_cli.sh"
```

Prefer the Windows `.cmd` wrapper on Windows and the `.sh` wrapper on bash-compatible shells.

## Quick start

Windows PowerShell:

```powershell
& $PWCLI open https://playwright.dev --headed
& $PWCLI snapshot
& $PWCLI click e15
& $PWCLI type "Playwright"
& $PWCLI press Enter
& $PWCLI screenshot
```

Bash:

```bash
"$PWCLI" open https://playwright.dev --headed
"$PWCLI" snapshot
"$PWCLI" click e15
"$PWCLI" type "Playwright"
"$PWCLI" press Enter
"$PWCLI" screenshot
```

If the user prefers a global install, this is also valid:

```powershell
npm install -g @playwright/cli@latest
playwright-cli --help
```

## Core workflow

1. Open the page.
2. Snapshot to get stable element refs.
3. Interact using refs from the latest snapshot.
4. Re-snapshot after navigation or significant DOM changes.
5. Capture artifacts such as screenshots, PDFs, or traces when useful.

Minimal loop:

```powershell
& $PWCLI open https://example.com
& $PWCLI snapshot
& $PWCLI click e3
& $PWCLI snapshot
```

## When to snapshot again

Snapshot again after:

- navigation
- clicking elements that change the UI substantially
- opening or closing modals or menus
- tab switches

Refs can go stale. When a command fails due to a missing ref, snapshot again.

## Recommended patterns

### Form fill and submit

```powershell
& $PWCLI open https://example.com/form
& $PWCLI snapshot
& $PWCLI fill e1 "user@example.com"
& $PWCLI fill e2 "password123"
& $PWCLI click e3
& $PWCLI snapshot
```

### Debug a UI flow with traces

```powershell
& $PWCLI open https://example.com --headed
& $PWCLI tracing-start
# ...interactions...
& $PWCLI tracing-stop
```

### Multi-tab work

```powershell
& $PWCLI tab-new https://example.com
& $PWCLI tab-list
& $PWCLI tab-select 0
& $PWCLI snapshot
```

## Wrapper scripts

The wrapper scripts use `npx --package @playwright/cli playwright-cli` so the CLI can run without a global install.

Windows PowerShell:

```powershell
& $PWCLI --help
```

Bash:

```bash
"$PWCLI" --help
```

Prefer the bundled wrappers unless the repository already standardizes on a global install.

## References

Open only what you need:

- CLI command reference: `references/cli.md`
- Practical workflows and troubleshooting: `references/workflows.md`

## Guardrails

- Always snapshot before referencing element ids like `e12`.
- Re-snapshot when refs seem stale.
- Prefer explicit commands over `eval` and `run-code` unless needed.
- When you do not have a fresh snapshot, use placeholder refs like `eX` and say why; do not bypass refs with `run-code`.
- Use `--headed` when a visual check will help.
- When capturing artifacts in a repo, prefer `output/playwright/` and avoid introducing new top-level artifact folders unless the project already uses a different convention.
- Default to CLI commands and workflows, not Playwright test specs.
