$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$manualDir = Get-ChildItem -Path $repoRoot -Directory | Where-Object { $_.Name -notin @(".codex-home-claude-parity", "tests") } | Select-Object -First 1 -ExpandProperty FullName

if (-not $manualDir) {
    throw "Expected manual-install directory under $repoRoot"
}

$installScript = Join-Path $manualDir "install-ui-ux-pro-max-skill.ps1"
$repairScript = Join-Path $manualDir "repair-ui-ux-pro-max-skill.ps1"

foreach ($scriptPath in @($installScript, $repairScript)) {
    if (-not (Test-Path $scriptPath)) {
        throw "Expected manual ui-ux-pro-max script at $scriptPath"
    }
}

function Assert-ScriptInstallsSkill {
    param(
        [string]$ScriptPath,
        [string]$Label
    )

    $tempHome = Join-Path $repoRoot ".tmp-$Label"
    Remove-Item -Path $tempHome -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $tempHome | Out-Null

    try {
        powershell.exe -ExecutionPolicy Bypass -File $ScriptPath -TargetCodexHome $tempHome | Out-Host

        $skillPath = Join-Path $tempHome "skills\ui-ux-pro-max\SKILL.md"
        if (-not (Test-Path $skillPath)) {
            throw "Expected $Label script to install ui-ux-pro-max at $skillPath"
        }
    }
    finally {
        Remove-Item -Path $tempHome -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Assert-ScriptInstallsSkill -ScriptPath $installScript -Label "manual-uiux-install"
Assert-ScriptInstallsSkill -ScriptPath $repairScript -Label "manual-uiux-repair"

Write-Host "PASS: manual ui-ux-pro-max Windows scripts install the bundled skill."
