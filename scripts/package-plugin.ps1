param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Output
)
$ErrorActionPreference = 'Stop'
$pluginRoot = (Resolve-Path -LiteralPath $Path).Path
$outputFile = [IO.Path]::GetFullPath($Output)
& node (Join-Path $PSScriptRoot 'validate-plugin-catalog.cjs') (Join-Path $pluginRoot 'manifest.json')
if ($LASTEXITCODE -ne 0) { throw 'Plugin manifest is invalid' }
if ($outputFile.StartsWith($pluginRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose an output ZIP outside the plugin folder'
}
$excluded = @('node_modules', '.git', '.device-profile', '.review-profile', 'Cache', 'Code Cache', 'GPUCache', 'Partitions')
$unwanted = Get-ChildItem -LiteralPath $pluginRoot -Recurse -Force | Where-Object {
    $_.Name -in $excluded -or $_.Name -match '^(Cookies.*|Login Data.*|Local State|config\.json|sensor-cache\.json|driver-state\.json)$|\.(log|bak|db|sqlite\d?)$'
}
if ($unwanted) { throw 'Remove dependencies, private configuration and runtime caches before packaging' }
New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($outputFile)) -Force | Out-Null
Compress-Archive -Path (Join-Path $pluginRoot '*') -DestinationPath $outputFile -Force
$checksum = (Get-FileHash -LiteralPath $outputFile -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "ZIP: $outputFile"
Write-Output "SHA256: $checksum"
