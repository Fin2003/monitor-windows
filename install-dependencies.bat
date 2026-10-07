@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-dependencies.ps1"
set "SETUP_EXIT=%errorlevel%"
if not "%SETUP_EXIT%"=="0" echo [Monitor] Setup failed. See the message above.
if /I not "%~1"=="--quiet" pause
exit /b %SETUP_EXIT%
