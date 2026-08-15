# release.ps1 — one-shot release flow:
#   git sanity (clean + in sync with origin) → bump version → build & publish
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1            # interactive version prompt
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 1.0.1
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 1.0.1 -SkipGitCheck
#
# Env:
#   GH_TOKEN  required to upload to GitHub Releases.

param(
  [string]$Version,
  [switch]$SkipGitCheck
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot   # dsh-desktop/
$git  = "git"

function Fail([string]$msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  DeepSeek Harness Release" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# ── 1. git sanity ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[1/4] Checking git state..." -ForegroundColor Yellow

if (-not $SkipGitCheck) {

if (-not (Test-Path (Join-Path $root ".git"))) { Fail "not a git repository: $root" }

# must be on master
$branch = (& $git -C $root rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($branch -ne "master") { Fail "current branch is '$branch', expected 'master'" }

# fetch latest remote state
Write-Host "  fetching origin..." -ForegroundColor DarkGray
& $git -C $root fetch origin 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { Fail "git fetch failed (network?)" }

# working tree must be clean
$dirty = (& $git -C $root status --porcelain 2>$null)
if ($dirty) {
  Write-Host "  working tree is NOT clean:" -ForegroundColor Red
  $dirty | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  Fail "commit or stash your changes first"
}

# local must equal origin/master
$local  = (& $git -C $root rev-parse HEAD).Trim()
$remote = (& $git -C $root rev-parse origin/master 2>$null).Trim()
if ($local -ne $remote) {
  Write-Host "  local  : $local" -ForegroundColor Red
  Write-Host "  origin : $remote" -ForegroundColor Red
  Fail "local master is not in sync with origin/master (run 'git pull --ff-only' or 'git push')"
}
Write-Host "  OK: clean and in sync ($($local.Substring(0,7)))" -ForegroundColor Green

} else {
  Write-Host "  SKIPPED (SkipGitCheck)" -ForegroundColor DarkGray
}

# ── 2. version bump ───────────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/4] Version bump..." -ForegroundColor Yellow

$pkgPath = Join-Path $root "package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$current = [string]$pkg.version
Write-Host "  current version: $current" -ForegroundColor DarkGray

# suggest next patch
$parts = $current.Split(".")
$suggested = if ($parts.Count -ge 3) { "$($parts[0]).$($parts[1]).$([int]$parts[2] + 1)" } else { "$current.1" }
if ($Version) {
  $newVersion = $Version.Trim()
} else {
  $input = Read-Host "  new version (Enter for $suggested)"
  $newVersion = if ([string]::IsNullOrWhiteSpace($input)) { $suggested } else { $input.Trim() }
}
if ($newVersion -notmatch '^\d+\.\d+\.\d+$') { Fail "invalid version format: $newVersion (expect x.y.z)" }

$pkg.version = $newVersion
# Write without BOM: Set-Content -Encoding UTF8 (PS5) adds a BOM that breaks
# electron-builder's JSON parser.
$pkgJson = $pkg | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($pkgPath, $pkgJson, (New-Object System.Text.UTF8Encoding($false)))

# commit the version bump (skipped with -SkipGitCheck: only touch package.json)
if ($SkipGitCheck) {
  Write-Host "  version file bumped to $newVersion (git steps skipped)" -ForegroundColor Green
} else {
  & $git -C $root add package.json 2>&1 | Out-Null
  & $git -C $root -c user.name="timefeishi" -c user.email="timefeishi@users.noreply.github.com" commit -m "release v$newVersion" 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
  if ($LASTEXITCODE -ne 0) { Fail "failed to commit version bump" }
  & $git -C $root push origin master 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
  if ($LASTEXITCODE -ne 0) { Fail "git push failed (network?)" }
  Write-Host "  version bumped to $newVersion and pushed" -ForegroundColor Green
}

# ── 3. build & publish ────────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/4] Building installer..." -ForegroundColor Yellow

if (-not $env:GH_TOKEN) {
  Write-Host "  GH_TOKEN is not set. Set it before running:" -ForegroundColor Yellow
  Write-Host "    `$env:GH_TOKEN = `"your-token`"" -ForegroundColor Yellow
  Fail "GH_TOKEN required for publishing"
}

& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "publish.ps1") -Publish
if ($LASTEXITCODE -ne 0) { Fail "publish.ps1 failed" }

# ── 4. done ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[4/4] Release v$newVersion published!" -ForegroundColor Green
Write-Host "  https://github.com/timefeishi/dsh/releases" -ForegroundColor Green
Write-Host ""
