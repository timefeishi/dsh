# Regenerate resources\dsh-runtime (node.exe + dsh dependency closure),
# trim it to win32-x64-only, then pack it into a single tar.gz + content hash.
#
# dsh-runtime is git-ignored and rebuilt from the local npx cache, so a
# machine that clones the repo just needs node/npm + this script.
#
#   powershell -ExecutionPolicy Bypass -File scripts\prepare-runtime.ps1
#
# Outputs:
#   resources\dsh-runtime\            untrimmed working tree (dev use)
#   resources\dsh-runtime.tar.gz      trimmed, packed (shipped in the installer)
#   resources\dsh-runtime.sha256      content hash of the tar.gz (sync key)
#
# The sha256 is the "dependency fingerprint": whenever any dependency changes
# (add/remove/upgrade), the tar.gz bytes change and the hash changes, so an
# installed app re-extracts its runtime on next launch — no version bookkeeping.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot   # dsh-desktop/
$dst  = Join-Path $root "resources\dsh-runtime"
$node = (Get-Command node -ErrorAction Stop).Source

Write-Host "==> Preparing $dst" -ForegroundColor Cyan

# 1. node.exe
New-Item -ItemType Directory -Force -Path (Join-Path $dst "node_modules") | Out-Null
Copy-Item $node (Join-Path $dst "node.exe") -Force
Write-Host "   copied node.exe ($node)"

# 2. dsh dependency closure from the npx cache
$npxRoot = Join-Path $env:LOCALAPPDATA "npm-cache\_npx"
$dshBin = Get-ChildItem (Join-Path $npxRoot "*\node_modules\@deepseek-ai\dsh\lib\bin.js") -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $dshBin) { throw "No @deepseek-ai/dsh found under $npxRoot. Run: npx --yes @deepseek-ai/dsh --version" }

# bin.js -> lib(1) -> dsh(2) -> @deepseek-ai(3) -> node_modules
$srcNodeModules = $dshBin.Directory.Parent.Parent.Parent.FullName
if (-not (Test-Path (Join-Path $srcNodeModules "@deepseek-ai\dsh\package.json"))) {
  throw "Unexpected npx cache layout: $srcNodeModules"
}
Write-Host "   copying dependency tree from $srcNodeModules"
robocopy $srcNodeModules (Join-Path $dst "node_modules") /E /MT:16 /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

# 3. trim to win32-x64-only (removes cross-platform binaries, sources, tests)
Write-Host "==> Trimming runtime" -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "trim-runtime.ps1")
if ($LASTEXITCODE -ne 0) { throw "trim-runtime.ps1 failed" }

# 4. pack trimmed runtime into a single tar.gz
Write-Host "==> Packing runtime" -ForegroundColor Cyan
$tar = Join-Path $env:WINDIR "System32\tar.exe"
if (-not (Test-Path $tar)) { throw "tar.exe not found at $tar" }
$gz  = Join-Path $root "resources\dsh-runtime.tar.gz"
$sha = Join-Path $root "resources\dsh-runtime.sha256"
if (Test-Path $gz) { Remove-Item $gz -Force }

# tar must run from the resources dir with a relative path so the archive
# contains "dsh-runtime/..." (deterministic layout).
Push-Location (Join-Path $root "resources")
try {
  & $tar -czf $gz dsh-runtime
  if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

# 5. content hash — the sync fingerprint for installed apps
$hash = (Get-FileHash $gz -Algorithm SHA256).Hash.ToLower()
[System.IO.File]::WriteAllText($sha, $hash + [Environment]::NewLine)

$size = [math]::Round(((Get-ChildItem $dst -Recurse -File | Measure-Object Length -Sum).Sum)/1MB, 0)
$gzMB = [math]::Round((Get-Item $gz).Length/1MB, 1)
Write-Host "==> dsh-runtime ready: tree $size MB, packed $gzMB MB" -ForegroundColor Green
Write-Host "    sha256: $hash" -ForegroundColor DarkGray
