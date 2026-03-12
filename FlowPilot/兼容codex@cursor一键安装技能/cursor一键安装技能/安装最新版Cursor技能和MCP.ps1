param(
    [string]$TargetCursorHome = (Join-Path $env:USERPROFILE ".cursor"),
    [switch]$Force
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

function ConvertTo-Hashtable {
    param([object]$InputObject)

    if ($null -eq $InputObject) {
        return $null
    }

    if ($InputObject -is [System.Collections.IDictionary]) {
        $result = @{}
        foreach ($key in $InputObject.Keys) {
            $result[$key] = ConvertTo-Hashtable $InputObject[$key]
        }
        return $result
    }

    if ($InputObject -is [System.Collections.IEnumerable] -and $InputObject -isnot [string]) {
        $items = @()
        foreach ($item in $InputObject) {
            $items += ,(ConvertTo-Hashtable $item)
        }
        return $items
    }

    if ($InputObject -is [psobject]) {
        $properties = $InputObject.PSObject.Properties
        if ($properties.Count -gt 0) {
            $result = @{}
            foreach ($property in $properties) {
                $result[$property.Name] = ConvertTo-Hashtable $property.Value
            }
            return $result
        }
    }

    return $InputObject
}

function Install-Context7LocalRuntime {
    param(
        [string]$CursorHome,
        [string]$BundledRuntimeSource
    )

    $localRoot = Join-Path $CursorHome "context7-local"
    $entryPath = Join-Path $localRoot "node_modules\@upstash\context7-mcp\dist\index.js"
    $launcherPath = Join-Path $CursorHome "run-context7.cmd"

    if (-not (Test-Path $BundledRuntimeSource)) {
        throw "Missing bundled Context7 runtime: $BundledRuntimeSource"
    }

    Write-Host "Installing bundled Context7 runtime to: $localRoot"
    if (Test-Path $localRoot) {
        Remove-Item -Path $localRoot -Recurse -Force
    }

    Copy-Item -Path $BundledRuntimeSource -Destination $localRoot -Recurse -Force

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
    return $launcherPath
}

$sourceSkills = Join-Path $PSScriptRoot "skills"
$bundledContext7Root = Join-Path $PSScriptRoot "-Force\context7-local"
if (-not (Test-Path $sourceSkills)) {
    throw "Missing skills package: $sourceSkills"
}
if (-not (Test-Path $bundledContext7Root)) {
    throw "Missing bundled Context7 runtime: $bundledContext7Root"
}

New-Item -ItemType Directory -Path $TargetCursorHome -Force | Out-Null
$targetSkills = Join-Path $TargetCursorHome "skills"
New-Item -ItemType Directory -Path $targetSkills -Force | Out-Null

Write-Host "Installing Cursor personal skills to: $targetSkills"
Write-Host "Internal built-in directory ~/.cursor/skills-cursor will not be modified."

Get-ChildItem -Path $sourceSkills -Directory | ForEach-Object {
    $skillName = $_.Name
    $sourcePath = $_.FullName
    $targetPath = Join-Path $targetSkills $skillName

    if (Test-Path $targetPath) {
        if ($Force) {
            Remove-Item -Path $targetPath -Recurse -Force
            Copy-Item -Path $sourcePath -Destination $targetPath -Recurse -Force
            Write-Host "Updated skill: $skillName"
        } else {
            Write-Host "Skipped existing skill: $skillName (use -Force to replace)"
        }
    } else {
        Copy-Item -Path $sourcePath -Destination $targetPath -Recurse -Force
        Write-Host "Installed skill: $skillName"
    }
}

$context7Launcher = Install-Context7LocalRuntime -CursorHome $TargetCursorHome -BundledRuntimeSource $bundledContext7Root
$mcpPath = Join-Path $TargetCursorHome "mcp.json"
$existingRaw = ""

if (Test-Path $mcpPath) {
    $existingRaw = Get-Content -Raw -Path $mcpPath
}

if ($existingRaw -ne "") {
    $backupPath = "$mcpPath.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Write-Utf8NoBom -Path $backupPath -Content $existingRaw
    Write-Host "Backed up mcp.json to: $backupPath"
}

$config = @{}
if ($existingRaw -ne "") {
    try {
        $parsed = $existingRaw | ConvertFrom-Json
        $config = ConvertTo-Hashtable $parsed
    } catch {
        Write-Host "Existing mcp.json is invalid JSON. A fresh file will be written, and the backup is preserved."
        $config = @{}
    }
}

if ($null -eq $config) {
    $config = @{}
}

if (-not $config.ContainsKey("mcpServers")) {
    $config["mcpServers"] = @{}
}

$config["mcpServers"]["context7"] = @{
    command = $context7Launcher
    args = @()
}

$json = $config | ConvertTo-Json -Depth 10
Write-Utf8NoBom -Path $mcpPath -Content $json

Write-Host "Configured MCP server: context7"
Write-Host "Done. Restart Cursor to load the latest personal skills and MCP config."
