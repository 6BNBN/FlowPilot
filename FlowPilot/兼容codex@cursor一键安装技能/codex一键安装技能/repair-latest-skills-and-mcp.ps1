param(
    [string]$TargetCodexHome,
    [switch]$WindowsSafeContext7
)

$ErrorActionPreference = "Stop"

$installScript = Join-Path $PSScriptRoot "install-latest-skills-and-mcp.ps1"
if (-not (Test-Path $installScript)) {
    throw "Missing install script: $installScript"
}

Write-Host "[Codex package] Running repair for Codex CLI."
& $installScript -TargetCodexHome $TargetCodexHome -Force -WindowsSafeContext7:$WindowsSafeContext7
