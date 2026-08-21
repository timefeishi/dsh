$ErrorActionPreference = "Continue"
$profileDir = "C:\Users\16667\.dsh\profiles\web"
Write-Host "==== files under $profileDir ===="
Get-ChildItem $profileDir -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ("   {0}  ({1:N0} B)" -f $_.FullName.Substring($profileDir.Length), (if($_.PSIsContainer){''}else{$_.Length})) }
Write-Host ""
Write-Host "==== where is 'pzds' referenced under .dsh ? ===="
Get-ChildItem "C:\Users\16667\.dsh" -Recurse -File -Include *.yml,*.yaml,*.json,*.toml,*.js,*.mjs,*.cjs -ErrorAction SilentlyContinue |
  Where-Object { (Select-String -Path $_.FullName -Pattern 'pzds' -Quiet -ErrorAction SilentlyContinue) } |
  ForEach-Object { Write-Host ("--- {0}" -f $_.FullName); (Select-String -Path $_.FullName -Pattern 'pzds' -ErrorAction SilentlyContinue) | ForEach-Object { Write-Host ("      L{0}: {1}" -f $_.LineNumber, ($_.Line.Trim() -replace '\s+',' ')) } }
Write-Host ""
Write-Host "==== top-level .dsh config ===="
Get-ChildItem "C:\Users\16667\.dsh" -Force -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer } | ForEach-Object { Write-Host ("   {0}" -f $_.Name) }