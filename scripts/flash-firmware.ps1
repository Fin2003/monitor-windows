param([string]$Port, [switch]$AppOnly)
$ErrorActionPreference = 'Stop'
$bundle = Split-Path $PSScriptRoot -Parent
if (!(Test-Path -LiteralPath (Join-Path $bundle 'monitor_5b.bin'))) {
    throw 'Extract the firmware ZIP from Releases first. This script must be in its scripts folder.'
}
Write-Host 'Monitor firmware: Waveshare ESP32-S3-Touch-LCD-5B, 1024x600, 16MB flash / 8MB PSRAM.'
Write-Host 'Close Monitor and other serial applications before flashing.'
Get-CimInstance Win32_PnPEntity | Where-Object Name -match '\(COM\d+\)' | Select-Object Name | Format-Table -AutoSize
if (!$Port) { $Port = Read-Host 'Enter the port of YOUR screen (COM number)' }
if ($Port -notmatch '^COM\d+$') { throw 'Enter a COM port such as COM4.' }
$python = Get-Command py.exe -ErrorAction SilentlyContinue
$pythonArgs = @('-3')
if (!$python) { $python = Get-Command python.exe -ErrorAction SilentlyContinue; $pythonArgs = @() }
if (!$python) { throw 'Install Python 3 from https://www.python.org/downloads/windows/ and enable PATH, then retry.' }
$venv = Join-Path $bundle '.flash-tools'
if (!(Test-Path -LiteralPath (Join-Path $venv 'Scripts\python.exe'))) {
    & $python.Source @pythonArgs -m venv $venv
    if ($LASTEXITCODE) { throw 'Python environment creation failed.' }
}
$flashPython = Join-Path $venv 'Scripts\python.exe'
& $flashPython -m pip install 'esptool==4.9.0'
if ($LASTEXITCODE) { throw 'esptool installation failed.' }
$answer = Read-Host "Write Monitor firmware to $Port? Type FLASH to continue"
if ($answer -cne 'FLASH') { Write-Host 'Cancelled.'; exit 0 }
$images = @('0x10000', (Join-Path $bundle 'monitor_5b.bin'))
if (!$AppOnly) { $images = @('0x0', (Join-Path $bundle 'bootloader.bin'), '0x8000', (Join-Path $bundle 'partition-table.bin')) + $images }
& $flashPython -m esptool --chip esp32s3 --port $Port --baud 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_freq 80m --flash_size 16MB @images
if ($LASTEXITCODE) { throw 'Flashing failed. See docs/esp32-setup.md for BOOT mode and USB troubleshooting.' }
Write-Host 'Firmware verified. Press RESET if needed, open Monitor ESP32 and choose Auto connect.'
