# trim-runtime.ps1 — conservative trimming of the bundled dsh-runtime
# node_modules. Only removes files that are provably not needed at runtime on
# win32-x64:
#   - prebuilds for other platforms (darwin/linux/other arch)
#   - C++/TypeScript sources (src/, deps/, *.ts, *.map)
#   - tests/examples/docs
# Keeps everything that could possibly be required (LICENSE, README, .d.ts,
# resources, fonts...). If a runtime feature breaks after trimming, run with
# -KeepBackup to restore the original tree.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\trim-runtime.ps1 [-KeepBackup]

param([switch]$KeepBackup)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$nm = Join-Path $root "resources\dsh-runtime\node_modules"
if (-not (Test-Path $nm)) { throw "not found: $nm (run prepare-runtime.ps1 first)" }

$before = @(Get-ChildItem $nm -Recurse -File -ErrorAction SilentlyContinue).Count
$beforeMB = [math]::Round(((Get-ChildItem $nm -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum)/1MB, 0)

if ($KeepBackup) {
  $bak = Join-Path $root "resources\dsh-runtime-backup"
  if (Test-Path $bak) { Remove-Item $bak -Recurse -Force }
  Copy-Item (Split-Path $nm) $bak -Recurse -Force
  Write-Host "  backup -> $bak" -ForegroundColor DarkGray
}

# ── packages that must never be trimmed ──────────────────────────────────
# Native modules or packages whose ESM entries reference src/ at runtime
# (koffi/index.js imports ./src/koffi/index.js). Trimming them breaks boot.
$protected = @(
  'koffi', 'node-pty', 'sharp', 'katex', 'shiki', '@shikijs',
  '@img', '@vscode', '@mixmark-io', '@earendil-works', '@tanstack'
)

function Is-Protected([string]$relPath) {
  foreach ($p in $protected) {
    if ($relPath -eq $p -or $relPath.StartsWith("$p\")) { return $true }
  }
  return $false
}

function Remove-NodeModulesPath([string]$path) {
  if (-not (Test-Path $path)) { return }
  $rel = $path.Substring($nm.Length + 1)
  if (Is-Protected $rel) {
    Write-Host "  SKIP (protected): $rel" -ForegroundColor DarkGray
    return
  }
  $files = Get-ChildItem $path -Recurse -File -ErrorAction SilentlyContinue
  $script:removed += $files.Count
  $script:removedMB += ($files | Measure-Object Length -Sum).Sum
  Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "==> Trimming dsh-runtime node_modules (win32-x64 only)" -ForegroundColor Cyan

# 1. cross-platform prebuilds: keep only win32-x64 / x64
Get-ChildItem $nm -Recurse -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^(prebuilds|prebuild)$' } |
  ForEach-Object {
    $pkgRel = $_.FullName.Substring($nm.Length + 1)
    if (Is-Protected $pkgRel) { return }
    Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notmatch '^(win32-x64|windows-x64|x64|win-x64|win32)$' } |
      ForEach-Object { Remove-NodeModulesPath $_.FullName }
  }

# node-pty keeps only its win32-x64 prebuild + build/Release; drop sources
Remove-NodeModulesPath (Join-Path $nm "node-pty\src")
Remove-NodeModulesPath (Join-Path $nm "node-pty\deps")
Remove-NodeModulesPath (Join-Path $nm "node-pty\scripts")
Remove-NodeModulesPath (Join-Path $nm "node-pty\prebuilds\darwin-arm64")
Remove-NodeModulesPath (Join-Path $nm "node-pty\prebuilds\darwin-x64")
Remove-NodeModulesPath (Join-Path $nm "node-pty\prebuilds\win32-arm64")

# 2. well-known non-runtime dirs in every package
$dropDirs = @('src','deps','test','tests','example','examples','demo','benchmark','bench','docs','doc','coverage','.github','.vscode','.idea','assets-src','node_modules\.bin')
Get-ChildItem $nm -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $pkg = $_.FullName
  foreach ($d in $dropDirs) { Remove-NodeModulesPath (Join-Path $pkg $d) }
}
# scoped packages (@scope/pkg)
Get-ChildItem $nm -Directory -Filter '@*' -ErrorAction SilentlyContinue | ForEach-Object {
  Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    foreach ($d in $dropDirs) { Remove-NodeModulesPath (Join-Path $_.FullName $d) }
  }
}

# 3. source maps + TS sources (never required at runtime) — skip protected
Get-ChildItem $nm -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in @('.map','.ts','.tsx') -and $_.Name -notmatch '\.d\.ts$' } |
  ForEach-Object {
    $rel = $_.FullName.Substring($nm.Length + 1)
    if (Is-Protected $rel) { return }
    $script:removed += 1; $script:removedMB += $_.Length
    Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
  }

# 4. keep only win32-x64 ripgrep binary (protected, so explicit)
Get-ChildItem $nm -Directory -Filter '@vscode*' -ErrorAction SilentlyContinue | ForEach-Object {
  Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch 'win32-x64' } |
    ForEach-Object { Remove-NodeModulesPath $_.FullName }
}

$after = @(Get-ChildItem $nm -Recurse -File -ErrorAction SilentlyContinue).Count
$afterMB = [math]::Round(((Get-ChildItem $nm -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum)/1MB, 0)

Write-Host ""
Write-Host "  removed : $removed files / $([math]::Round($removedMB/1MB,0)) MB" -ForegroundColor Yellow
Write-Host "  before  : $before files / $beforeMB MB" -ForegroundColor DarkGray
Write-Host "  after   : $after files / $afterMB MB" -ForegroundColor Green
Write-Host "==> trim done" -ForegroundColor Cyan
