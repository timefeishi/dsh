$ErrorActionPreference = "Continue"
$profileDir = "C:\Users\16667\.dsh\profiles\web"
Write-Host "==== files under profiles\web (depth 2) ===="
Get-ChildItem $profileDir -Recurse -Depth 2 -Force -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.PSIsContainer) { return }
  Write-Host ("   {0}  ({1:N0} B)" -f $_.FullName.Substring($profileDir.Length), $_.Length)
}

Write-Host ""
Write-Host "==== text files mentioning 'pzds' under .dsh (skipping node_modules) ===="
Get-ChildItem "C:\Users\16667\.dsh" -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' -and $_.FullName -notmatch '\\\.git\\' -and $_.Length -lt 2MB } |
  ForEach-Object {
    $m = Select-String -Path $_.FullName -Pattern 'pzds' -ErrorAction SilentlyContinue
    if ($m) {
      Write-Host ("--- {0}" -f $_.FullName)
      $m | ForEach-Object { Write-Host ("      L{0}: {1}" -f $_.LineNumber, (($_.Line).Trim() -replace '\s+',' ')) }
    }
  }

Write-Host ""
Write-Host "==== top-level .dsh files ===="
Get-ChildItem "C:\Users\16667\.dsh" -Force -File -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ("   {0}" -f $_.Name) }

Write-Host ""
Write-Host "==== profiles\node_modules contents (junction targets to runtime?) ===="
Get-ChildItem "C:\Users\16667\.dsh\profiles\node_modules" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ("   {0}" -f $_.Name) }