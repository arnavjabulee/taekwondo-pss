$ErrorActionPreference = 'Stop'
$judgeExecutable = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'node.exe')).Path
$judgeExpectedBuild = & $judgeExecutable -e 'process.stdout.write(require(process.argv[1]).buildId)' (Join-Path $PSScriptRoot 'services/judge-bridge/server.cjs')
if ($LASTEXITCODE -ne 0 -or $judgeExpectedBuild -notmatch '^[a-f0-9]{16}$') { throw 'Unable to identify the installed judge bridge build.' }
$judgeHealth = $null
try {
    $judgeHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8976/health' -TimeoutSec 1
    if ($judgeHealth.service -eq 'uobtkd-judge-bridge' -and $judgeHealth.buildId -eq $judgeExpectedBuild) { exit 0 }
} catch { }
$judgeListeners = @(Get-NetTCPConnection -LocalPort 8976 -State Listen -ErrorAction SilentlyContinue)
if ($judgeListeners.Count -gt 0) {
    if ($judgeHealth.service -ne 'uobtkd-judge-bridge') { throw 'Port 8976 is being used by another application. Close that application before starting the suite.' }
    $judgeProcesses = @()
    foreach ($judgeOwner in @($judgeListeners.OwningProcess | Select-Object -Unique)) {
        $judgeOldProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$judgeOwner"
        $judgeOldExecutable = $judgeOldProcess.ExecutablePath
        if (-not $judgeOldExecutable) { throw 'Cannot verify the previous phone service. Close the previous suite before starting this version.' }
        $judgeOldRoot = Split-Path $judgeOldExecutable -Parent
        $judgeArguments = $judgeOldProcess.CommandLine -replace '^(?:"[^"]+"|\S+)\s*', ''
        $judgeEntry = $judgeArguments.Trim().Trim('"')
        $judgeExpectedEntry = Join-Path $judgeOldRoot 'services/judge-bridge/server.cjs'
        if ($judgeEntry -eq 'services/judge-bridge/server.cjs' -or $judgeEntry -eq 'services\judge-bridge\server.cjs') { $judgeEntry = $judgeExpectedEntry }
        $judgeVerified = (Split-Path $judgeOldRoot -Leaf) -eq 'judge-bridge' -and
            [IO.Path]::GetFullPath($judgeEntry) -eq [IO.Path]::GetFullPath($judgeExpectedEntry) -and
            (Test-Path -LiteralPath $judgeExpectedEntry) -and
            (Test-Path -LiteralPath (Join-Path $judgeOldRoot 'packages/judge-protocol/index.js')) -and
            (Test-Path -LiteralPath (Join-Path $judgeOldRoot 'Start-Bridge.ps1')) -and
            (Get-FileHash -LiteralPath $judgeOldExecutable -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $judgeExecutable -Algorithm SHA256).Hash
        if (-not $judgeVerified) { throw 'The process using the phone-service port is not a verified suite service. It has been left running.' }
        $judgeProcesses += $judgeOldProcess
    }
    # Flush an active recording through the old service before replacing its process.
    $judgeHeaders = @{ Origin = 'http://127.0.0.1:11818' }
    $judgeAuth = Invoke-RestMethod -Uri 'http://127.0.0.1:8976/api/desktop/bootstrap' -Headers $judgeHeaders -TimeoutSec 3
    $judgeHeaders.Authorization = 'Bearer ' + $judgeAuth.key
    $judgeReplay = Invoke-RestMethod -Uri 'http://127.0.0.1:8976/api/desktop/replay/state' -Headers $judgeHeaders -TimeoutSec 3
    if ($judgeReplay.recording) {
        Invoke-RestMethod -Uri 'http://127.0.0.1:8976/api/desktop/replay/remove' -Method Post -ContentType 'application/json' -Body '{}' -Headers $judgeHeaders -TimeoutSec 10 | Out-Null
    }
    foreach ($judgeOldProcess in $judgeProcesses) {
        # Recheck the executable to avoid acting on a reused process ID.
        $judgeCurrentProcess = Get-Process -Id $judgeOldProcess.ProcessId -ErrorAction SilentlyContinue
        if ($judgeCurrentProcess -and $judgeCurrentProcess.Path -eq $judgeOldProcess.ExecutablePath) {
            Stop-Process -Id $judgeOldProcess.ProcessId
            Wait-Process -Id $judgeOldProcess.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
        }
    }
}
Start-Process -FilePath $judgeExecutable `
    -ArgumentList 'services/judge-bridge/server.cjs' `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $PSScriptRoot 'bridge.log') `
    -RedirectStandardError (Join-Path $PSScriptRoot 'bridge-error.log')
