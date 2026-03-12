param(
    [string]$TargetCodexHome
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "安装context7-MCP.ps1"
if (-not (Test-Path $scriptPath)) {
    throw "Missing install script: $scriptPath"
}

& $scriptPath -TargetCodexHome $TargetCodexHome
