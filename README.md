# DeepSeek Harness 桌面应用（可分发安装包）

把 DeepSeek Harness 的 Web GUI 变成"双击即用"的桌面应用，**自带完整运行环境**，
在任何 Windows x64 设备上安装后即可直接使用，无需安装 Node.js / dsh / npx。

## 快速使用（已安装用户）

双击桌面 **DeepSeek Harness** 快捷方式即可：
自动启动 dsh web 服务 → 等待就绪 → 在独立窗口加载界面。

- 关闭窗口 = 最小化到系统托盘（服务保持运行）
- 托盘菜单：打开 / 检查更新… / 开机自动启动 / 退出（停止服务）
- 主界面右下角有"检查更新"按钮，也可从托盘手动检查
- 有新版本时启动会自动检测（来自 GitHub Releases）

## 安装包

最新安装包见 GitHub Releases：
<https://github.com/timefeishi/dsh/releases>

### 安装为什么快？运行时按需解压

安装包**不再散装几千个小文件**，而是把完整运行环境（node.exe + dsh 依赖闭包）
压缩成**一个 `dsh-runtime.tar.gz`（约 80MB）**内置：

1. **安装**：只写 1 个大文件 → 安装很快（相比以前散 3 万个小文件）
2. **首次启动**：自动解压到用户目录（约 20 秒，显示启动画面，一次性）
3. **之后启动**：直接使用已解压的运行时，秒开

### 依赖变更自动同步（无需版本号管理）

运行时用**内容哈希**（`dsh-runtime.sha256`）作为依赖指纹：

- 每次打包时对 `dsh-runtime.tar.gz` 计算 SHA-256
- app 启动时比对"安装包内的哈希"与"已解压目录旁的标记"
- **哈希不一致（依赖增删/升级）→ 自动删除旧运行时 → 重新解压** → 用新依赖启动
- 依赖没变 → 跳过解压直接启动

因此开发中**任意增删依赖**，用户更新 app 后会自动获得完全一致的依赖树。

## 从源码构建 app（克隆仓库后）

需要：Windows 10/11 x64、Node.js（>= 20，构建机需要）、网络。

```powershell
# 1. 克隆仓库
git clone https://github.com/timefeishi/dsh.git
cd dsh

# 2. 安装开发依赖（electron、electron-builder、electron-updater）
npm install

# 3. 准备内置运行环境（node.exe + dsh 依赖闭包）
#    从本机 npx 缓存复制 → 裁剪（只留 win32-x64）→ 打包 tar.gz + 生成哈希
powershell -ExecutionPolicy Bypass -File scripts\prepare-runtime.ps1

# 4. 构建 NSIS 安装包（输出到 release-upd\）
powershell -ExecutionPolicy Bypass -File scripts\publish.ps1

# 产物：release-upd\DeepSeek-Harness-Setup-<version>.exe
#       release-upd\latest.yml        （自动更新元数据）
#       release-upd\*.blockmap        （差分更新）
```

也可以不克隆，直接在**开发工作区**（dsh-desktop）内操作，步骤相同。

## 发布新版本

**推荐方式：双击 `发布新版.bat`**（一键发布工具），自动完成：

```
[1/4] git 检测：必须在 master、工作区干净、本地与 origin 同步（否则停止）
[2/4] 版本号：显示当前版本，输入新版本（回车自动 +1 patch）
[3/4] 构建+发布：清理旧产物 → 重建运行时 → 构建安装包 → 上传 GitHub Releases
[4/4] 完成：显示发布地址
```

要求：发布前需设置环境变量 `GH_TOKEN`（GitHub token，勾选 repo 权限）。

命令行等价方式：

```powershell
# 交互式（提示输入版本号）
powershell -ExecutionPolicy Bypass -File scripts\release.ps1

# 指定版本
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 1.0.2

# 跳过 git 检查（仅本地构建测试，不提交不推送）
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 1.0.2 -SkipGitCheck

# 仅构建不上传
powershell -ExecutionPolicy Bypass -File scripts\publish.ps1
# 仅清理历史 release 目录（防磁盘膨胀）
powershell -ExecutionPolicy Bypass -File scripts\publish.ps1 -CleanAll
```

`publish.ps1` 会自动：
- 检测并（确认后）删除历史 release 目录（**防止磁盘无限膨胀**）
- 检测是否有 app 正在从 `release-upd\win-unpacked` 运行（会锁定文件，提示先关闭）
- 重建运行时 → 构建安装包 + latest.yml + blockmap
- （`-Publish` 时）创建 GitHub Release 并上传三件套

其他设备上的 app 启动时即自动发现新版本并提示更新。

> 手动发布：构建后到 GitHub → Releases → Create new release，tag 填版本号，
> 上传 `DeepSeek-Harness-Setup-<v>.exe`、`latest.yml`、`*.exe.blockmap` 三个文件。
> ⚠️ 三件套必须同一次构建生成（sha512 配套），不能混用。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `main.js` | Electron 主进程：运行时解压/哈希同步、服务管理、托盘、开机自启、自动更新 |
| `preload.js` | 页面内"检查更新"按钮的 IPC 桥 |
| `scripts/prepare-runtime.ps1` | 重建运行时（复制→裁剪→打包→生成哈希） |
| `scripts/trim-runtime.ps1` | 裁剪运行时（只留 win32-x64，保护原生模块） |
| `scripts/publish.ps1` | 构建 + 清理旧产物 + 运行中检测 + （可选）发布 |
| `scripts/release.ps1` | 一键发布（git 检测→升版本→构建→发布） |
| `发布新版.bat` | 一键发布入口（双击运行） |
| `make-icon.js` | 生成应用图标 `assets/icon.ico` |
| `resources/dsh-runtime.tar.gz` | 内置压缩运行时（git 忽略，构建时生成） |
| `resources/dsh-runtime.sha256` | 运行时内容哈希（依赖同步指纹，git 忽略） |
| `release-upd/` | 构建产物（git 忽略，`publish.ps1` 每次清理重建） |

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_PORT` | 服务端口（默认 3080） |
| `DSH_HOME` | dsh 用户数据目录（默认 `~/.dsh`） |
| `DSH_USER_DATA_DIR` | 应用日志/单实例锁/运行时解压目录（默认 `%APPDATA%\DeepSeek Harness`） |
| `DSH_UPDATE_URL` | 覆盖自动更新源为自建服务器（默认 GitHub Releases） |
| `GH_TOKEN` | 发布时上传 GitHub Releases 用的 token（仅发布工具需要） |

## 已知说明

- 未做代码签名，Windows SmartScreen 可能提示"未知发布者"，点"更多信息 → 仍要运行"即可
- 日志：安装版 `%APPDATA%\DeepSeek Harness\logs\dsh-web.log`；开发版 `./logs/`
- 运行时解压位置：`%APPDATA%\DeepSeek Harness\dsh-runtime`（哈希不匹配时自动重建）
- 卸载：设置 → 应用，或安装目录下 Uninstall 程序
