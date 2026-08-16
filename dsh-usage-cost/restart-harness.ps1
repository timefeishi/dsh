# restart-harness.ps1 — detached restart of the DeepSeek Harness desktop app.
# Waits a few seconds (so the launching turn can finish), stops the known
# GUI + backend processes, then relaunches the app. The new instance picks up
# the freshly installed dsh-usage-cost plugin (client bundle + apiproxy whitelist).
# ⚠️ 调试辅助脚本：下面的 PID 列表是某次会话的现场值，用时必须重新核对；
#    重启用开发端 release-upd\win-unpacked（Program Files 安装版已卸载）。
$ErrorActionPreference = "SilentlyContinue"

$log = Join-Path $PSScriptRoot "restart.log"
function Log([string]$msg) {
  ("{0}  {1}" -f (Get-Date -Format "HH:mm:ss"), $msg) | Out-File -FilePath $log -Append -Encoding utf8
}
Log "script started (pid $PID)"

$delaySeconds = 20
Log "waiting $delaySeconds s before restart..."
Start-Sleep -Seconds $delaySeconds

# Known instance PIDs (stable since 11:08; verified before launching this script)
$appPids = @(20308, 10100, 9120, 9908)
$backendPid = 21924
$runtimeNode = "C:\Users\16667\AppData\Roaming\DeepSeek Harness\dsh-runtime\node.exe"

Log "stopping app processes..."
foreach ($pid_ in $appPids) {
  $p = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
  if ($p) { Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue; Log "  stopped $pid_ ($($p.ProcessName))" }
  else { Log "  $pid_ already gone" }
}

# Stop the old backend (and any node running from the runtime that predates this script)
$cutoff = (Get-Date).AddSeconds(-($delaySeconds + 5))
Get-Process node -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -eq $runtimeNode -and $_.StartTime -lt $cutoff
} | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  Log "  stopped backend node $($_.Id)"
}

Start-Sleep -Seconds 3

Log "relaunching app..."
$devApp = Join-Path (Split-Path -Parent $PSScriptRoot) "release-upd\win-unpacked\DeepSeek Harness.exe"
Start-Process $devApp | Out-Null
Log "launched. Done."
