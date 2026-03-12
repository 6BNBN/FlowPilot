param(
    [string]$TargetCodexHome,
    [switch]$WindowsSafeContext7
)

$ErrorActionPreference = "Stop"

$repairScript = Join-Path $PSScriptRoot "repair-latest-skills-and-mcp.ps1"
if (-not (Test-Path $repairScript)) {
    throw "Missing repair script: $repairScript"
}

& $repairScript -TargetCodexHome $TargetCodexHome -WindowsSafeContext7:$WindowsSafeContext7
