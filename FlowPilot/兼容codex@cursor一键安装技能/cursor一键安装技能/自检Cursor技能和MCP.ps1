param(
    [string]$TargetCursorHome = (Join-Path $env:USERPROFILE ".cursor")
)

$ErrorActionPreference = "Stop"

function Test-PathAndReport {
    param(
        [string]$Label,
        [string]$Path,
        [switch]$Directory
    )

    $exists = Test-Path $Path
    if ($exists) {
        Write-Host "[OK] $Label -> $Path"
    } else {
        Write-Host "[MISSING] $Label -> $Path"
    }

    return $exists
}

Write-Host "Checking Cursor install package state under: $TargetCursorHome"

$allOk = $true

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[MISSING] node is not available on PATH"
    $allOk = $false
} else {
    Write-Host "[OK] node -> $((node --version))"
}

if (-not (Get-Command python -ErrorAction SilentlyContinue) -and -not (Get-Command python3 -ErrorAction SilentlyContinue)) {
    Write-Host "[MISSING] python3 or python is not available on PATH"
    $allOk = $false
} else {
    if (Get-Command python -ErrorAction SilentlyContinue) {
        Write-Host "[OK] python -> $((python --version))"
    } else {
        Write-Host "[OK] python3 -> $((python3 --version))"
    }
}

$skillsDir = Join-Path $TargetCursorHome "skills"
$mcpPath = Join-Path $TargetCursorHome "mcp.json"
$context7Local = Join-Path $TargetCursorHome "context7-local"
$context7Entry = Join-Path $context7Local "node_modules\@upstash\context7-mcp\dist\index.js"
$context7LauncherCmd = Join-Path $TargetCursorHome "run-context7.cmd"
$playwrightSkill = Join-Path $skillsDir "playwright"
$playwrightCmd = Join-Path $playwrightSkill "scripts\playwright_cli.cmd"
$uiUxSkill = Join-Path $skillsDir "ui-ux-pro-max"
$uiUxSearch = Join-Path $uiUxSkill "scripts\search.py"

$allOk = (Test-PathAndReport -Label "skills directory" -Path $skillsDir -Directory) -and $allOk
$allOk = (Test-PathAndReport -Label "mcp.json" -Path $mcpPath) -and $allOk
$allOk = (Test-PathAndReport -Label "context7 local runtime" -Path $context7Local -Directory) -and $allOk
$allOk = (Test-PathAndReport -Label "context7 entry" -Path $context7Entry) -and $allOk
$allOk = (Test-PathAndReport -Label "context7 launcher" -Path $context7LauncherCmd) -and $allOk
$allOk = (Test-PathAndReport -Label "playwright skill" -Path $playwrightSkill -Directory) -and $allOk
$allOk = (Test-PathAndReport -Label "playwright Windows wrapper" -Path $playwrightCmd) -and $allOk
$allOk = (Test-PathAndReport -Label "ui-ux-pro-max skill" -Path $uiUxSkill -Directory) -and $allOk
$allOk = (Test-PathAndReport -Label "ui-ux-pro-max search script" -Path $uiUxSearch) -and $allOk

if (Test-Path $mcpPath) {
    try {
        $config = Get-Content -Raw -Path $mcpPath | ConvertFrom-Json
        if ($null -ne $config.mcpServers.context7 -and $config.mcpServers.context7.command -eq $context7LauncherCmd) {
            Write-Host "[OK] mcpServers.context7 points to the local launcher"
        } else {
            Write-Host "[MISSING] mcpServers.context7 is missing or does not point to the local launcher"
            $allOk = $false
        }
    } catch {
        Write-Host "[INVALID] mcp.json is not valid JSON"
        $allOk = $false
    }
}

if (Test-Path $context7Entry) {
    $helpOutput = node $context7Entry --help 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] context7 local entry starts successfully"
    } else {
        Write-Host "[FAILED] context7 local entry did not start successfully"
        $allOk = $false
    }
}

if ($allOk) {
    Write-Host "Self-check passed. Restart Cursor if you just installed or repaired."
    exit 0
}

Write-Host "Self-check found issues. Review the messages above."
exit 1
