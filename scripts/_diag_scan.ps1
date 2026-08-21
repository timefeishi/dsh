$ErrorActionPreference = "Continue"
$log = "C:\Users\16667\AppData\Roaming\DeepSeek Harness\logs\dsh-web.log"
Write-Host "total lines: $((Get-Content $log | Measure-Object -Line).Lines)"
Write-Host "---- error-ish lines (last 50) ----"
Select-String -Path $log -Pattern 'error|Error|ERROR|fail|panic|Exception|Cannot|ENOENT|not found|failed|refused|timeout' |
  Select-Object -Last 50 | ForEach-Object { "{0}: {1}" -f $_.LineNumber, ($_.Line -replace '\s+',' ') }