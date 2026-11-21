$ErrorActionPreference = "SilentlyContinue"
$workspaceDir = Join-Path $PSScriptRoot "workspace"
$runtimeJson = Join-Path $workspaceDir ".runtime.json"
if (-not (Test-Path $runtimeJson)) {
  @{ ok = $true; message = "Not running" } | ConvertTo-Json -Compress
  exit 0
}
$rt = Get-Content $runtimeJson -Encoding UTF8 | ConvertFrom-Json
if ($rt.pid) { Stop-Process -Id ([int]$rt.pid) -Force }
if ($rt.launcherPid) { Stop-Process -Id ([int]$rt.launcherPid) -Force }
Remove-Item $runtimeJson -Force
@{ ok = $true; stoppedPid = $rt.pid } | ConvertTo-Json -Compress