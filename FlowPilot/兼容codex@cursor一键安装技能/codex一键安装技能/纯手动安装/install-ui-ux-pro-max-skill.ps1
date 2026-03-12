param(
    [string]$TargetCodexHome
)

$ErrorActionPreference = "Stop"

function Resolve-CodexHome {
    param([string]$ExplicitPath)

    if ($ExplicitPath) { return [Environment]::ExpandEnvironmentVariables($ExplicitPath) }
    if ($env:CODEX_HOME) { return [Environment]::ExpandEnvironmentVariables($env:CODEX_HOME) }
    if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE '.codex') }
    if ($env:HOME) { return (Join-Path $env:HOME '.codex') }
    throw 'Could not resolve CODEX_HOME. Pass -TargetCodexHome or set CODEX_HOME.'
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

$codexHome = [System.IO.Path]::GetFullPath((Resolve-CodexHome -ExplicitPath $TargetCodexHome))
$sourceSkillDir = Join-Path $PSScriptRoot "skills\ui-ux-pro-max"
$targetSkillDir = Join-Path $codexHome "skills\ui-ux-pro-max"

Write-Host "[Codex package][manual] Installing ui-ux-pro-max for Codex CLI."
Sync-Skill -SourceSkillDir $sourceSkillDir -TargetSkillDir $targetSkillDir

Write-Host "Installed bundled ui-ux-pro-max skill to: $targetSkillDir"
Write-Host "[Codex package][manual] Completed successfully. Restart Codex CLI."
