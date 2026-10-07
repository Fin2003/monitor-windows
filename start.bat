@echo off
setlocal
cd /d "%~dp0"
set "TASK_NAME=Monitor.Windows.SystemMonitor"
set "ENGINE_DIR=%~dp0plugins\system-monitor\engine"
set "REGISTER_SCRIPT=%ENGINE_DIR%\register-elevated-task.ps1"
set "UNREGISTER_SCRIPT=%ENGINE_DIR%\unregister-elevated-task.ps1"
set "LAUNCHER_SCRIPT=%ENGINE_DIR%\elevated-launch.vbs"
set "TASK_LOG=%~dp0plugins\system-monitor\runtime\elevated-task.log"
set "STALE_CLEANUP_MARKER=%~dp0plugins\system-monitor\runtime\cleanup-stale-electron"

if /I "%~1"=="--uninstall-task" goto dependencies_ready
if not exist "%~dp0node_modules\electron\dist\electron.exe" goto install_dependencies
if not exist "%ENGINE_DIR%\win-x64\SystemMonitorEngine.current.exe" goto install_dependencies
if not exist "%~dp0dist\manager.html" goto install_dependencies
goto dependencies_ready

:install_dependencies
call "%~dp0install-dependencies.bat" --quiet
if errorlevel 1 (
    pause
    exit /b 1
)

:dependencies_ready

if /I not "%~1"=="--autostart" if /I not "%~1"=="--uninstall-task" (
    if exist "%~dp0autostart.quit" del /q "%~dp0autostart.quit"
)

if /I "%~1"=="--install-task" (
    if not exist "%~dp0plugins\system-monitor\runtime" mkdir "%~dp0plugins\system-monitor\runtime"
    powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "%REGISTER_SCRIPT%" -BatchPath "%~f0" -LauncherScript "%LAUNCHER_SCRIPT%" -TaskName "%TASK_NAME%" >"%TASK_LOG%" 2>&1
    if errorlevel 1 goto launch_app
    exit /b 0
)

if /I "%~1"=="--uninstall-task" (
    powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "%UNREGISTER_SCRIPT%" -TaskName "%TASK_NAME%"
    exit /b %errorlevel%
)

rem Keep the GUI at normal user privilege; the hardware engine elevates separately.
:launch_app
if /I "%~1"=="--autostart" (
    powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\monitor-autostart.ps1" -Action launch-check
    if errorlevel 1 exit /b 0
)
if exist "%STALE_CLEANUP_MARKER%" (
    del /q "%STALE_CLEANUP_MARKER%" >nul 2>&1
    powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$electron = [IO.Path]::GetFullPath('%~dp0node_modules\electron\dist\electron.exe'); $engineRoot = [IO.Path]::GetFullPath('%~dp0plugins\system-monitor\engine\win-x64'); Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'electron.exe' -and $_.ExecutablePath -eq $electron) -or ($_.Name -like 'SystemMonitorEngine*' -and $_.ExecutablePath -like ($engineRoot + '*')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 300"
    if exist "%ENGINE_DIR%\win-x64\SystemMonitorEngine.exe" copy /y "%ENGINE_DIR%\win-x64\SystemMonitorEngine.exe" "%ENGINE_DIR%\win-x64\SystemMonitorEngine.current.exe" >nul
)

if not exist "dist\manager.html" (
    echo [Monitor] Building for first time...
    call npx.cmd vite build
    if errorlevel 1 (
        echo [Monitor] Build failed!
        pause
        exit /b 1
    )
)

powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%~dp0'; & npx.cmd electron . %*"
