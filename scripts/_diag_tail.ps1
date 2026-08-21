$ErrorActionPreference = "Continue"

Write-Host "==== sha256: new build expected vs extracted marker ===="
$expected = "c:\Users\16667\Desktop\dsh\dsh-desktop\release-upd\win-unpacked\resources\dsh-runtime.sha256"
if (Test-Path $expected) { $exp = (Get-Content $expected -Raw).Trim(); Write-Host "new .sha256     : $exp" }
$marker = "C:\Users\16667\AppData\Roaming\DeepSeek Harness\dsh-runtime\.dsh-runtime.sha256"
if (Test-Path $marker) { $cur = (Get-Content $marker -Raw).Trim(); Write-Host "extracted marker: $cur" }
if ($exp -and $cur) { Write-Host ("match: {0}" -f ($exp -eq $cur)) }

Write-Host ""
Write-Host "==== last 60 lines of dsh-web.log ===="
Get-Content "C:\Users\16667\AppData\Roaming\DeepSeek Harness\logs\dsh-web.log" | Select-Object -Last 60