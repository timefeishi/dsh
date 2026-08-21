# install.ps1 — install dsh-pzds-tool into the running DeepSeek Harness.
# Idempotent: safe to re-run after editing plugin sources (re-copies + re-patches).
# A Harness restart is required for the plugin to load.
$ErrorActionPreference = "Stop"

$src     = $PSScriptRoot
$runtime = "C:\Users\16667\AppData\Roaming\DeepSeek Harness\dsh-runtime"
$dshHome = "C:\Users\16667\.dsh"
$profilesNodeModules = Join-Path $dshHome "profiles\node_modules"
$profilePatch = Join-Path $dshHome "profiles\web\cordis.patch.yml"

Write-Host "== 1/3 copy plugin into runtime node_modules =="
$target = Join-Path $runtime "node_modules\dsh-pzds-tool"
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Copy-Item $src $target -Recurse -Force
Write-Host "  -> $target"

Write-Host "== 2/3 link plugin into profile node_modules =="
New-Item -ItemType Directory -Path $profilesNodeModules -Force | Out-Null
$link = Join-Path $profilesNodeModules "dsh-pzds-tool"
if (Test-Path $link) {
  if ((Get-Item $link).LinkType -eq "Junction") {
    Write-Host "  junction already exists: $link"
  } else {
    Remove-Item $link -Recurse -Force
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    Write-Host "  replaced non-junction with junction: $link"
  }
} else {
  New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  Write-Host "  created junction: $link"
}

Write-Host "== 3/3 add mount row to profile cordis.patch.yml =="
# cordis.patch.yml is a PATCH layer: adding a new plugin row requires the
# `- insert:` form (a bare `- id:` row is treated as an id-targeted patch of
# an existing entry, and the whole file is rejected when the id is unknown).
$content = if (Test-Path $profilePatch) { Get-Content $profilePatch -Raw } else { "[]`n" }
if ($content -match "(?m)^\s*- insert:\s*$[\s\S]*dsh-pzds-tool") {
  Write-Host "  insert block already present"
} else {
  $insertBlock = "- insert:`n    - id: pzds-tool`n      name: dsh-pzds-tool`n"
  # Strip any stale bare usage-cost row (wrong patch form) and the old root []
  $content = [regex]::Replace($content, "(?m)^\s*- id: pzds-tool\s*$[\s\S]*?^\s*$", "")
  $content = $content -replace "\[\]\s*$", ""
  $content = $content.TrimEnd() + "`n" + $insertBlock
  Set-Content -Path $profilePatch -Value $content -Encoding UTF8 -NoNewline
  Write-Host "  wrote insert block to $profilePatch"
}

Write-Host ""
Write-Host "Done. Restart the Harness for the plugin to take effect."
