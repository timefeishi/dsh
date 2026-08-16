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

# Run git and return { Code, Output }. Never lets git's stderr (which git uses
# for normal progress, e.g. "To https://...") become a PowerShell terminating
# error under $ErrorActionPreference = "Stop"; success is judged only by the
# process exit code.
function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
  $oldEA = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out = & $git @GitArgs 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $oldEA
  return [pscustomobject]@{ Code = $code; Output = $out }
}

# Show git output lines (ErrorRecords from stderr render as their text).
function Show-GitOutput($result) {
  foreach ($line in @($result.Output)) {
    Write-Host "  $line" -ForegroundColor DarkGray
  }
}

# Last non-empty stdout line as a string. git printing a single line makes
# the filtered result a bare [string] (not an array), so [-1] would index
# characters — Select-Object -Last 1 handles both shapes.
function Get-GitLastLine($result) {
  $lines = @($result.Output) | Where-Object { $_ -is [string] -and $_.Trim().Length -gt 0 }
  if (-not $lines) { return "" }
  return ($lines | Select-Object -Last 1).ToString().Trim()
}

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
  $branch = Get-GitLastLine (Invoke-Git -C $root rev-parse --abbrev-ref HEAD)
  if ($branch -ne "master") { Fail "current branch is '$branch', expected 'master'" }

  # fetch latest remote state
  Write-Host "  fetching origin..." -ForegroundColor DarkGray
  $r = Invoke-Git -C $root fetch origin
  Show-GitOutput $r
  if ($r.Code -ne 0) { Fail "git fetch failed (network?)" }

  # working tree must be clean
  $dirty = @((Invoke-Git -C $root status --porcelain).Output) | Where-Object { $_ -is [string] -and $_.Trim().Length -gt 0 }
  if ($dirty) {
    Write-Host "  working tree is NOT clean:" -ForegroundColor Red
    $dirty | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Fail "commit or stash your changes first"
  }

  # local must equal origin/master
  $local  = Get-GitLastLine (Invoke-Git -C $root rev-parse HEAD)
  $remote = Get-GitLastLine (Invoke-Git -C $root rev-parse origin/master)
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
  Invoke-Git -C $root add package.json | Out-Null
  $r = Invoke-Git -C $root -c user.name="timefeishi" -c user.email="timefeishi@users.noreply.github.com" commit -m "release v$newVersion"
  Show-GitOutput $r
  if ($r.Code -ne 0) { Fail "failed to commit version bump" }

  $r = Invoke-Git -C $root push origin master
  Show-GitOutput $r
  if ($r.Code -ne 0) { Fail "git push failed (network?)" }
  Write-Host "  version bumped to $newVersion and pushed" -ForegroundColor Green
}

# ── 3. build & publish ────────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/4] Building installer..." -ForegroundColor Yellow

# GH_TOKEN resolution: environment variable first, then a local git-ignored
# token file (scripts/gh-token.txt) so double-clicking 发布新版.bat works
# without setting env vars every time.
$tokenFile = Join-Path $PSScriptRoot "gh-token.txt"
if (-not $env:GH_TOKEN -and (Test-Path $tokenFile)) {
  $env:GH_TOKEN = (Get-Content $tokenFile -Raw).Trim()
}
if (-not $env:GH_TOKEN) {
  Write-Host "  GH_TOKEN is not set. Either:" -ForegroundColor Yellow
  Write-Host "    1. Set it in this session:   `$env:GH_TOKEN = `"your-token`"" -ForegroundColor Yellow
  Write-Host "    2. Or save it once to:       scripts\gh-token.txt   (git-ignored, reused every time)" -ForegroundColor Yellow
  Fail "GH_TOKEN required for publishing"
}

# publish.ps1 must run with the project dir as cwd (it invokes
# node_modules\.bin\electron-builder.cmd, which resolves package.json from cwd).
Push-Location $root
try {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "publish.ps1") -Publish
  if ($LASTEXITCODE -ne 0) { Fail "publish.ps1 failed" }
} finally {
  Pop-Location
}

# ── 4. done ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[4/4] Release v$newVersion published!" -ForegroundColor Green
Write-Host "  https://github.com/timefeishi/dsh/releases" -ForegroundColor Green
Write-Host ""
