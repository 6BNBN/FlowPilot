param(
    [string]$TargetCursorHome
)

$ErrorActionPreference = "Stop"

$installScript = Get-ChildItem -Path $PSScriptRoot -File -Filter *.ps1 |
    Where-Object { $_.Name -like "*context7-MCP.ps1" -and $_.Name -notlike "install-*" } |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $installScript) {
    throw "Missing context7 install script in $PSScriptRoot"
}

$argsList = @()
if ($PSBoundParameters.ContainsKey("TargetCursorHome")) {
    $argsList += @("-TargetCursorHome", $TargetCursorHome)
}

& $installScript @argsList
