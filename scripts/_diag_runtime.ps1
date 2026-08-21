$ErrorActionPreference = "Continue"

Write-Host "==== 1) does the NEW build ship the packed runtime? ===="
$res = "c:\Users\16667\Desktop\dsh\dsh-desktop\release-upd\win-unpacked\resources"
Write-Host "resources dir: $res  exists=$(Test-Path $res)"
if (Test-Path $res) {
  Get-ChildItem $res | Where-Object { $_.Name -like 'dsh-runtime*' } | ForEach-Object { Write-Host ("   {0}  {1:N1} MB  lastWrite={2}" -f $_.Name, ($_.Length/1MB), $_.LastWriteTime) }
  if (-not (Get-ChildItem $res | Where-Object { $_.Name -like 'dsh-runtime*' })) { Write-Host "   >>> NO dsh-runtime.tar.gz / .sha256 in resources!" }
}

Write-Host ""
Write-Host "==== 2) extracted runtime marker vs its plugins ===="
$marker = "C:\Users\16667\AppData\Roaming\DeepSeek Harness\dsh-runtime\.dsh-runtime.sha256"
if (Test-Path $marker) { Write-Host "extracted marker: $((Get-Content $marker -Raw).Trim())" } else { Write-Host "no marker (runtime never extracted OR marker missing)" }
$plugin = "C:\Users\16667\AppData\Roaming\DeepSeek Harness\dsh-runtime\node_modules\dsh-usage-cost"
Write-Host "dsh-usage-cost in extracted runtime: $(Test-Path $plugin)"
$link = "C:\Users\16667\.dsh\profiles\node_modules\dsh-usage-cost"
Write-Host "profile junction dsh-usage-cost: $(Test-Path $link) (exists)"
if (Test-Path $link) { Get-Item $link | Select-Object LinkType,Target | Format-List | Out-String | Write-Host }

Write-Host ""
Write-Host "==== 3) log: extract / hash / launch markers ===="
$log = "C:\Users\16667\AppData\Roaming\DeepSeek Harness\logs\dsh-web.log"
Select-String -Path $log -Pattern 'launch mode|runtime hash mismatch|re-extract|runtime extracted|starting:|server ready|ensureUsageCost' | ForEach-Object { "{0}: {1}" -f $_.LineNumber, ($_.Line -replace '\s+',' ') }