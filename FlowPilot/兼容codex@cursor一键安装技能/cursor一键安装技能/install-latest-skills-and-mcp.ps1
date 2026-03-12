param(
    [string]$TargetCursorHome,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$installScript = Get-ChildItem -Path $PSScriptRoot -File -Filter *.ps1 |
    Where-Object {
        $_.Name -notin @(
            "install-latest-skills-and-mcp.ps1",
            "repair-latest-skills-and-mcp.ps1",
            "self-check-cursor-skills-and-mcp.ps1",
            "update-ui-ux-pro-max-skill.ps1"
        ) -and
        (Get-Content -Path $_.FullName -Raw) -match "Installing Cursor personal skills to:"
    } |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $installScript) {
    throw "Missing install script in $PSScriptRoot"
}

Write-Host "[Cursor package] Delegating to the Cursor installer."
$argsList = @()
if ($PSBoundParameters.ContainsKey("TargetCursorHome")) {
    $argsList += @("-TargetCursorHome", $TargetCursorHome)
}
if ($PSBoundParameters.ContainsKey("Force")) {
    $argsList += "-Force"
}

& $installScript @argsList
