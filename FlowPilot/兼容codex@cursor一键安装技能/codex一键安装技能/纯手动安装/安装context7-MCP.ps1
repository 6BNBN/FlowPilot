param(
    [string]$TargetCodexHome
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

function Resolve-CodexHome {
    param([string]$ExplicitPath)

    if ($ExplicitPath) { return [Environment]::ExpandEnvironmentVariables($ExplicitPath) }
    if ($env:CODEX_HOME) { return [Environment]::ExpandEnvironmentVariables($env:CODEX_HOME) }
    if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE '.codex') }
    if ($env:HOME) { return (Join-Path $env:HOME '.codex') }
    throw 'Could not resolve CODEX_HOME. Pass -TargetCodexHome or set CODEX_HOME.'
}

function Assert-CommandAvailable {
    param([string]$CommandName)

    $candidateNames = @($CommandName, "$CommandName.cmd", "$CommandName.exe", "$CommandName.bat")
    foreach ($candidate in $candidateNames) {
        $null = & where.exe $candidate 2>$null
        if ($LASTEXITCODE -eq 0) { return }
    }

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $CommandName"
    }
}

function Convert-PathForToml {
    param([string]$Path)

    if ($Path -match '^[\x00-\x7F]+$') {
        return $Path.Replace('\', '/')
    }

    $escapedPath = $Path.Replace('"', '""')
    $shortPath = cmd /c "for %I in (""$escapedPath"") do @echo %~sI" 2>$null
    if ($LASTEXITCODE -eq 0 -and $shortPath) {
        return $shortPath.Trim().Replace('\', '/')
    }

    return $Path.Replace('\', '/')
}

function Remove-Context7Block {
    param([string]$ConfigContent)
    $pattern = '(?ms)^\[mcp_servers\.context7(\.env)?\]\r?\n.*?(?=^\[|\z)'
    return [regex]::Replace($ConfigContent, $pattern, '').TrimEnd()
}

Assert-CommandAvailable 'codex'
Assert-CommandAvailable 'node'

$codexHome = [System.IO.Path]::GetFullPath((Resolve-CodexHome -ExplicitPath $TargetCodexHome))
$sourceRuntime = Join-Path $PSScriptRoot 'context7-local-bundled'
$targetRuntime = Join-Path $codexHome 'context7-local'
$launcherPath = Join-Path $codexHome 'run-context7.cmd'
$configPath = Join-Path $codexHome 'config.toml'

if (-not (Test-Path $sourceRuntime)) {
    throw "Missing bundled Context7 runtime: $sourceRuntime"
}

Write-Host "[Codex package][manual] Installing context7 MCP for Codex CLI."
New-Item -ItemType Directory -Force -Path $codexHome | Out-Null
if (Test-Path $targetRuntime) {
    Remove-Item -Path $targetRuntime -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $targetRuntime | Out-Null
Copy-Item -Path (Join-Path $sourceRuntime '*') -Destination $targetRuntime -Recurse -Force

$entryPath = Join-Path $targetRuntime 'node_modules\@upstash\context7-mcp\dist\index.js'
if (-not (Test-Path $entryPath)) {
    throw "Context7 runtime entry was not created: $entryPath"
}

$launcher = @"
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%context7-local\node_modules\@upstash\context7-mcp\dist\index.js" %*
"@
Write-Utf8NoBom -Path $launcherPath -Content $launcher

$config = ''
if (Test-Path $configPath) {
    $config = Get-Content -Raw -Path $configPath
}

$backupPath = "$configPath.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Write-Utf8NoBom -Path $backupPath -Content $config

$prefix = Remove-Context7Block -ConfigContent $config
if ($prefix.Length -gt 0) {
    $prefix += "`r`n`r`n"
}

$launcherToml = Convert-PathForToml -Path $launcherPath
$block = @"
[mcp_servers.context7]
command = "$launcherToml"
args = []
"@

Write-Utf8NoBom -Path $configPath -Content ($prefix + $block + "`r`n")
Write-Host "Configured MCP server: context7"
Write-Host "Target CODEX_HOME: $codexHome"
Write-Host "[Codex package][manual] Completed successfully. Restart Codex CLI."
