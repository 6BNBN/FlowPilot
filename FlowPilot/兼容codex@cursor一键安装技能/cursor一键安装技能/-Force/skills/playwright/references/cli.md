# Playwright CLI Reference

Use the bundled wrapper script unless the CLI is already installed globally.

Windows PowerShell:

```powershell
$PWCLI = Join-Path $env:USERPROFILE ".cursor\skills\playwright\scripts\playwright_cli.cmd"
& $PWCLI --help
```

Bash:

```bash
export PWCLI="$HOME/.cursor/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" --help
```

Optional convenience alias in PowerShell:

```powershell
function pwcli { & $PWCLI @Args }
```

Optional convenience alias in bash:

```bash
alias pwcli="$PWCLI"
```

## Core

```powershell
pwcli open https://example.com
pwcli close
pwcli snapshot
pwcli click e3
pwcli dblclick e7
pwcli type "search terms"
pwcli press Enter
pwcli fill e5 "user@example.com"
pwcli drag e2 e8
pwcli hover e4
pwcli select e9 "option-value"
pwcli upload ./document.pdf
pwcli check e12
pwcli uncheck e12
pwcli eval "document.title"
pwcli eval "el => el.textContent" e5
pwcli dialog-accept
pwcli dialog-accept "confirmation text"
pwcli dialog-dismiss
pwcli resize 1920 1080
```

## Navigation

```powershell
pwcli go-back
pwcli go-forward
pwcli reload
```

## Keyboard

```powershell
pwcli press Enter
pwcli press ArrowDown
pwcli keydown Shift
pwcli keyup Shift
```

## Mouse

```powershell
pwcli mousemove 150 300
pwcli mousedown
pwcli mousedown right
pwcli mouseup
pwcli mouseup right
pwcli mousewheel 0 100
```

## Save as

```powershell
pwcli screenshot
pwcli screenshot e5
pwcli pdf
```

## Tabs

```powershell
pwcli tab-list
pwcli tab-new
pwcli tab-new https://example.com/page
pwcli tab-close
pwcli tab-close 2
pwcli tab-select 0
```

## DevTools

```powershell
pwcli console
pwcli console warning
pwcli network
pwcli run-code "await page.waitForTimeout(1000)"
pwcli tracing-start
pwcli tracing-stop
```

## Sessions

Use a named session to isolate work:

```powershell
pwcli --session todo open https://demo.playwright.dev/todomvc
pwcli --session todo snapshot
```

Or set an environment variable once.

PowerShell:

```powershell
$env:PLAYWRIGHT_CLI_SESSION = "todo"
pwcli open https://demo.playwright.dev/todomvc
```

Bash:

```bash
export PLAYWRIGHT_CLI_SESSION=todo
pwcli open https://demo.playwright.dev/todomvc
```
