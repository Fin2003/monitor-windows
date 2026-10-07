@echo off
setlocal
cd /d "%~dp0"
set "MONITOR_ESP32_PROFILE=%~dp0.review-profile"
call "%~dp0start.bat" %*
