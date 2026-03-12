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

    if ($null -eq $InputObject) { return $null }
    if ($InputObject -is [System.Collections.IDictionary]) {
        $result = @{}
        foreach ($key in $InputObject.Keys) { $result[$key] = ConvertTo-Hashtable $InputObject[$key] }
        return $result
    }
    if ($InputObject -is [System.Collections.IEnumerable] -and $InputObject -isnot [string]) {
        $items = @()
        foreach ($item in $InputObject) { $items += ,(ConvertTo-Hashtable $item) }
        return $items
    }
    if ($InputObject -is [psobject]) {
        $properties = $InputObject.PSObject.Properties
        if ($properties.Count -gt 0) {
            $result = @{}
            foreach ($property in $properties) { $result[$property.Name] = ConvertTo-Hashtable $property.Value }
            return $result
        }
    }
    return $InputObject
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node is required on PATH" }

New-Item -ItemType Directory -Path $TargetCursorHome -Force | Out-Null
$packageRoot = Split-Path -Parent $PSScriptRoot
$bundledContext7Root = Join-Path $packageRoot "-Force\context7-local"
$localRoot = Join-Path $TargetCursorHome "context7-local"
$entryPath = Join-Path $localRoot "node_modules\@upstash\context7-mcp\dist\index.js"
$launcherPath = Join-Path $TargetCursorHome "run-context7.cmd"
$mcpPath = Join-Path $TargetCursorHome "mcp.json"

if (-not (Test-Path $bundledContext7Root)) {
    throw "Missing bundled Context7 runtime: $bundledContext7Root"
}

Write-Host "[Cursor package][manual] Installing context7 MCP for Cursor."
Write-Host "Installing bundled Context7 runtime to: $localRoot"
if (Test-Path $localRoot) {
    Remove-Item -Path $localRoot -Recurse -Force
}
Copy-Item -Path $bundledContext7Root -Destination $localRoot -Recurse -Force

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

$config = @{}
if (Test-Path $mcpPath) {
    try {
        $parsed = Get-Content -Raw -Path $mcpPath | ConvertFrom-Json
        $config = ConvertTo-Hashtable $parsed
    } catch {
        $config = @{}
    }
}
if (-not $config.ContainsKey("mcpServers")) { $config["mcpServers"] = @{} }
$config["mcpServers"]["context7"] = @{ command = $launcherPath; args = @() }
$json = $config | ConvertTo-Json -Depth 10
Write-Utf8NoBom -Path $mcpPath -Content $json

Write-Host "Configured MCP server: context7"
Write-Host "[Cursor package][manual] Done. Restart Cursor."
