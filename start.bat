@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" goto install
if not exist "plugins\system-monitor\engine\win-x64\SystemMonitorEngine.current.exe" goto install
if not exist "dist\manager.html" goto install
if not exist "electron\esp32\native\win-x64\MonitorEsp32Preview.exe" goto install
goto launch
:install
call "%~dp0install-dependencies.bat" --quiet
if errorlevel 1 (
    pause
    exit /b 1
)
:launch
call node_modules\.bin\electron.cmd . %*
