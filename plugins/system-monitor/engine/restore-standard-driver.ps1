$engine = Join-Path $PSScriptRoot 'SystemMonitorEngine.current.exe'
if (-not (Test-Path -LiteralPath $engine)) { $engine = Join-Path $PSScriptRoot 'SystemMonitorEngine.exe' }
if (-not (Test-Path $engine)) {
  throw 'SystemMonitorEngine.exe not found.'
}

$result = Start-Process -FilePath $engine -ArgumentList '--restore-driver' -WorkingDirectory $PSScriptRoot -Verb RunAs -Wait -PassThru
if ($result.ExitCode -ne 0) {
  throw "Driver restore failed with exit code $($result.ExitCode)."
}
