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
#
# The dsh-usage-cost plugin is baked INTO the runtime (see below), so every
# device that installs the app gets it, and it survives runtime re-extraction
# because it is re-baked on every build. Override the plugin location with
# -PluginSource <path> when the layout differs.

param([string]$PluginSource = "")

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

# 3.5 bake the dsh-usage-cost plugin into the runtime (ships with the app).
# Copies only the runtime-relevant files (package.json + lib + client.js);
# the loader resolves the package from the profile's node_modules junction,
# and main.js ensures that wiring idempotently at launch.
Write-Host "==> Baking dsh-usage-cost plugin" -ForegroundColor Cyan
if ([string]::IsNullOrWhiteSpace($PluginSource)) {
  $PluginSource = Join-Path $root "dsh-usage-cost"      # in-repo plugin source (repo root)
}
if (-not (Test-Path $PluginSource)) { throw "plugin source not found: $PluginSource (pass -PluginSource <path>)" }
$pluginDst = Join-Path $dst "node_modules\dsh-usage-cost"
New-Item -ItemType Directory -Force -Path $pluginDst | Out-Null
foreach ($item in @("package.json", "client.js", "lib")) {
  $src = Join-Path $PluginSource $item
  if (-not (Test-Path $src)) { throw "plugin missing required file: $src" }
  Copy-Item $src (Join-Path $pluginDst $item) -Recurse -Force
}
Write-Host "   baked plugin -> $pluginDst"

# Patch the api-proxy settings whitelist inside the baked runtime so the
# browser can read/edit the usage-cost namespace (same patch install.ps1
# applies to a live runtime). Idempotent.
$apiproxy = Join-Path $dst "node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js"
if (Test-Path $apiproxy) {
  $raw = Get-Content $apiproxy -Raw
  if ($raw -notmatch '"usage-cost"') {
    $patched = [regex]::Replace(
      $raw,
      '"web-search-deepseek"(\r?\n)[ \t]*\]',
      { param($m)
        '"web-search-deepseek",' + $m.Groups[1].Value + "`t`"usage-cost`"" + $m.Groups[1].Value + "]"
      })
    if ($patched -eq $raw) { throw "could not locate WEB_SETTINGS_NAMESPACES tail to patch in $apiproxy" }
    Set-Content -Path $apiproxy -Value $patched -Encoding UTF8 -NoNewline
    Write-Host "   patched apiproxy whitelist (usage-cost)"
  } else {
    Write-Host "   apiproxy whitelist already patched"
  }
} else {
  Write-Host "   WARN: apiproxy lib not found, whitelist NOT patched: $apiproxy"
}

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
