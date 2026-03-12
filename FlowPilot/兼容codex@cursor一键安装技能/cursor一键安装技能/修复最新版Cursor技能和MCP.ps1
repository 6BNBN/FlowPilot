param(
    [string]$TargetCursorHome = (Join-Path $env:USERPROFILE ".cursor")
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

$installedSkills = Join-Path $TargetCursorHome "skills"
if (-not (Test-Path $installedSkills)) {
    throw "Missing installed skills directory: $installedSkills"
}

$sourceSkills = Join-Path $PSScriptRoot "skills"
$bundledContext7Root = Join-Path $PSScriptRoot "-Force\context7-local"
if (-not (Test-Path $sourceSkills)) {
    throw "Missing packaged skills directory: $sourceSkills"
}
if (-not (Test-Path $bundledContext7Root)) {
    throw "Missing bundled Context7 runtime: $bundledContext7Root"
}

Get-ChildItem -Path $sourceSkills -Directory | ForEach-Object {
    $skillName = $_.Name
    $targetPath = Join-Path $installedSkills $skillName
    if (-not (Test-Path $targetPath)) {
        Copy-Item -Path $_.FullName -Destination $targetPath -Recurse -Force
        Write-Host "Reinstalled missing skill: $skillName"
    }
}

Get-ChildItem -Path $installedSkills -Recurse -File -Include *.md | ForEach-Object {
    $content = Get-Content -Raw -Path $_.FullName
    Write-Utf8NoBom -Path $_.FullName -Content $content
    Write-Host "Normalized encoding: $($_.FullName)"
}

$localRoot = Join-Path $TargetCursorHome "context7-local"
$entryPath = Join-Path $localRoot "node_modules\@upstash\context7-mcp\dist\index.js"
$launcherPath = Join-Path $TargetCursorHome "run-context7.cmd"

Write-Host "Refreshing bundled Context7 runtime..."
if (Test-Path $localRoot) {
    Remove-Item -Path $localRoot -Recurse -Force
}
Copy-Item -Path $bundledContext7Root -Destination $localRoot -Recurse -Force

if (-not (Test-Path $entryPath)) {
    throw "Context7 runtime entry was not found after repair: $entryPath"
}

$launcher = @"
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%context7-local\node_modules\@upstash\context7-mcp\dist\index.js" %*
"@
Write-Utf8NoBom -Path $launcherPath -Content $launcher

$mcpPath = Join-Path $TargetCursorHome "mcp.json"
$config = @{}

if (Test-Path $mcpPath) {
    try {
        $parsed = Get-Content -Raw -Path $mcpPath | ConvertFrom-Json
        $config = ConvertTo-Hashtable $parsed
    } catch {
        $config = @{}
    }
}

if (-not $config.ContainsKey("mcpServers")) {
    $config["mcpServers"] = @{}
}

$config["mcpServers"]["context7"] = @{
    command = $launcherPath
    args = @()
}

$json = $config | ConvertTo-Json -Depth 10
Write-Utf8NoBom -Path $mcpPath -Content $json
Write-Host "Normalized context7 MCP config"
Write-Host "Repair complete. Restart Cursor."
