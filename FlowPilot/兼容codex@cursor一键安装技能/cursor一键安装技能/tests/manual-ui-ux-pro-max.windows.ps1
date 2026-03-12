$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PWD "cursor一键安装技能"))
$manualDir = Get-ChildItem -Path $repoRoot -Directory | Where-Object { $_.Name -notin @("skills", "tests") -and $_.Name -notlike ".tmp-*" } | Select-Object -First 1

if (-not $manualDir) {
    throw "Expected manual-install directory under $repoRoot"
}

$installScript = [System.IO.Path]::Combine($manualDir.FullName, "install-ui-ux-pro-max-skill.ps1")
$repairScript = [System.IO.Path]::Combine($manualDir.FullName, "repair-ui-ux-pro-max-skill.ps1")

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

    $tempHome = [System.IO.Path]::Combine($repoRoot, ".tmp-$Label")
    Remove-Item -Path $tempHome -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $tempHome | Out-Null

    try {
        powershell.exe -ExecutionPolicy Bypass -File $ScriptPath -TargetCursorHome $tempHome | Out-Host

        $skillPath = [System.IO.Path]::Combine($tempHome, "skills", "ui-ux-pro-max", "SKILL.md")
        if (-not (Test-Path $skillPath)) {
            throw "Expected $Label script to install ui-ux-pro-max at $skillPath"
        }
    }
    finally {
        Remove-Item -Path $tempHome -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Assert-ScriptInstallsSkill -ScriptPath $installScript -Label "cursor-manual-uiux-install"
Assert-ScriptInstallsSkill -ScriptPath $repairScript -Label "cursor-manual-uiux-repair"

Write-Host "PASS: Cursor manual ui-ux-pro-max Windows scripts install the bundled skill."
