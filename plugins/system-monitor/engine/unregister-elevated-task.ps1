param([Parameter(Mandatory = $true)][string]$TaskName)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
