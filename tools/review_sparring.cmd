@echo off
setlocal
set "runtime=%USERPROFILE%\AppData\Local\Programs\Python\Python311\python.exe"
if not exist "%runtime%" set "runtime=python"
"%runtime%" "%~dp0serve_sparring_review.py" %*
if errorlevel 1 pause
