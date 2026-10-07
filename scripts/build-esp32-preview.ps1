$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$msysRoot = if ($env:MSYS2_ROOT) { $env:MSYS2_ROOT } else { 'C:\msys64' }
$env:Path = (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links') + ';' + $env:Path
if (-not (Get-Command cmake.exe -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $env:ProgramFiles 'CMake\bin\cmake.exe'))) {
    $env:Path = (Join-Path $env:ProgramFiles 'CMake\bin') + ';' + $env:Path
}
$gcc = Get-Command gcc.exe -ErrorAction SilentlyContinue
if (-not $gcc -and (Test-Path (Join-Path $msysRoot 'ucrt64\bin\gcc.exe'))) {
    $env:Path = (Join-Path $msysRoot 'ucrt64\bin') + ';' + $env:Path
    $gcc = Get-Command gcc.exe
}
if (-not $gcc) { throw 'Install MSYS2 and mingw-w64-ucrt-x86_64-gcc to build the native ESP32 preview.' }
$env:Path = (Split-Path $gcc.Source -Parent) + ';' + $env:Path
$build = Join-Path $root '.tools\native-preview-build'
& cmake.exe -S (Join-Path $root 'firmware\simulator') -B $build -G Ninja '-DCMAKE_BUILD_TYPE=Release' "-DCMAKE_C_COMPILER=$($gcc.Source)"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& cmake.exe --build $build --target MonitorEsp32Preview --parallel 8
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$output = Join-Path $root 'electron\esp32\native\win-x64'
New-Item -ItemType Directory -Force -Path $output | Out-Null
Copy-Item -LiteralPath (Join-Path $build 'MonitorEsp32Preview.exe') -Destination $output
Write-Host '[Monitor] Native ESP32 preview ready.'
