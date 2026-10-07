# Starts Monitor at logon and brings it back if it stops (crash, bluescreen, reboot).
#   install   - per-user task Monitor.Windows.AutoStart (no elevation) running monitor-autostart.vbs
#   uninstall - removes the task and stops the watchdog (Monitor itself keeps running)
#   pause     - keep Monitor closed on purpose; the watchdog ignores it until resume
#   resume    - watchdog relaunches Monitor within a minute if it is not running
#   status
param([ValidateSet('install','uninstall','pause','resume','status','launch-check')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$taskName = 'Monitor.Windows.AutoStart'
$pauseFile = Join-Path $root 'autostart.paused'
$quitFile = Join-Path $root 'autostart.quit'
$watchdog = Join-Path $PSScriptRoot 'monitor-autostart.vbs'
function Get-Watchdog { Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" | Where-Object { $_.CommandLine -like '*monitor-autostart.vbs*' } }

switch ($Action) {
    'launch-check' {
        if (Test-Path -LiteralPath $pauseFile) { exit 1 }
        if (Test-Path -LiteralPath $quitFile) {
            $bootTime = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
            if ((Get-Item -LiteralPath $quitFile).LastWriteTime -ge $bootTime) { exit 1 }
            Remove-Item -LiteralPath $quitFile
        }
        exit 0
    }
    'install' {
        $user = "$env:USERDOMAIN\$env:USERNAME"
        $taskAction = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument "//B //Nologo `"$watchdog`" `"$root`"" -WorkingDirectory $root
        $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
        $logon.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)).Repetition
        # A logon trigger's repetition only starts after the next logon, so also repeat from now on.
        $watch = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
        $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
        $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger @($logon, $watch) -Settings $settings -Principal $principal -Force `
            -Description 'Starts Monitor at logon and relaunches it after crashes (scripts/monitor-autostart.ps1).' | Out-Null
        Start-ScheduledTask -TaskName $taskName
        "Installed $taskName"
    }
    'uninstall' {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Get-Watchdog | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
        "Removed $taskName"
    }
    'pause'  { New-Item -ItemType File -Force $pauseFile | Out-Null; 'Watchdog paused; Monitor will not be relaunched' }
    'resume' { Remove-Item -LiteralPath $pauseFile,$quitFile -ErrorAction SilentlyContinue; 'Watchdog resumed' }
    'status' {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        "Task: " + $(if ($task) { $task.State } else { 'not installed' }) + $(if (Test-Path $pauseFile) { ' (paused)' } else { '' })
        Get-Watchdog | ForEach-Object { "  watchdog PID $($_.ProcessId)" }
        $electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
        $app = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.ExecutablePath -eq $electron }
        "Monitor: " + $(if ($app) { "running ($(@($app).Count) processes)" } else { 'not running' })
    }
}
