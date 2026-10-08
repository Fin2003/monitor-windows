@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\flash-firmware.ps1" %*
if errorlevel 1 echo Firmware installation failed. Read the message above.
pause
