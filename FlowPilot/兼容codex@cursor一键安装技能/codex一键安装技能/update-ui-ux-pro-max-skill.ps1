param(
    [string]$TargetCodexHome
)

$ErrorActionPreference = "Stop"

function Test-WindowsPlatform {
    return $env:OS -eq "Windows_NT"
}

function Resolve-CodexHome {
    param([string]$ExplicitPath)

    if ($ExplicitPath) {
        return [Environment]::ExpandEnvironmentVariables($ExplicitPath)
    }

    if ($env:CODEX_HOME) {
        return [Environment]::ExpandEnvironmentVariables($env:CODEX_HOME)
    }

    if (Test-WindowsPlatform) {
        if (-not $env:USERPROFILE) {
            throw "USERPROFILE is not set. Pass -TargetCodexHome or set CODEX_HOME."
        }

        return (Join-Path $env:USERPROFILE ".codex")
    }

    if (-not $env:HOME) {
        throw "HOME is not set. Pass -TargetCodexHome or set CODEX_HOME."
    }

    return (Join-Path $env:HOME ".codex")
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
$sourceSkillDir = Join-Path $PSScriptRoot ".codex-home-claude-parity\skills\ui-ux-pro-max"
$targetSkillDir = Join-Path $codexHome "skills\ui-ux-pro-max"

Sync-Skill -SourceSkillDir $sourceSkillDir -TargetSkillDir $targetSkillDir

Write-Host "Reinstalled bundled ui-ux-pro-max skill to: $targetSkillDir"
Write-Host "Completed successfully. Restart Codex CLI."
