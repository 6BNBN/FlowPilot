$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PWD "cursor一键安装技能"))
$manualDir = Get-ChildItem -Path $repoRoot -Directory | Where-Object { $_.Name -notin @("skills", "tests") -and $_.Name -notlike ".tmp-*" } | Select-Object -First 1

if (-not $manualDir) {
    throw "Expected manual-install directory under $repoRoot"
}

$bundleSkillPath = [System.IO.Path]::Combine($repoRoot, "skills", "ui-ux-pro-max", "SKILL.md")
$manualBundleSkillPath = [System.IO.Path]::Combine($manualDir.FullName, "skills", "ui-ux-pro-max", "SKILL.md")
$updatePs1Path = [System.IO.Path]::Combine($repoRoot, "update-ui-ux-pro-max-skill.ps1")
$updateShPath = [System.IO.Path]::Combine($repoRoot, "update-ui-ux-pro-max-skill.sh")
$updateBatPath = Get-ChildItem -Path $repoRoot -File -Filter *.bat | Where-Object { $_.Name -like "*ui-ux-pro-max*" } | Select-Object -First 1 -ExpandProperty FullName
$manualInstallPs1Path = [System.IO.Path]::Combine($manualDir.FullName, "install-ui-ux-pro-max-skill.ps1")
$manualRepairPs1Path = [System.IO.Path]::Combine($manualDir.FullName, "repair-ui-ux-pro-max-skill.ps1")
$manualInstallShPath = [System.IO.Path]::Combine($manualDir.FullName, "install_ui_ux_pro_max_skill.sh")
$manualRepairShPath = [System.IO.Path]::Combine($manualDir.FullName, "repair_ui_ux_pro_max_skill.sh")
$manualBatPaths = Get-ChildItem -Path $manualDir.FullName -File -Filter *.bat | Where-Object { $_.Name -like "*ui-ux-pro-max*" }

foreach ($path in @(
    $bundleSkillPath,
    $manualBundleSkillPath,
    $updatePs1Path,
    $updateShPath,
    $updateBatPath,
    $manualInstallPs1Path,
    $manualRepairPs1Path,
    $manualInstallShPath,
    $manualRepairShPath
)) {
    if (-not $path -or -not (Test-Path $path)) {
        throw "Expected Cursor ui-ux-pro-max asset at $path"
    }
}

if ($manualBatPaths.Count -lt 2) {
    throw "Expected at least 2 manual-install ui-ux-pro-max BAT launchers under $($manualDir.FullName)"
}

$selfCheckPs1 = Get-ChildItem -Path $repoRoot -File -Filter *.ps1 |
    Where-Object { (Get-Content -Path $_.FullName -Raw) -match "Self-check passed\." } |
    Select-Object -First 1 -ExpandProperty FullName
$selfCheckSh = [System.IO.Path]::Combine($repoRoot, "self_check_cursor_skills.sh")

foreach ($path in @($selfCheckPs1, $selfCheckSh)) {
    if (-not $path -or -not (Test-Path $path)) {
        throw "Expected self-check script at $path"
    }
    $content = Get-Content -Path $path -Raw
    if ($content -notmatch "ui-ux-pro-max") {
        throw "Expected $path to include ui-ux-pro-max self-check coverage."
    }
}

$rootGuide = Get-ChildItem -Path $repoRoot -File -Filter *.md | Where-Object { $_.Name -ne "README.md" -and $_.Name -ne "CHANGELOG.md" } | Select-Object -First 1 -ExpandProperty FullName
$docPaths = @([System.IO.Path]::Combine($repoRoot, "README.md"), $rootGuide)
$docPaths += Get-ChildItem -Path $manualDir.FullName -File -Filter *.md | Select-Object -ExpandProperty FullName

foreach ($docPath in $docPaths) {
    $content = Get-Content -Path $docPath -Raw
    foreach ($keyword in @("ui-ux-pro-max", "python")) {
        if ($content -notmatch $keyword) {
            throw "Expected $docPath to mention '$keyword' for Cursor ui-ux-pro-max support."
        }
    }
}

Write-Host "PASS: Cursor ui-ux-pro-max bundle, scripts, self-check, and docs are present."
