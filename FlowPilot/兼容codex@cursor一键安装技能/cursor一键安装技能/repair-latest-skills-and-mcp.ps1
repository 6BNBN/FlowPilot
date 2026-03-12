param(
    [string]$TargetCursorHome
)

$ErrorActionPreference = "Stop"

$repairScript = Get-ChildItem -Path $PSScriptRoot -File -Filter *.ps1 |
    Where-Object {
        $_.Name -notin @(
            "install-latest-skills-and-mcp.ps1",
            "repair-latest-skills-and-mcp.ps1",
            "self-check-cursor-skills-and-mcp.ps1",
            "update-ui-ux-pro-max-skill.ps1"
        ) -and
        (Get-Content -Path $_.FullName -Raw) -match "Repair complete\. Restart Cursor\."
    } |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $repairScript) {
    throw "Missing repair script in $PSScriptRoot"
}

Write-Host "[Cursor package] Delegating to the Cursor repair script."
$argsList = @()
if ($PSBoundParameters.ContainsKey("TargetCursorHome")) {
    $argsList += @("-TargetCursorHome", $TargetCursorHome)
}

& $repairScript @argsList
