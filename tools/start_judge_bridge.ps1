$ErrorActionPreference = 'Stop'
$judgeExecutable = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'node.exe')).Path
$judgeExpectedBuild = & $judgeExecutable -e 'process.stdout.write(require(process.argv[1]).buildId)' (Join-Path $PSScriptRoot 'services/judge-bridge/server.cjs')
if ($LASTEXITCODE -ne 0 -or $judgeExpectedBuild -notmatch '^[a-f0-9]{16}$') { throw 'Unable to identify the installed judge bridge build.' }
$judgeHealth = $null
try {
    $judgeHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8976/health' -TimeoutSec 1
    if ($judgeHealth.service -eq 'uobtkd-judge-bridge' -and $judgeHealth.buildId -eq $judgeExpectedBuild) { exit 0 }
} catch { }
if ($judgeHealth.service -eq 'uobtkd-judge-bridge') {
    $judgeListeners = Get-NetTCPConnection -LocalPort 8976 -State Listen
    foreach ($judgeListener in $judgeListeners) {
        $judgeOldProcess = Get-Process -Id $judgeListener.OwningProcess
        if ($judgeOldProcess.Path -ne $judgeExecutable) { throw 'A different installation is using the judge port. Close it before opening this app.' }
        Stop-Process -Id $judgeOldProcess.Id
    }
}
Start-Process -FilePath $judgeExecutable `
    -ArgumentList 'services/judge-bridge/server.cjs' `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $PSScriptRoot 'bridge.log') `
    -RedirectStandardError (Join-Path $PSScriptRoot 'bridge-error.log')
