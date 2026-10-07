param([switch]$Disable)

$flag = Join-Path $PSScriptRoot 'enable-experimental-pawnio.flag'
$engine = Join-Path $PSScriptRoot 'SystemMonitorEngine.current.exe'
if (-not (Test-Path -LiteralPath $engine)) { $engine = Join-Path $PSScriptRoot 'SystemMonitorEngine.exe' }
if ($Disable) {
  Remove-Item -LiteralPath $flag -Force -ErrorAction SilentlyContinue
  & $engine --restore-driver
  exit $LASTEXITCODE
}

New-Item -ItemType File -Path $flag -Force | Out-Null
& $engine --configure-driver
