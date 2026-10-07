param(
  [Parameter(Mandatory = $true)][string]$BatchPath,
  [Parameter(Mandatory = $true)][string]$LauncherScript,
  [Parameter(Mandatory = $true)][string]$TaskName
)

$resolvedBatch = [System.IO.Path]::GetFullPath($BatchPath)
$resolvedLauncher = [System.IO.Path]::GetFullPath($LauncherScript)
if (-not (Test-Path -LiteralPath $resolvedBatch)) { throw "启动文件不存在：$resolvedBatch" }
if (-not (Test-Path -LiteralPath $resolvedLauncher)) { throw "隐藏启动器不存在：$resolvedLauncher" }

$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$arguments = "//B //Nologo `"$resolvedLauncher`" `"$resolvedBatch`""
$action = New-ScheduledTaskAction -Execute $wscript -Argument $arguments
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
