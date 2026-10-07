$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)

function Refresh-ToolPath {
    $paths = [Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path
    $env:Path = (($paths -join ';').Split(';') | Where-Object { $_ } | Select-Object -Unique) -join ';'
}

function Install-Tool([string]$Id) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw "Install Windows App Installer (winget) first, then rerun this script. Missing package: $Id"
    }
    Write-Host "[Monitor] Installing $Id ..."
    & winget.exe install --id $Id --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw "winget could not install $Id (exit $LASTEXITCODE)" }
    Refresh-ToolPath
}

try {
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
        throw 'This source distribution builds the Windows x64 hardware engine.'
    }
    Refresh-ToolPath
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        Install-Tool 'OpenJS.NodeJS.LTS'
    } else {
        $nodeVersion = [version]((& node.exe --version).TrimStart('v'))
        if ($nodeVersion -lt [version]'22.12.0') { Install-Tool 'OpenJS.NodeJS.LTS' }
    }
    if (-not (Get-Command dotnet.exe -ErrorAction SilentlyContinue)) {
        Install-Tool 'Microsoft.DotNet.SDK.8'
    } else {
        $sdks = & dotnet.exe --list-sdks
        if (-not ($sdks | Where-Object { $_ -match '^([89]|[1-9][0-9])\.' })) {
            Install-Tool 'Microsoft.DotNet.SDK.8'
        }
    }
    if (-not (Get-Command cmake.exe -ErrorAction SilentlyContinue)) { Install-Tool 'Kitware.CMake' }
    if (-not (Get-Command ninja.exe -ErrorAction SilentlyContinue)) { Install-Tool 'Ninja-build.Ninja' }
    $msysRoot = if ($env:MSYS2_ROOT) { $env:MSYS2_ROOT } else { 'C:\msys64' }
    if (-not (Test-Path (Join-Path $msysRoot 'usr\bin\bash.exe'))) { Install-Tool 'MSYS2.MSYS2' }
    if (-not (Test-Path (Join-Path $msysRoot 'ucrt64\bin\gcc.exe'))) {
        & (Join-Path $msysRoot 'usr\bin\bash.exe') -lc 'pacman -Sy --noconfirm --needed mingw-w64-ucrt-x86_64-gcc'
        if ($LASTEXITCODE -ne 0) { throw 'MSYS2 could not install the UCRT64 compiler.' }
    }
    $env:Path = (Join-Path $msysRoot 'ucrt64\bin') + ';' + (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links') + ';' + $env:Path
    $toolDirectories = 'node.exe', 'npm.cmd', 'dotnet.exe', 'cmake.exe', 'ninja.exe' | ForEach-Object { Split-Path (Get-Command $_).Source -Parent }
    $env:Path = (($toolDirectories + $env:Path.Split(';')) | Select-Object -Unique) -join ';'
    Write-Host '[Monitor] Installing locked Node dependencies ...'
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)" }
    Write-Host '[Monitor] Building the Windows hardware engine ...'
    & npm.cmd run build:engine
    if ($LASTEXITCODE -ne 0) { throw "Hardware engine build failed (exit $LASTEXITCODE)" }
    Write-Host '[Monitor] Building the ESP32 touchscreen preview ...'
    & npm.cmd run build:preview
    if ($LASTEXITCODE -ne 0) { throw "Preview build failed (exit $LASTEXITCODE)" }
    Write-Host '[Monitor] Building the interface ...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Interface build failed (exit $LASTEXITCODE)" }
    Write-Host '[Monitor] Ready. Double-click start.bat to launch.' -ForegroundColor Green
    exit 0
} catch {
    Write-Host "[Monitor] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
