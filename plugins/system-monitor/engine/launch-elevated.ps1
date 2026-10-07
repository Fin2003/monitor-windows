param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][int]$Port,
  [Parameter(Mandatory = $true)][int]$ParentPid
)

$arguments = @('--port', $Port, '--parent-pid', $ParentPid)
$process = Start-Process -FilePath $Executable -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $Executable) -WindowStyle Hidden -Verb RunAs -PassThru
Write-Output $process.Id
