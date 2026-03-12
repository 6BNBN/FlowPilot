param(
    [string]$TargetCodexHome,
    [switch]$Force,
    [switch]$WindowsSafeContext7
)

$ErrorActionPreference = "Stop"

$installScript = Join-Path $PSScriptRoot "install-latest-skills-and-mcp.ps1"
if (-not (Test-Path $installScript)) {
    throw "Missing install script: $installScript"
}

& $installScript -TargetCodexHome $TargetCodexHome -Force:$Force -WindowsSafeContext7:$WindowsSafeContext7
