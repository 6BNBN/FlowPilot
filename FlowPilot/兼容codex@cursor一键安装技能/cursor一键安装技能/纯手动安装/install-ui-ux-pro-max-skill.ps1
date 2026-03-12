param(
    [string]$TargetCursorHome = (Join-Path $env:USERPROFILE ".cursor")
)

$ErrorActionPreference = "Stop"

function Resolve-CursorHome {
    param([string]$ExplicitPath)

    if ($ExplicitPath) { return [Environment]::ExpandEnvironmentVariables($ExplicitPath) }
    if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE '.cursor') }
    if ($env:HOME) { return (Join-Path $env:HOME '.cursor') }
    throw 'Could not resolve Cursor home. Pass -TargetCursorHome.'
}

function Sync-Skill {
    param(
        [string]$SourceSkillDir,
        [string]$TargetSkillDir
    )

    if (-not (Test-Path $SourceSkillDir)) {
        throw "Bundled ui-ux-pro-max skill not found: $SourceSkillDir"
    }

    if (Test-Path $TargetSkillDir) {
        Remove-Item -Path $TargetSkillDir -Recurse -Force
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $TargetSkillDir) -Force | Out-Null
    Copy-Item -Path $SourceSkillDir -Destination $TargetSkillDir -Recurse -Force
}

$cursorHome = [System.IO.Path]::GetFullPath((Resolve-CursorHome -ExplicitPath $TargetCursorHome))
$sourceSkillDir = Join-Path $PSScriptRoot "skills\ui-ux-pro-max"
$targetSkillDir = Join-Path $cursorHome "skills\ui-ux-pro-max"

Write-Host "[Cursor package][manual] Installing ui-ux-pro-max for Cursor."
Sync-Skill -SourceSkillDir $sourceSkillDir -TargetSkillDir $targetSkillDir

Write-Host "Installed bundled ui-ux-pro-max skill to: $targetSkillDir"
Write-Host "[Cursor package][manual] Completed successfully. Restart Cursor."
