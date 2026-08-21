# adb_copy_tool.ps1 - file / phone-video transfer tool with GUI
# Local paths -> local copy with progress bar; /sdcard paths -> adb pull mode
# Runs the transfer synchronously on the UI thread with Application.DoEvents()
# to keep the window responsive (background threads are unreliable in PS 5.1 hosts).
param(
  [switch]$TestMode,
  [switch]$SmokeTest,
  [switch]$GuiTest,
  [string]$Source = '',
  [string]$Dest = '',
  [string]$AdbPath = ''
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-AdbPath {
  $cands = New-Object System.Collections.ArrayList
  if ($PSScriptRoot) {
    [void]$cands.Add((Join-Path $PSScriptRoot '.adb_tools\platform-tools\adb.exe'))
    [void]$cands.Add((Join-Path $PSScriptRoot 'platform-tools\adb.exe'))
  }
  [void]$cands.Add((Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'))
  [void]$cands.Add((Join-Path $env:USERPROFILE '.android\platform-tools\adb.exe'))
  foreach ($c in $cands) { if ($c -and (Test-Path $c)) { return $c } }
  $cmd = Get-Command adb -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return ''
}

function Get-RemoteFileList([string]$adbPath, [string]$remoteDir) {
  $raw = @(& $adbPath shell ('ls -l ' + "'" + $remoteDir + "'"))
  $list = New-Object System.Collections.ArrayList
  foreach ($line in $raw) {
    if ($line -match '^-\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$') {
      $sz = [uint64]$matches[1]
      $name = $matches[2].Trim()
      if ($name) { [void]$list.Add([pscustomobject]@{ Name = $name; Size = $sz }) }
    }
  }
  return ,$list
}

function Test-AdbDevice([string]$adbPath) {
  $out = @(& $adbPath devices)
  foreach ($line in $out) {
    if ($line -match '\tdevice$') { return $true }
  }
  return $false
}

function Copy-Local([string]$src, [string]$dst, [scriptblock]$report, [scriptblock]$shouldStop) {
  $src = $src.TrimEnd('\')
  $files = @(Get-ChildItem -Path $src -Recurse -File -ErrorAction SilentlyContinue)
  if ($files.Count -eq 0) { return @{ Copied = 0; Skipped = 0; Failed = 0; TotalBytes = 0 } }
  $total = [long]0
  foreach ($f in $files) { $total += $f.Length }
  $copiedBytes = [long]0
  $copied = 0; $skipped = 0; $failed = 0
  $lastPct = -1
  foreach ($f in $files) {
    if (& $shouldStop) { return $null }
    $rel = $f.FullName.Substring($src.Length).TrimStart('\')
    $dest = Join-Path $dst $rel
    $destDir = Split-Path $dest -Parent
    if ($destDir -and -not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    $size = $f.Length
    & $report -1 ('处理: ' + $rel)
    if (Test-Path $dest) {
      if ((Get-Item $dest -ErrorAction SilentlyContinue).Length -eq $size) { $skipped++; continue }
      Remove-Item $dest -Force
    }
    $ok = $false
    try {
      $in = [System.IO.File]::OpenRead($f.FullName)
      $out = [System.IO.File]::Create($dest)
      $buf = New-Object byte[] (4 * 1024 * 1024)
      $cancelled = $false
      try {
        while ($true) {
          $n = $in.Read($buf, 0, $buf.Length)
          if ($n -le 0) { break }
          $out.Write($buf, 0, $n)
          $copiedBytes += $n
          if ($total -gt 0) {
            $pct = [int](100 * $copiedBytes / $total)
            if ($pct -ne $lastPct) { $lastPct = $pct; & $report $pct ('复制中: ' + $rel) }
          }
          if (& $shouldStop) { $cancelled = $true; break }
        }
      } finally {
        $in.Close(); $out.Close()
      }
      if ($cancelled) { Remove-Item $dest -Force -ErrorAction SilentlyContinue; return $null }
      if ((Get-Item $dest).Length -eq $size) { $ok = $true } else { Remove-Item $dest -Force -ErrorAction SilentlyContinue }
    } catch {
      $failed++
      & $report -1 ('失败: ' + $rel + ' -> ' + $_.Exception.Message)
    }
    if ($ok) { $copied++ }
  }
  return @{ Copied = $copied; Skipped = $skipped; Failed = $failed; TotalBytes = $total }
}

function Copy-Remote([string]$adbPath, [string]$src, [string]$dst, [scriptblock]$report, [scriptblock]$shouldStop) {
  if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }
  $list = @(Get-RemoteFileList $adbPath $src)
  if ($list.Count -eq 0) { return @{ Copied = 0; Skipped = 0; Failed = 0; TotalBytes = 0 } }
  $total = [long]0
  foreach ($it in $list) { $total += $it.Size }
  $copiedBytes = [long]0
  $copied = 0; $skipped = 0; $failed = 0
  $lastPct = -1
  $i = 0
  foreach ($item in $list) {
    $i++
    if (& $shouldStop) { return $null }
    & $report -1 (('处理 [{0}/{1}]: ' + $item.Name) -f $i, $list.Count)
    $dest = Join-Path $dst $item.Name
    if (Test-Path $dest) {
      if ((Get-Item $dest -ErrorAction SilentlyContinue).Length -eq $item.Size) { $skipped++; continue }
      Remove-Item $dest -Force
    }
    $ok = $false
    try {
      & $adbPath pull ($src + '/' + $item.Name) $dest 2>&1 | Out-Null
      if (Test-Path $dest) {
        if ((Get-Item $dest).Length -eq $item.Size) {
          $ok = $true
        } else {
          Remove-Item $dest -Force -ErrorAction SilentlyContinue
        }
      }
    } catch {
      $failed++
      & $report -1 ('失败: ' + $item.Name + ' -> ' + $_.Exception.Message)
    }
    if ($ok) {
      $copied++
      $copiedBytes += $item.Size
      if ($total -gt 0) {
        $pct = [int](100 * $copiedBytes / $total)
        if ($pct -ne $lastPct) { $lastPct = $pct; & $report $pct ('完成: ' + $item.Name) }
      }
    } else {
      $failed++
    }
  }
  return @{ Copied = $copied; Skipped = $skipped; Failed = $failed; TotalBytes = $total }
}

function Test-CopyResult([string]$src, [string]$dst, [string]$adbPath) {
  try {
    $expCount = 0; $expBytes = [long]0
    if ($src.StartsWith('/')) {
      $list = @(Get-RemoteFileList $adbPath $src)
      $expCount = $list.Count
      foreach ($it in $list) { $expBytes += $it.Size }
    } else {
      $sf = @(Get-ChildItem $src -Recurse -File -ErrorAction SilentlyContinue)
      $expCount = $sf.Count
      foreach ($f in $sf) { $expBytes += $f.Length }
    }
    $df = @(Get-ChildItem $dst -Recurse -File -ErrorAction SilentlyContinue)
    $actCount = $df.Count
    $actBytes = [long]0
    foreach ($f in $df) { $actBytes += $f.Length }
    $ok = ($expCount -eq $actCount) -and ($expBytes -eq $actBytes)
    $msg = ('期望 {0} 个文件 / {1:N1} MB，目标实际 {2} 个文件 / {3:N1} MB' -f $expCount, ($expBytes / 1MB), $actCount, ($actBytes / 1MB))
    return [pscustomobject]@{ Ok = $ok; Msg = $msg }
  } catch {
    return [pscustomobject]@{ Ok = $false; Msg = ('校验出错: ' + $_.Exception.Message) }
  }
}

# ================= GUI =================
function New-MainForm {
  $script:form = New-Object System.Windows.Forms.Form
  $script:form.Text = '文件 / 手机视频传输工具'
  $script:form.Size = New-Object System.Drawing.Size(640, 580)
  $script:form.StartPosition = 'CenterScreen'
  $script:form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
  $script:form.MinimumSize = New-Object System.Drawing.Size(620, 520)

  $script:btnSrc = New-Object System.Windows.Forms.Button
  $script:btnDst = New-Object System.Windows.Forms.Button
  $script:btnAdb = New-Object System.Windows.Forms.Button

  $lblSrc = New-Object System.Windows.Forms.Label
  $lblSrc.Text = '源文件夹:'
  $lblSrc.Location = New-Object System.Drawing.Point(14, 22)
  $lblSrc.Size = New-Object System.Drawing.Size(88, 22)
  $script:form.Controls.Add($lblSrc)

  $script:txtSrc = New-Object System.Windows.Forms.TextBox
  $script:txtSrc.Location = New-Object System.Drawing.Point(104, 19)
  $script:txtSrc.Size = New-Object System.Drawing.Size(390, 24)
  $script:form.Controls.Add($script:txtSrc)

  $script:btnSrc.Text = '选择...'
  $script:btnSrc.Location = New-Object System.Drawing.Point(500, 18)
  $script:btnSrc.Size = New-Object System.Drawing.Size(112, 26)
  $script:btnSrc.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = '选择源文件夹（手机路径请直接填写 /sdcard/...）'
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $script:txtSrc.Text = $dlg.SelectedPath }
  })
  $script:form.Controls.Add($script:btnSrc)

  $lblDst = New-Object System.Windows.Forms.Label
  $lblDst.Text = '目标文件夹:'
  $lblDst.Location = New-Object System.Drawing.Point(14, 58)
  $lblDst.Size = New-Object System.Drawing.Size(88, 22)
  $script:form.Controls.Add($lblDst)

  $script:txtDst = New-Object System.Windows.Forms.TextBox
  $script:txtDst.Location = New-Object System.Drawing.Point(104, 55)
  $script:txtDst.Size = New-Object System.Drawing.Size(390, 24)
  $script:form.Controls.Add($script:txtDst)

  $script:btnDst.Text = '选择...'
  $script:btnDst.Location = New-Object System.Drawing.Point(500, 54)
  $script:btnDst.Size = New-Object System.Drawing.Size(112, 26)
  $script:btnDst.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = '选择目标文件夹'
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $script:txtDst.Text = $dlg.SelectedPath }
  })
  $script:form.Controls.Add($script:btnDst)

  $lblAdb = New-Object System.Windows.Forms.Label
  $lblAdb.Text = 'adb 路径:'
  $lblAdb.Location = New-Object System.Drawing.Point(14, 94)
  $lblAdb.Size = New-Object System.Drawing.Size(88, 22)
  $script:form.Controls.Add($lblAdb)

  $script:txtAdb = New-Object System.Windows.Forms.TextBox
  $script:txtAdb.Location = New-Object System.Drawing.Point(104, 91)
  $script:txtAdb.Size = New-Object System.Drawing.Size(390, 24)
  $script:txtAdb.Text = (Get-AdbPath)
  $script:form.Controls.Add($script:txtAdb)

  $script:btnAdb.Text = '自动检测'
  $script:btnAdb.Location = New-Object System.Drawing.Point(500, 90)
  $script:btnAdb.Size = New-Object System.Drawing.Size(112, 26)
  $script:btnAdb.Add_Click({
    $p = Get-AdbPath
    $script:txtAdb.Text = $p
    if ($p) {
      $script:lblStatus.Text = '已检测到 adb: ' + $p
      [void]$script:lstLog.Items.Add('自动检测: ' + $p)
    } else {
      $script:lblStatus.Text = '未找到 adb，请手动填写路径'
      [void]$script:lstLog.Items.Add('自动检测: 未找到 adb，请手动填写')
    }
  })
  $script:form.Controls.Add($script:btnAdb)

  $lblHint = New-Object System.Windows.Forms.Label
  $lblHint.Text = '提示：选择本地文件夹即可；手机路径填写 /sdcard/...（自动走 adb，需已连接并授权 USB 调试）'
  $lblHint.Location = New-Object System.Drawing.Point(14, 122)
  $lblHint.Size = New-Object System.Drawing.Size(598, 20)
  $lblHint.ForeColor = [System.Drawing.Color]::Gray
  $script:form.Controls.Add($lblHint)

  $script:btnStart = New-Object System.Windows.Forms.Button
  $script:btnStart.Text = '开始传输'
  $script:btnStart.Location = New-Object System.Drawing.Point(14, 150)
  $script:btnStart.Size = New-Object System.Drawing.Size(120, 34)
  $script:form.Controls.Add($script:btnStart)

  $script:btnCancel = New-Object System.Windows.Forms.Button
  $script:btnCancel.Text = '取消'
  $script:btnCancel.Location = New-Object System.Drawing.Point(142, 150)
  $script:btnCancel.Size = New-Object System.Drawing.Size(80, 34)
  $script:btnCancel.Enabled = $false
  $script:form.Controls.Add($script:btnCancel)

  $script:pb = New-Object System.Windows.Forms.ProgressBar
  $script:pb.Location = New-Object System.Drawing.Point(14, 196)
  $script:pb.Size = New-Object System.Drawing.Size(598, 24)
  $script:pb.Minimum = 0
  $script:pb.Maximum = 100
  $script:form.Controls.Add($script:pb)

  $script:lblStatus = New-Object System.Windows.Forms.Label
  $script:lblStatus.Text = '就绪'
  $script:lblStatus.Location = New-Object System.Drawing.Point(14, 226)
  $script:lblStatus.Size = New-Object System.Drawing.Size(598, 20)
  $script:form.Controls.Add($script:lblStatus)

  $lblLogTitle = New-Object System.Windows.Forms.Label
  $lblLogTitle.Text = '日志:'
  $lblLogTitle.Location = New-Object System.Drawing.Point(14, 252)
  $lblLogTitle.Size = New-Object System.Drawing.Size(80, 20)
  $script:form.Controls.Add($lblLogTitle)

  $script:lstLog = New-Object System.Windows.Forms.ListBox
  $script:lstLog.Location = New-Object System.Drawing.Point(14, 274)
  $script:lstLog.Size = New-Object System.Drawing.Size(598, 250)
  $script:lstLog.HorizontalScrollbar = $true
  $script:form.Controls.Add($script:lstLog)

  # progress callback for GUI: update controls directly + pump messages
  $script:GuiReport = {
    param($pct, $msg)
    $p = -1
    [void][int]::TryParse([string]$pct, [ref]$p)
    if ($p -ge 0) { $script:pb.Value = [Math]::Min(100, $p) }
    if ($msg) {
      $script:lblStatus.Text = $msg
      [void]$script:lstLog.Items.Add($msg)
      $script:lstLog.TopIndex = $script:lstLog.Items.Count - 1
    }
    [System.Windows.Forms.Application]::DoEvents()
  }

  $script:btnStart.Add_Click({
    try {
      $src = $script:txtSrc.Text.Trim()
      $dst = $script:txtDst.Text.Trim()
      $adb = $script:txtAdb.Text.Trim()
      if (-not $src) { [void][System.Windows.Forms.MessageBox]::Show('请选择源文件夹', '提示', 'OK', 'Warning'); return }
      if (-not $dst) { [void][System.Windows.Forms.MessageBox]::Show('请选择目标文件夹', '提示', 'OK', 'Warning'); return }
      if ($src -eq $dst) { [void][System.Windows.Forms.MessageBox]::Show('源和目标不能相同', '提示', 'OK', 'Warning'); return }
      if (-not $src.StartsWith('/') -and -not (Test-Path $src)) {
        [void][System.Windows.Forms.MessageBox]::Show('源文件夹不存在: ' + $src, '提示', 'OK', 'Warning'); return
      }
      $script:cancelRequested = $false
      $script:btnStart.Enabled = $false
      $script:btnCancel.Enabled = $true
      $script:txtSrc.Enabled = $false
      $script:txtDst.Enabled = $false
      $script:txtAdb.Enabled = $false
      $script:btnSrc.Enabled = $false
      $script:btnDst.Enabled = $false
      $script:btnAdb.Enabled = $false
      $script:pb.Value = 0
      $script:lblStatus.Text = '准备中...'
      $script:lstLog.Items.Clear()
      $stop = { $script:cancelRequested }
      $err = ''
      $result = $null
      try {
        if ($src.StartsWith('/')) {
          if (-not (Test-AdbDevice $adb)) {
            $err = '未检测到已授权的手机（adb devices 无 device）。请连接手机并开启 USB 调试后重试。'
          } else {
            $result = Copy-Remote $adb $src $dst $script:GuiReport $stop
          }
        } else {
          $result = Copy-Local $src $dst $script:GuiReport $stop
        }
      } catch {
        $err = $_.Exception.Message
      }
      # completion
      $script:btnStart.Enabled = $true
      $script:btnCancel.Enabled = $false
      $script:txtSrc.Enabled = $true
      $script:txtDst.Enabled = $true
      $script:txtAdb.Enabled = $true
      $script:btnSrc.Enabled = $true
      $script:btnDst.Enabled = $true
      $script:btnAdb.Enabled = $true
      if ($err) {
        $script:lblStatus.Text = '出错'
        [void]$script:lstLog.Items.Add('错误: ' + $err)
        if (-not $script:guiTest) { [void][System.Windows.Forms.MessageBox]::Show($err, '传输失败', 'OK', 'Error') }
      } elseif ($script:cancelRequested) {
        $script:lblStatus.Text = '已取消'
      } elseif ($null -eq $result) {
        $script:lblStatus.Text = '已取消'
      } else {
        $msg = ('完成：复制 {0} 个，跳过 {1} 个，失败 {2} 个，共 {3:N1} MB' -f $result.Copied, $result.Skipped, $result.Failed, ($result.TotalBytes / 1MB))
        $script:lblStatus.Text = $msg
        [void]$script:lstLog.Items.Add($msg)
        $v = Test-CopyResult $src $dst $adb
        [void]$script:lstLog.Items.Add(('校验: ' + $v.Msg + ' -> ' + $(if ($v.Ok) { '通过' } else { '不通过' })))
        if (-not $script:guiTest) {
          [void][System.Windows.Forms.MessageBox]::Show(($msg + "`n`n" + '校验: ' + $v.Msg + ' -> ' + $(if ($v.Ok) { '通过' } else { '不通过' })), '传输完成')
        }
      }
      if ($script:guiTest) { $script:form.Close() }
    } catch {
      $script:btnStart.Enabled = $true
      $script:btnCancel.Enabled = $false
      [void][System.Windows.Forms.MessageBox]::Show(('点击后发生错误: ' + $_.Exception.Message), '错误', 'OK', 'Error')
    }
  })

  $script:btnCancel.Add_Click({ $script:cancelRequested = $true })

  return $script:form
}

# ================= entry =================
if ($TestMode) {
  if (-not $Source -or -not $Dest) { Write-Output 'TestMode 需要 -Source 和 -Dest 参数'; exit 1 }
  $adbPath = if ($AdbPath) { $AdbPath } else { Get-AdbPath }
  $report = {
    param($pct, $msg)
    $tag = if ($pct -ge 0) { ($pct.ToString() + '%') } else { '--' }
    Write-Host ('[' + $tag + '] ' + $msg)
  }
  $stop = { $false }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  if ($Source.StartsWith('/')) {
    if (-not (Test-AdbDevice $adbPath)) { Write-Output '未检测到已授权的手机，请连接并授权 USB 调试'; exit 1 }
    $r = Copy-Remote $adbPath $Source $Dest $report $stop
  } else {
    $r = Copy-Local $Source $Dest $report $stop
  }
  $sw.Stop()
  if ($null -eq $r) { Write-Output '已取消或异常'; exit 1 }
  Write-Output ('结果: 复制 {0}, 跳过 {1}, 失败 {2}, 总字节 {3}, 用时 {4}' -f $r.Copied, $r.Skipped, $r.Failed, $r.TotalBytes, $sw.Elapsed.ToString('hh\:mm\:ss'))
  $v = Test-CopyResult $Source $Dest $adbPath
  Write-Output ('校验: ' + $v.Msg + ' -> ' + $(if ($v.Ok) { '通过' } else { '不通过' }))
  exit 0
}

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Threading.SynchronizationContext]::SetSynchronizationContext((New-Object System.Windows.Forms.WindowsFormsSynchronizationContext))
if ($GuiTest) {
  $script:guiTest = $true
  if (-not $Source -or -not $Dest) { Write-Output 'GuiTest 需要 -Source 和 -Dest 参数'; exit 1 }
  $f = New-MainForm
  $script:txtSrc.Text = $Source
  $script:txtDst.Text = $Dest
  $f.Add_Shown({ $script:btnStart.PerformClick() })
  [System.Windows.Forms.Application]::Run($f)
  Write-Output ('status: ' + $script:lblStatus.Text)
  Write-Output 'log:'
  foreach ($item in $script:lstLog.Items) { Write-Output ('  ' + $item) }
  exit 0
}
if ($SmokeTest) {
  $f = New-MainForm
  try {
    $script:btnAdb.PerformClick()
    $adbResult = $script:txtAdb.Text
  } catch {
    $adbResult = 'CLICK_ERROR: ' + $_.Exception.Message
  }
  $f.Add_Shown({ $f.Close() })
  [void]$f.ShowDialog()
  Write-Output ('GUI_SMOKE_OK adb=[' + $adbResult + ']')
  exit 0
}
$mainForm = New-MainForm
[void]$mainForm.ShowDialog()
