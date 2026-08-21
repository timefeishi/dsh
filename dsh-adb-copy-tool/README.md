# dsh-adb-copy-tool — 文件 / 手机视频传输工具

带面板的传输工具：本地文件夹复制 或 手机(adb)视频拉取，带进度条、逐文件日志、完成自动校验。

## 文件结构

| 文件 | 说明 |
|---|---|
| `adb_copy_tool.ps1` | 主程序（WinForms 面板） |
| `adb_copy_tool.bat` | 启动器（**双击运行**） |
| `.adb_tools\` | 内置 adb（Google 官方 platform-tools 37.0.1） |
| `install.ps1` | 安装脚本：创建桌面快捷方式 + 运行自检 |
| `README.md` | 本说明 |

## 使用方法

1. 双击 `adb_copy_tool.bat` 打开面板
2. **源文件夹**：本地路径点「选择...」；手机路径直接填写 `/sdcard/...`（自动走 adb，需连接手机并已授权 USB 调试）
3. **目标文件夹**：点「选择...」
4. 点「**开始传输**」→ 进度条推进 + 日志逐条记录 + 完成后弹窗显示统计与校验结果
5. 传输中可点「取消」

## 特性

- 进度条按**字节**实时推进（大视频也平滑）
- 已存在且大小一致的文件自动**跳过**（可续传）；大小不一致自动**覆盖**
- 单个文件失败不中断，计入日志
- 完成后自动**校验**文件数量与总字节
- 中文文件名、带空格文件名均支持

## 自检 / 测试模式

```powershell
# 面板冒烟自检（自动点击"自动检测"按钮验证回调可用）
powershell -NoProfile -ExecutionPolicy Bypass -File adb_copy_tool.ps1 -SmokeTest

# 无界面复制（本地或 /sdcard 源均可）
powershell -NoProfile -ExecutionPolicy Bypass -File adb_copy_tool.ps1 -TestMode -Source <源> -Dest <目标>

# 端到端界面测试（模拟真实点击"开始传输"）
powershell -NoProfile -ExecutionPolicy Bypass -File adb_copy_tool.ps1 -GuiTest -Source <源> -Dest <目标>
```

## 注意

- `adb_copy_tool.ps1` 需以 **UTF-8 带 BOM** 编码保存（PowerShell 5.1 中文兼容）；用文本编辑器修改后请保持该编码
- `adb_copy_tool.bat` 保持**纯 ASCII**（cmd 只认系统代码页，不能含中文）
