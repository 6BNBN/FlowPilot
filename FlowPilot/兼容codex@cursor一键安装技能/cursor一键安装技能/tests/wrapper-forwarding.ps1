$ErrorActionPreference = "Stop"

$selfPath = (Resolve-Path $PSCommandPath).Path
$testsDir = Split-Path -Parent $selfPath
$repoRoot = Split-Path -Parent $testsDir
$manualDir = Get-ChildItem -Path $repoRoot -Directory |
    Where-Object { $_.Name -notin @("skills", "tests") -and $_.Name -notlike ".tmp-*" } |
    Select-Object -First 1

if (-not $manualDir) {
    throw "Missing manual-install directory under repo root."
}

$wrapperFiles = @(
    (Join-Path $repoRoot "install-latest-skills-and-mcp.ps1"),
    (Join-Path $repoRoot "repair-latest-skills-and-mcp.ps1"),
    (Join-Path $repoRoot "self-check-cursor-skills-and-mcp.ps1"),
    (Join-Path $manualDir.FullName "install-context7-mcp.ps1")
)

foreach ($path in $wrapperFiles) {
    if (-not (Test-Path $path)) {
        throw "Missing wrapper script: $path"
    }

    $content = Get-Content -Path $path -Raw
    if ($content -notmatch '\$PSBoundParameters\.ContainsKey\(') {
        throw "Expected wrapper to only forward explicitly provided parameters: $path"
    }
}

Write-Host "PASS: Cursor wrapper scripts only forward explicitly provided parameters."
