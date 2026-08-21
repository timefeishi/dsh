# install.ps1 — install dsh-usage-cost into the running DeepSeek Harness.
# Idempotent: safe to re-run after editing plugin sources (re-copies + re-patches).
# A Harness restart is required for the browser half and the apiproxy whitelist.
$ErrorActionPreference = "Stop"

$src     = $PSScriptRoot
$runtime = "C:\Users\16667\AppData\Roaming\DeepSeek Harness\dsh-runtime"
$dshHome = "C:\Users\16667\.dsh"
$profilesNodeModules = Join-Path $dshHome "profiles\node_modules"
$profilePatch = Join-Path $dshHome "profiles\web\cordis.patch.yml"
$apiproxyLib  = Join-Path $runtime "node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js"

Write-Host "== 1/4 copy plugin into runtime node_modules =="
$target = Join-Path $runtime "node_modules\dsh-usage-cost"
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Copy-Item $src $target -Recurse -Force
Write-Host "  -> $target"

Write-Host "== 2/4 link plugin into profile node_modules =="
New-Item -ItemType Directory -Path $profilesNodeModules -Force | Out-Null
$link = Join-Path $profilesNodeModules "dsh-usage-cost"
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

Write-Host "== 3/4 add mount row to profile cordis.patch.yml =="
# cordis.patch.yml is a PATCH layer: adding a new plugin row requires the
# `- insert:` form (a bare `- id:` row is treated as an id-targeted patch of
# an existing entry, and the whole file is rejected when the id is unknown).
$content = if (Test-Path $profilePatch) { Get-Content $profilePatch -Raw } else { "[]`n" }
if ($content -match "(?m)^\s*- insert:\s*$[\s\S]*dsh-usage-cost") {
  Write-Host "  insert block already present"
} else {
  $insertBlock = "- insert:`n    - id: usage-cost`n      name: dsh-usage-cost`n"
  # Strip any stale bare usage-cost row (wrong patch form) and the old root []
  $content = [regex]::Replace($content, "(?m)^\s*- id: usage-cost\s*$[\s\S]*?^\s*$", "")
  $content = $content -replace "\[\]\s*$", ""
  $content = $content.TrimEnd() + "`n" + $insertBlock
  Set-Content -Path $profilePatch -Value $content -Encoding UTF8 -NoNewline
  Write-Host "  wrote insert block to $profilePatch"
}

Write-Host "== 4/4 expose settings namespace via apiproxy =="
# dsh rc.7 removed the WEB_SETTINGS_NAMESPACES whitelist upstream (every
# registered settings namespace is served to the Web client), so the patch is
# only needed for runtimes <= rc.6. Skip gracefully when the pattern is gone.
if (-not (Test-Path $apiproxyLib)) { throw "apiproxy lib not found: $apiproxyLib" }
$raw = Get-Content $apiproxyLib -Raw
if ($raw -notmatch '"web-search-deepseek"') {
  Write-Host "  apiproxy settings whitelist removed upstream (dsh rc.7+), no patch needed"
} elseif ($raw -match '"usage-cost"') {
  Write-Host "  whitelist already patched"
} else {
  $patched = [regex]::Replace(
    $raw,
    '"web-search-deepseek"(\r?\n)[ \t]*\]',
    { param($m)
      '"web-search-deepseek",' + $m.Groups[1].Value + "`t`"usage-cost`"" + $m.Groups[1].Value + "]"
    })
  if ($patched -eq $raw) { throw "could not locate WEB_SETTINGS_NAMESPACES tail to patch" }
  Set-Content -Path $apiproxyLib -Value $patched -Encoding UTF8 -NoNewline
  Write-Host "  patched WEB_SETTINGS_NAMESPACES in $apiproxyLib"
}

Write-Host ""
Write-Host "Done. Restart the Harness for the browser half to take effect."
Write-Host "Host half may hot-mount via the profile patch watcher (cordis.patch.yml)."
