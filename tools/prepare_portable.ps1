$ErrorActionPreference = 'Stop'
$suiteRoot = $PSScriptRoot
$phpRoot = Join-Path $suiteRoot 'nginx/php7.4.3nts'
$phpIni = Join-Path $phpRoot 'php.ini'
if (Test-Path -LiteralPath $phpIni) {
    $phpSettings = [IO.File]::ReadAllText($phpIni)
    $phpPaths = @{
        'extension_dir' = 'ext'
        'error_log' = 'php.log'
        'session.save_path' = 'tmp'
        'opcache.blacklist_filename' = 'blacklist'
        'opcache.file_cache' = 'bin'
    }
    foreach ($phpKey in $phpPaths.Keys) {
        $phpValue = Join-Path $phpRoot $phpPaths[$phpKey]
        $phpPattern = '(?m)^' + [regex]::Escape($phpKey) + '=.*$'
        $phpReplacement = $phpKey + '="' + $phpValue + '"'
        $phpSettings = [regex]::Replace($phpSettings, $phpPattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $phpReplacement })
    }
    [IO.File]::WriteAllText($phpIni, $phpSettings, (New-Object Text.UTF8Encoding($false)))
}
foreach ($suiteDirectory in @('LocalStorage', 'data', 'nginx/logs', 'nginx/temp', 'nginx/php7.4.3nts/tmp', 'nginx/php7.4.3nts/bin')) {
    New-Item -ItemType Directory -Path (Join-Path $suiteRoot $suiteDirectory) -Force | Out-Null
}
