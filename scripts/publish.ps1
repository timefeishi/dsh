# Build and publish a release. Keeps disk usage bounded:
# - always writes to the SAME output directory (release-upd)
# - removes the previous win-unpacked and installer from that directory first
# - detects and (with confirmation) removes stale historical release dirs
# - optionally uploads to GitHub Releases (needs $env:GH_TOKEN)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\publish.ps1            # build only
#   $env:GH_TOKEN = "..." ; powershell -ExecutionPolicy Bypass -File scripts\publish.ps1 -Publish
#   powershell -ExecutionPolicy Bypass -File scripts\publish.ps1 -CleanAll  # skip build, only clean stale dirs

param(
  [switch]$Publish,
  [switch]$CleanAll,
  [string]$ReleaseNotesFile
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot   # dsh-desktop/
$out  = Join-Path $root "release-upd"

$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

# ── stale release dir cleanup ─────────────────────────────────────────────
# Historical output dirs (release, release-*, release-upd-*) can pile up
# ~750MB each. Keep only the canonical $out; offer to delete the rest.
function Get-StaleReleaseDirs {
  Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^release' -and $_.FullName -ne $out }
}

function Remove-StaleReleaseDirs {
  $stale = @(Get-StaleReleaseDirs)
  if ($stale.Count -eq 0) {
    Write-Host "No stale release directories found." -ForegroundColor Green
    return
  }
  $totalMB = [math]::Round((($stale | ForEach-Object {
    (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  } | Measure-Object -Sum).Sum) / 1MB, 0)

  Write-Host ""
  Write-Host "Found $($stale.Count) stale release directorie(s), ~$totalMB MB:" -ForegroundColor Yellow
  $stale | ForEach-Object { Write-Host "  - $($_.FullName)" -ForegroundColor Yellow }

  if ($CleanAll) { $answer = "y" }
  else {
    $answer = Read-Host "Delete them? [y/N]"
  }
  if ($answer -match '^[yY]') {
    foreach ($d in $stale) { Remove-Item $d.FullName -Recurse -Force; Write-Host "deleted $($d.FullName)" -ForegroundColor DarkGray }
  } else {
    Write-Host "Skipped. (Run with -CleanAll to delete without prompting)" -ForegroundColor DarkGray
  }
}

if ($CleanAll) {
  Remove-StaleReleaseDirs
  Write-Host "Done." -ForegroundColor Green
  exit 0
}

Remove-StaleReleaseDirs

# ── running-app guard ─────────────────────────────────────────────────────
# The build deletes $out (including win-unpacked) wholesale; a running app
# from there locks exe/dll files and makes the deletion fail. Detect and stop.
function Get-RunningAppProcesses {
  $outExe = Join-Path $out "win-unpacked\DeepSeek Harness.exe"
  if (-not (Test-Path $outExe)) { return @() }
  @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $outExe })
}

$running = Get-RunningAppProcesses
if ($running.Count -gt 0) {
  Write-Host ""
  Write-Host "The app is currently running from $out (win-unpacked)." -ForegroundColor Yellow
  Write-Host "The build deletes this folder, so it must be closed first." -ForegroundColor Yellow
  $answer = Read-Host "Close it now? [y/N]"
  if ($answer -match '^[yY]') {
    $running | Stop-Process -Force
    Write-Host "Closed $($running.Count) process(es)." -ForegroundColor DarkGray
    Start-Sleep -Seconds 2
  } else {
    Write-Host "Aborted. Please close the app and re-run." -ForegroundColor Red
    exit 1
  }
}

Write-Host "==> Preparing bundled runtime (resources\dsh-runtime)" -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "prepare-runtime.ps1")
if ($LASTEXITCODE -ne 0) { throw "prepare-runtime.ps1 failed with exit code $LASTEXITCODE (see error above)" }

Write-Host "==> Cleaning previous build in $out" -ForegroundColor Cyan
if (Test-Path $out) {
  try {
    Remove-Item $out -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Host ""
    Write-Host "Could not clean $out: some process is holding a folder inside it." -ForegroundColor Yellow
    Write-Host "This is usually an open terminal/editor whose working directory is inside" -ForegroundColor Yellow
    Write-Host "release-upd (e.g. release-upd\win-unpacked), or a still-running app from there." -ForegroundColor Yellow
    Write-Host "Close it, then re-run. If you cannot find it, reboot and re-run." -ForegroundColor Yellow
    Write-Host ""
    throw
  }
}

Write-Host "==> Building NSIS installer" -ForegroundColor Cyan
Push-Location $root
try {
  if ($Publish) {
    if (-not $env:GH_TOKEN) { throw "Publish requested but GH_TOKEN is not set" }
    # Build the electron-builder command line as one string and run via cmd,
    # which does not do PowerShell parameter parsing (avoids -c.* being
    # misread as PS switches).
    $cmdLine = "node_modules\.bin\electron-builder.cmd --win nsis -c.directories.output=release-upd --publish always"
    if ($ReleaseNotesFile) {
      if (-not (Test-Path $ReleaseNotesFile)) { throw "release notes file not found: $ReleaseNotesFile" }
      $cmdLine += " --config.releaseInfo.releaseNotesFile=`"$ReleaseNotesFile`""
      Write-Host "  release notes: $ReleaseNotesFile" -ForegroundColor DarkGray
    }
    cmd /c $cmdLine
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with exit code $LASTEXITCODE" }
  } else {
    cmd /c "node_modules\.bin\electron-builder.cmd --win nsis -c.directories.output=release-upd"
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with exit code $LASTEXITCODE" }
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Done. Artifacts:" -ForegroundColor Green
Get-ChildItem $out -File | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize
if ($Publish) { Write-Host "Published to GitHub Releases (timefeishi/dsh)" -ForegroundColor Green }
