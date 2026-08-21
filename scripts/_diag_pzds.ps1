$ErrorActionPreference = "Continue"
$pkg = "C:\Users\16667\.dsh\profiles\node_modules\dsh-pzds-tool"
Write-Host "== dsh-pzds-tool: exists=$(Test-Path $pkg)"
if (Test-Path $pkg) {
  $it = Get-Item $pkg
  Write-Host ("Attributes: {0}   LinkType: {1}   Target: {2}" -f $it.Attributes, $it.LinkType, ($it.Target -join ','))
  $pj = Join-Path $pkg "package.json"
  Write-Host "package.json at $pkg : $(Test-Path $pj)"
  if (Test-Path $pj) { Write-Host ("  name field: " + (Get-Content $pj -Raw | ConvertFrom-Json).name) }
  Write-Host "  child entries: $((Get-ChildItem $pkg -ErrorAction SilentlyContinue | Select-Object -First 6 | ForEach-Object Name) -join ', ')"
} else { Write-Host "  NOT PRESENT" }

Write-Host ""
Write-Host "== dsh-usage-cost (for comparison):"
$uc = "C:\Users\16667\.dsh\profiles\node_modules\dsh-usage-cost"
$it2 = Get-Item $uc
Write-Host ("exists=$(Test-Path $uc)  LinkType={0}  Target={1}" -f $it2.LinkType, ($it2.Target -join ','))

Write-Host ""
Write-Host "== profiles\node_modules\dsh-pzds-tool realpath resolution test:"
Write-Host "  (node --input-type=module resolve check will be done in node step)"

Write-Host ""
Write-Host "== cordis.patch.yml content (web):"
Get-Content "C:\Users\16667\.dsh\profiles\web\cordis.patch.yml" -Raw | Write-Host
Write-Host "== web\package.json:"
Get-Content "C:\Users\16667\.dsh\profiles\web\package.json" -Raw | Write-Host

Write-Host ""
Write-Host "== settings.yaml (pzds lines + siblings):"
Get-Content "C:\Users\16667\.dsh\settings.yaml" | Select-Object -Skip 20 -First 25