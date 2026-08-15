' 启动 DeepSeek Harness（无控制台窗口启动器）
' 双击本文件即可：自动启动 dsh web 服务并打开嵌入式窗口。
' 关闭窗口后服务自动停止。

Option Explicit
Dim shell, appDir, electronExe
Set shell = CreateObject("WScript.Shell")
appDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
electronExe = appDir & "\node_modules\electron\dist\electron.exe"

If Not CreateObject("Scripting.FileSystemObject").FileExists(electronExe) Then
  MsgBox "未找到 Electron，请先在 " & appDir & " 目录运行：npm install", vbCritical, "DeepSeek Harness"
  WScript.Quit 1
End If

shell.CurrentDirectory = appDir
' Run 不带窗口等待：electron 主进程退出后本脚本结束
shell.Run """" & electronExe & """ """ & appDir & """", 1, True
