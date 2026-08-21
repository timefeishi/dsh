# install.ps1 - dsh-adb-copy-tool installer
# Creates a desktop shortcut and runs a self-check.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bat = Join-Path $root 'adb_copy_tool.bat'
$script = Join-Path $root 'adb_copy_tool.ps1'

Write-Host 'dsh-adb-copy-tool 安装 / 自检'

if (-not (Test-Path $bat)) { Write-Host ('未找到 ' + $bat); exit 1 }

Write-Host '运行面板冒烟自检...'
& powershell -NoProfile -ExecutionPolicy Bypass -File $script -SmokeTest

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'adb 文件传输工具.lnk'
try {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = $bat
  $lnk.WorkingDirectory = $root
  $lnk.Description = 'adb 文件 / 手机视频传输工具'
  $lnk.Save()
  Write-Host ('已创建桌面快捷方式: ' + $lnkPath)
} catch {
  Write-Host ('创建快捷方式失败（不影响使用，可直接双击工具文件夹里的 adb_copy_tool.bat）: ' + $_.Exception.Message)
}

Write-Host '安装完成。'
