param(
    [string]$TargetCodexHome,
    [switch]$Force,
    [switch]$WindowsSafeContext7
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string]$Content
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Test-WindowsPlatform {
    return $env:OS -eq "Windows_NT"
}

function Resolve-CodexHome {
    param(
        [string]$ExplicitPath
    )

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

function Assert-CommandAvailable {
    param(
        [string]$CommandName
    )

    if (Test-WindowsPlatform) {
        $candidateNames = @(
            $CommandName,
            "$CommandName.cmd",
            "$CommandName.exe",
            "$CommandName.bat"
        )

        foreach ($candidate in $candidateNames) {
            $null = & where.exe $candidate 2>$null
            if ($LASTEXITCODE -eq 0) {
                return
            }
        }
    }

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $CommandName"
    }
}

function Convert-PathForToml {
    param(
        [string]$Path
    )

    if (-not (Test-WindowsPlatform)) {
        return $Path.Replace("\", "/")
    }

    if ($Path -match '^[\x00-\x7F]+$') {
        return $Path.Replace("\", "/")
    }

    $escapedPath = $Path.Replace('"', '""')
    $shortPath = cmd /c "for %I in (""$escapedPath"") do @echo %~sI" 2>$null
    if ($LASTEXITCODE -eq 0 -and $shortPath) {
        return $shortPath.Trim().Replace("\", "/")
    }

    return $Path.Replace("\", "/")
}

function Remove-Context7Block {
    param(
        [string]$ConfigContent
    )

    $pattern = '(?ms)^\[mcp_servers\.context7(\.env)?\]\r?\n.*?(?=^\[|\z)'
    return [regex]::Replace($ConfigContent, $pattern, "").TrimEnd()
}

function Install-Context7LocalRuntime {
    param(
        [string]$PackageRoot,
        [string]$CodexHome
    )

    $sourceRuntime = Join-Path $PackageRoot "纯手动安装\context7-local-bundled"
    if (-not (Test-Path $sourceRuntime)) {
        throw "Missing bundled Context7 runtime: $sourceRuntime"
    }

    $targetRuntime = Join-Path $CodexHome "context7-local"
    $launcherPath = if (Test-WindowsPlatform) {
        Join-Path $CodexHome "run-context7.cmd"
    } else {
        Join-Path $CodexHome "run-context7.sh"
    }

    if (Test-Path $targetRuntime) {
        Remove-Item -Path $targetRuntime -Recurse -Force
    }

    New-Item -ItemType Directory -Path $CodexHome -Force | Out-Null
    New-Item -ItemType Directory -Path $targetRuntime -Force | Out-Null
    Copy-Item -Path (Join-Path $sourceRuntime "*") -Destination $targetRuntime -Recurse -Force

    $entryPath = Join-Path $targetRuntime "node_modules\@upstash\context7-mcp\dist\index.js"
    if (-not (Test-Path $entryPath)) {
        throw "Context7 runtime entry was not created: $entryPath"
    }

    if (Test-WindowsPlatform) {
        $launcher = @"
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%context7-local\node_modules\@upstash\context7-mcp\dist\index.js" %*
"@
        Write-Utf8NoBom -Path $launcherPath -Content $launcher
    }
    else {
        $launcher = @"
#!/usr/bin/env sh
set -eu
SCRIPT_DIR=`$(CDPATH= cd -- "`$(dirname -- "`$0")" && pwd)
node "`${SCRIPT_DIR}/context7-local/node_modules/@upstash/context7-mcp/dist/index.js" "`$@"
"@
        Write-Utf8NoBom -Path $launcherPath -Content $launcher
        chmod +x -- $launcherPath
    }

    return $launcherPath
}

$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceCodexHome = Join-Path $packageRoot ".codex-home-claude-parity"
$sourceSkills = Join-Path $sourceCodexHome "skills"

Write-Host "[Codex package] Installing skills and MCP for Codex CLI."

if (-not (Test-Path $sourceSkills)) {
    throw "Missing packaged skills: $sourceSkills"
}

$resolvedCodexHome = Resolve-CodexHome -ExplicitPath $TargetCodexHome
$resolvedCodexHome = [System.IO.Path]::GetFullPath($resolvedCodexHome)

Assert-CommandAvailable -CommandName "codex"
Assert-CommandAvailable -CommandName "node"

$targetSkills = Join-Path $resolvedCodexHome "skills"

New-Item -ItemType Directory -Path $targetSkills -Force | Out-Null

Get-ChildItem -Path $sourceSkills -Directory | ForEach-Object {
    $skillName = $_.Name
    $sourcePath = $_.FullName
    $targetPath = Join-Path $targetSkills $skillName

    if ((Test-Path $targetPath) -and (-not $Force)) {
        Write-Host "Skipped existing skill: $skillName (use -Force to replace)"
        return
    }

    if (Test-Path $targetPath) {
        Remove-Item -Path $targetPath -Recurse -Force
        Write-Host "Updated skill: $skillName"
    }
    else {
        Write-Host "Installed skill: $skillName"
    }

    Copy-Item -Path $sourcePath -Destination $targetPath -Recurse -Force
}

$context7Launcher = Install-Context7LocalRuntime -PackageRoot $packageRoot -CodexHome $resolvedCodexHome

$configPath = Join-Path $resolvedCodexHome "config.toml"
if (Test-Path $configPath) {
    $config = Get-Content -Path $configPath -Raw
}
else {
    $config = ""
}

$backupPath = "$configPath.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Write-Utf8NoBom -Path $backupPath -Content $config
Write-Host "Backed up config to: $backupPath"

$configWithoutContext7 = Remove-Context7Block -ConfigContent $config
if ($configWithoutContext7.Length -gt 0) {
    $configWithoutContext7 += "`r`n`r`n"
}

$launcherForToml = Convert-PathForToml -Path $context7Launcher
$context7Block = @"
[mcp_servers.context7]
command = "$launcherForToml"
args = []
"@

Write-Utf8NoBom -Path $configPath -Content ($configWithoutContext7 + $context7Block + "`r`n")

Write-Host "Configured MCP server: context7"
Write-Host "Target CODEX_HOME: $resolvedCodexHome"
Write-Host "[Codex package] Completed successfully. Restart Codex CLI."
