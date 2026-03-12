param(
    [string]$TargetCursorHome
)

$ErrorActionPreference = "Stop"

$selfCheckScript = Get-ChildItem -Path $PSScriptRoot -File -Filter *.ps1 |
    Where-Object {
        $_.Name -notin @(
            "install-latest-skills-and-mcp.ps1",
            "repair-latest-skills-and-mcp.ps1",
            "self-check-cursor-skills-and-mcp.ps1",
            "update-ui-ux-pro-max-skill.ps1"
        ) -and
        (Get-Content -Path $_.FullName -Raw) -match "Self-check passed\."
    } |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $selfCheckScript) {
    throw "Missing self-check script in $PSScriptRoot"
}

$argsList = @()
if ($PSBoundParameters.ContainsKey("TargetCursorHome")) {
    $argsList += @("-TargetCursorHome", $TargetCursorHome)
}

& $selfCheckScript @argsList
