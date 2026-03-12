$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$manualDir = Get-ChildItem -Path $repoRoot -Directory | Where-Object { $_.Name -notin @("skills", "tests") } | Select-Object -First 1

if (-not $manualDir) {
    throw "Missing manual-install directory under repo root."
}

$batFiles = @()
$batFiles += @(Get-ChildItem -Path $repoRoot -File -Filter *.bat)
$batFiles += @(Get-ChildItem -Path $manualDir.FullName -File -Filter *.bat)

foreach ($file in $batFiles) {
    $content = Get-Content -Path $file.FullName -Raw
    foreach ($needle in @("powershell.exe", "pause")) {
        if ($content -notmatch $needle) {
            throw "Expected $($file.FullName) to include '$needle'."
        }
    }
    if ($content -notmatch '%\*') {
        throw "Expected $($file.FullName) to forward optional arguments with %%*."
    }
    if ($content -match '\?\?') {
        throw "Expected $($file.FullName) to avoid corrupted '??' script paths."
    }
}

Write-Host "PASS: Cursor BAT launchers reference valid script paths."
