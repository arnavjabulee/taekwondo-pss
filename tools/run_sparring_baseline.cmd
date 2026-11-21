@echo off
setlocal
set "root=%~dp0.."
set "runtime=%USERPROFILE%\AppData\Local\Programs\Python\Python311\python.exe"
if not exist "%runtime%" set "runtime=python"
set "clip=%~1"
if not defined clip set "clip=%root%\round-exports\us-open-gergely\round-04.mp4"

"%runtime%" "%~dp0sparring_baseline.py" predict "%root%\round-exports\baseline\model.npz" "%clip%"
set "result=%errorlevel%"
if errorlevel 1 echo The detector could not run. See the error above.
if not defined SPARRING_NO_PAUSE pause
exit /b %result%
