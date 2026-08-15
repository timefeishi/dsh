# Build and publish a release. Keeps disk usage bounded:
# - always writes to the SAME output directory (release-upd)
# - removes the previous win-unpacked and installer from that directory first
# - optionally uploads to GitHub Releases (needs $env:GH_TOKEN)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\publish.ps1            # build only
#   $env:GH_TOKEN = "..." ; powershell -ExecutionPolicy Bypass -File scripts\publish.ps1 -Publish

param(
  [switch]$Publish
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot   # dsh-desktop/
$out  = Join-Path $root "release-upd"

$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

Write-Host "==> Preparing bundled runtime (resources\dsh-runtime)" -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "prepare-runtime.ps1")

Write-Host "==> Cleaning previous build in $out" -ForegroundColor Cyan
if (Test-Path $out) { Remove-Item $out -Recurse -Force }

Write-Host "==> Building NSIS installer" -ForegroundColor Cyan
Push-Location $root
try {
  if ($Publish) {
    if (-not $env:GH_TOKEN) { throw "Publish requested but GH_TOKEN is not set" }
    & "node_modules\.bin\electron-builder.cmd" --win nsis -c.directories.output=release-upd --publish always
  } else {
    & "node_modules\.bin\electron-builder.cmd" --win nsis -c.directories.output=release-upd
  }
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Done. Artifacts:" -ForegroundColor Green
Get-ChildItem $out -File | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize
if ($Publish) { Write-Host "Published to GitHub Releases (timefeishi/dsh)" -ForegroundColor Green }
