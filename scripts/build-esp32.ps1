param([ValidateSet('build','size','reconfigure')][string]$Action = 'build')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $env:IDF_PATH) { $env:IDF_PATH = Join-Path $root '.tools\esp-idf' }
if (-not $env:IDF_TOOLS_PATH) { $env:IDF_TOOLS_PATH = Join-Path $root '.tools\espressif' }
$env:IDF_PATH = (Resolve-Path -LiteralPath $env:IDF_PATH).Path
$env:IDF_TOOLS_PATH = (Resolve-Path -LiteralPath $env:IDF_TOOLS_PATH).Path
if (-not $env:IDF_PYTHON_ENV_PATH) {
    $pythonEnv = Get-ChildItem -LiteralPath (Join-Path $env:IDF_TOOLS_PATH 'python_env') -Directory -ErrorAction SilentlyContinue | Where-Object Name -Like 'idf5.5_*' | Select-Object -First 1
    if ($pythonEnv) { $env:IDF_PYTHON_ENV_PATH = $pythonEnv.FullName }
}
if ($env:IDF_PYTHON_ENV_PATH) { $python = Join-Path $env:IDF_PYTHON_ENV_PATH 'Scripts\python.exe' }
else { $python = (Get-Command python.exe -ErrorAction Stop).Source }
if (!(Test-Path -LiteralPath (Join-Path $env:IDF_PATH 'tools\idf.py'))) { throw 'Install ESP-IDF 5.5.1 and run in its PowerShell environment, or set IDF_PATH and IDF_TOOLS_PATH.' }
$exports = & $python (Join-Path $env:IDF_PATH 'tools\idf_tools.py') export --format key-value
if ($LASTEXITCODE -ne 0) { throw 'ESP-IDF export failed.' }
foreach ($line in $exports) {
    if ($line -match '^([A-Z_][A-Z_0-9]*)=(.*)$') {
        $key = $Matches[1]
        $value = $Matches[2].Replace('%PATH%', $env:PATH).Replace('$PATH', $env:PATH)
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
}
$env:IDF_TARGET = 'esp32s3'
$env:PYTHONUTF8 = '1'
$env:CMAKE_BUILD_PARALLEL_LEVEL = '4'
& $python (Join-Path $env:IDF_PATH 'tools\idf.py') -C (Join-Path $root 'firmware\monitor-5b') $Action
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# The app's read-only data is copied into PSRAM next to three 1.2 MB RGB framebuffers.
# 6.8 MB images boot-looped with "no mem for frame buffer"; 4.16 MB images ran with ~570 KB PSRAM free.
$image = Join-Path $root 'firmware\monitor-5b\build\monitor_5b.bin'
$limit = 4.5MB
if ($Action -eq 'build' -and (Get-Item $image).Length -gt $limit) {
    Write-Error ("App image {0:N0} bytes exceeds the {1:N0}-byte PSRAM budget; the RGB panel would fail to allocate framebuffers." -f (Get-Item $image).Length, $limit)
    exit 3
}
exit 0
