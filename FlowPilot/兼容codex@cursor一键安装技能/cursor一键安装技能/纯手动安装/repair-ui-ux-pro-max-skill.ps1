param(
    [string]$TargetCursorHome = (Join-Path $env:USERPROFILE ".cursor")
)

$ErrorActionPreference = "Stop"

$installScript = Join-Path $PSScriptRoot "install-ui-ux-pro-max-skill.ps1"
if (-not (Test-Path $installScript)) {
    throw "Missing install script: $installScript"
}

& $installScript -TargetCursorHome $TargetCursorHome
