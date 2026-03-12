$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$manualDir = Get-ChildItem -Path $repoRoot -Directory | Where-Object { $_.Name -notin @(".codex-home-claude-parity", "tests") } | Select-Object -First 1

if (-not $manualDir) {
    throw "Missing manual-install directory under repo root."
}

$batFiles = @()
$batFiles += Get-ChildItem -Path $repoRoot -File -Filter *.bat
$batFiles += Get-ChildItem -Path $manualDir.FullName -File -Filter *.bat

if ($batFiles.Count -lt 7) {
    throw "Expected user-facing BAT launchers in repo root and manual-install directories."
}

foreach ($file in $batFiles) {
    $content = Get-Content -Path $file.FullName -Raw
    foreach ($needle in @("powershell.exe", "EXITCODE", "pause")) {
        if ($content -notmatch $needle) {
            throw "Expected $($file.FullName) to include '$needle' for non-flashing launcher behavior."
        }
    }
}

Write-Host "PASS: BAT launchers preserve output and pause before exit."
