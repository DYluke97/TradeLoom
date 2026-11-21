param(
  [int]$Port = 3200,
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"
$baseDir = $PSScriptRoot
$nodeExe = Join-Path $baseDir "runtime\node.exe"
$serverJs = Join-Path $baseDir "app\server.js"
$appDir = Join-Path $baseDir "app"
$workspaceDir = Join-Path $baseDir "workspace"
$runtimeJson = Join-Path $workspaceDir ".runtime.json"

New-Item -ItemType Directory -Force -Path $workspaceDir | Out-Null

# Reuse already running instance for this folder if healthy
if (Test-Path $runtimeJson) {
  try {
    $prev = Get-Content $runtimeJson -Encoding UTF8 | ConvertFrom-Json
    if ($prev.url) {
      $chk = Invoke-WebRequest -Uri "$($prev.url)/api/vault" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
      if ($chk.StatusCode -eq 200) {
        if ($OpenBrowser) { Start-Process $prev.url }
        @{ ok = $true; reused = $true; url = $prev.url; ledgerUrl = "$($prev.url)/ledger"; pid = $prev.pid; workspace = $workspaceDir } | ConvertTo-Json -Compress
        exit 0
      }
    }
  } catch {}
}

# Find free port starting from $Port
$chosenPort = -1
for ($p = $Port; $p -le ($Port + 30); $p++) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $l.Start(); $l.Stop()
    $chosenPort = $p
    break
  } catch {}
}
if ($chosenPort -lt 0) {
  @{ ok = $false; error = "No available port in range $Port..$($Port+30)" } | ConvertTo-Json -Compress
  exit 1
}

# Launch detached via WMI so the server survives AI Agent shell exit
$cmdLine = "cmd.exe /c `"set HOSTNAME=127.0.0.1&& set PORT=$chosenPort&& set NODE_ENV=production&& set TRADELOOM_WORKSPACE_DIR=$workspaceDir&& `"$nodeExe`" `"$serverJs`" > `"$workspaceDir\server.log`" 2>&1`""
$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = $cmdLine
  CurrentDirectory = $appDir
}
if ($res.ReturnValue -ne 0) {
  @{ ok = $false; error = "WMI process creation failed with code $($res.ReturnValue)" } | ConvertTo-Json -Compress
  exit 1
}

$url = "http://127.0.0.1:$chosenPort"
$ready = $false
for ($i = 0; $i -lt 50; $i++) {
  Start-Sleep -Milliseconds 300
  try {
    $r = Invoke-WebRequest -Uri "$url/api/vault" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
}

if (-not $ready) {
  @{ ok = $false; error = "Timed out waiting for $url/api/vault. Inspect $workspaceDir\server.log" } | ConvertTo-Json -Compress
  exit 1
}

# Resolve actual node.exe PID
$nodePid = $res.ProcessId
try {
  $nodeProc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$serverJs*" } | Select-Object -Last 1
  if ($nodeProc) { $nodePid = $nodeProc.ProcessId }
} catch {}

@{
  url = $url
  port = $chosenPort
  pid = $nodePid
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content -Path $runtimeJson -Encoding UTF8

if ($OpenBrowser) { Start-Process $url }
@{
  ok = $true
  reused = $false
  url = $url
  ledgerUrl = "$url/ledger"
  pid = $nodePid
  workspace = $workspaceDir
} | ConvertTo-Json -Compress