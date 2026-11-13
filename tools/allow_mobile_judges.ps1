param([switch]$Elevated)
$ErrorActionPreference = 'Stop'
$judgeIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$judgePrincipal = New-Object Security.Principal.WindowsPrincipal($judgeIdentity)
if (-not $judgePrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    if ($Elevated) { throw 'Administrator permission is required to configure Windows Firewall.' }
    $judgeProcess = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
    exit $judgeProcess.ExitCode
}
$judgeLog = Join-Path $PSScriptRoot 'firewall-setup.log'
try {
    $judgeExecutable = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'node.exe')).Path
    $judgeRuleName = 'UoBTKD-Mobile-Judges-TCP'
    $judgeExistingRule = Get-NetFirewallRule -Name $judgeRuleName -ErrorAction SilentlyContinue
    if ($judgeExistingRule) { Remove-NetFirewallRule -Name $judgeRuleName }
    New-NetFirewallRule -Name $judgeRuleName -DisplayName 'UoBTKD mobile judges (local network)' `
        -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol TCP `
        -LocalPort 8976 -RemoteAddress LocalSubnet -Program $judgeExecutable | Out-Null
    # Windows creates an explicit block when its original access prompt is dismissed.
    # Remove only that TCP prompt block for this bundled executable; UDP stays blocked.
    Get-NetFirewallApplicationFilter -Program $judgeExecutable | Get-NetFirewallRule |
        Where-Object { $_.Action -eq 'Block' -and $_.Name -like 'TCP Query User*' } |
        Disable-NetFirewallRule | Out-Null
    'Mobile judges enabled: TCP port 8976, bundled Node runtime, local subnet only. The firewall remains enabled.' |
        Set-Content -LiteralPath $judgeLog
} catch {
    $_.Exception.Message | Set-Content -LiteralPath $judgeLog
    exit 1
}
