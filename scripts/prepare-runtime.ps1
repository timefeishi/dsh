# Regenerate resources\dsh-runtime (node.exe + dsh dependency closure).
#
# dsh-runtime is git-ignored (~335MB) and rebuilt from the local npx cache,
# so a machine that clones the repo just needs node/npm + this script.
#
#   powershell -ExecutionPolicy Bypass -File scripts\prepare-runtime.ps1
#
# The script copies:
#   1. node.exe from the active Node installation
#   2. the newest @deepseek-ai/dsh package closure under the npx cache
#      (C:\Users\<user>\AppData\Local\npm-cache\_npx\<hash>\node_modules)
#
# If the npx cache is missing, run: npx --yes @deepseek-ai/dsh --version

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

$srcNodeModules = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $dshBin.FullName))
Write-Host "   copying dependency tree from $srcNodeModules"
robocopy $srcNodeModules (Join-Path $dst "node_modules") /E /MT:16 /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

$size = [math]::Round(((Get-ChildItem $dst -Recurse -File | Measure-Object Length -Sum).Sum)/1MB, 0)
Write-Host "==> dsh-runtime ready ($size MB)" -ForegroundColor Green
