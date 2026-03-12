$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$manualDir = Get-ChildItem -Path $repoRoot -Directory | Where-Object { $_.Name -notin @(".codex-home-claude-parity", "tests") -and $_.Name -notlike ".tmp-*" } | Select-Object -First 1

if (-not $manualDir) {
    throw "Missing manual-install directory under repo root."
}

$scriptFiles = @(
    (Join-Path $repoRoot "install-latest-skills-and-mcp.ps1"),
    (Join-Path $repoRoot "install.sh"),
    (Join-Path $repoRoot "update-ui-ux-pro-max-skill.ps1"),
    (Join-Path $repoRoot "update-ui-ux-pro-max-skill.sh"),
    (Join-Path $manualDir.FullName "install_context7_mcp.sh"),
    (Join-Path $manualDir.FullName "install-ui-ux-pro-max-skill.ps1"),
    (Join-Path $manualDir.FullName "install_ui_ux_pro_max_skill.sh")
)

$manualContext7Ps1 = Get-ChildItem -Path $manualDir.FullName -File -Filter *.ps1 |
    Where-Object { (Get-Content -Path $_.FullName -Raw) -match "Configured MCP server: context7" } |
    Select-Object -First 1 -ExpandProperty FullName

$scriptFiles += $manualContext7Ps1

foreach ($path in $scriptFiles) {
    if (-not $path -or -not (Test-Path $path)) {
        throw "Missing script for completion-message check: $path"
    }

    $content = Get-Content -Path $path -Raw
    if ($content -notmatch "Completed successfully\. Restart Codex CLI\.") {
        throw "Expected $path to use the unified completion message."
    }
}

Write-Host "PASS: PowerShell and shell scripts use the unified completion message."
