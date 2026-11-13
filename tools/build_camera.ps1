$ErrorActionPreference = 'Stop'
$cameraProject = Join-Path (Split-Path $PSScriptRoot -Parent) 'apps/camera-android'
if (-not $env:JAVA_HOME) {
    $cameraJbr = Join-Path $env:ProgramFiles 'Android/Android Studio/jbr'
    if (Test-Path -LiteralPath $cameraJbr) { $env:JAVA_HOME = $cameraJbr }
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
& (Join-Path $cameraProject 'gradlew.bat') -p $cameraProject :app:assembleDebug --console=plain
if ($LASTEXITCODE -ne 0) { throw 'Camera build failed. Install Android SDK 36 and Java 17 or newer.' }
Write-Output "Camera APK: $(Join-Path $cameraProject 'app/build/outputs/apk/debug/app-debug.apk')"
