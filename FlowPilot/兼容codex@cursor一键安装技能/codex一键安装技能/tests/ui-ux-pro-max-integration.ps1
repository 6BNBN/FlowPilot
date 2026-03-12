$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$bundleSkillPath = Join-Path $repoRoot ".codex-home-claude-parity\skills\ui-ux-pro-max\SKILL.md"
$updatePs1Path = Join-Path $repoRoot "update-ui-ux-pro-max-skill.ps1"
$updateShPath = Join-Path $repoRoot "update-ui-ux-pro-max-skill.sh"
$updateBatPath = Get-ChildItem -Path $repoRoot -File -Filter "*.bat" | Where-Object { $_.Name -like "*ui-ux-pro-max*" } | Select-Object -First 1 -ExpandProperty FullName
$manualDir = Get-ChildItem -Path $repoRoot -Directory | Where-Object { $_.Name -notin @(".codex-home-claude-parity", "tests") } | Select-Object -First 1 -ExpandProperty FullName
$manualBundleSkillPath = Join-Path $manualDir "skills\ui-ux-pro-max\SKILL.md"
$manualInstallPs1Path = Join-Path $manualDir "install-ui-ux-pro-max-skill.ps1"
$manualRepairPs1Path = Join-Path $manualDir "repair-ui-ux-pro-max-skill.ps1"
$manualInstallShPath = Join-Path $manualDir "install_ui_ux_pro_max_skill.sh"
$manualRepairShPath = Join-Path $manualDir "repair_ui_ux_pro_max_skill.sh"
$manualBatPaths = Get-ChildItem -Path $manualDir -File -Filter "*.bat" | Where-Object { $_.Name -like "*ui-ux-pro-max*" }

if (-not $manualDir) {
    throw "Expected manual-install directory under $repoRoot"
}

if (-not (Test-Path $bundleSkillPath)) {
    throw "Expected bundled ui-ux-pro-max skill at $bundleSkillPath"
}

if (-not (Test-Path $manualBundleSkillPath)) {
    throw "Expected manual-install ui-ux-pro-max skill at $manualBundleSkillPath"
}

foreach ($path in @($updatePs1Path, $updateShPath, $updateBatPath)) {
    if (-not (Test-Path $path)) {
        throw "Expected update script at $path"
    }
}

foreach ($path in @($manualInstallPs1Path, $manualRepairPs1Path, $manualInstallShPath, $manualRepairShPath)) {
    if (-not (Test-Path $path)) {
        throw "Expected manual-install ui-ux-pro-max script at $path"
    }
}

if ($manualBatPaths.Count -lt 2) {
    throw "Expected at least 2 manual-install ui-ux-pro-max .bat launchers under $manualDir"
}

foreach ($scriptPath in @($updatePs1Path, $updateShPath)) {
    $content = Get-Content -Path $scriptPath -Raw
    foreach ($keyword in @("SourceRepoPath", "source-repo-path", "SourceZipUrl", "source-zip-url", "refs/heads", "Invoke-WebRequest")) {
        if ($content -match $keyword) {
            throw "Expected $scriptPath to avoid external source update logic ('$keyword')."
        }
    }
}

$docPaths = @((Join-Path $repoRoot "README.md"))
$docPaths += Get-ChildItem -Path $manualDir -File -Filter *.md | Select-Object -ExpandProperty FullName

foreach ($docPath in $docPaths) {
    $content = Get-Content -Path $docPath -Raw
    if ($content -notmatch "ui-ux-pro-max") {
        throw "Expected $docPath to mention bundled ui-ux-pro-max skill."
    }
    if ($content -notmatch "python3" -and $content -notmatch "python") {
        throw "Expected $docPath to mention python3/python dependency."
    }
    if ($content -notmatch "update-ui-ux-pro-max-skill") {
        throw "Expected $docPath to mention the ui-ux-pro-max update scripts."
    }
    if ($content -notmatch "install-ui-ux-pro-max-skill" -and $content -notmatch "install_ui_ux_pro_max_skill" -and $content -notmatch "一键安装ui-ux-pro-max") {
        throw "Expected $docPath to mention the manual-install ui-ux-pro-max scripts."
    }
    foreach ($keyword in @("SourceRepoPath", "source-repo-path", "SourceZipUrl", "source-zip-url", "refs/heads")) {
        if ($content -match $keyword) {
            throw "Expected $docPath to avoid external source update instructions ('$keyword')."
        }
    }
    if ($content -match "源码") {
        throw "Expected $docPath to avoid mentioning the local source directory."
    }
}

Write-Host "PASS: ui-ux-pro-max bundle, update scripts, and docs are present."
