# DeepSeek Harness 桌面应用（可分发安装包）

把 DeepSeek Harness 的 Web GUI 变成"双击即用"的桌面应用，**自带完整运行环境**，
在任何 Windows x64 设备上安装后即可直接使用，无需安装 Node.js / dsh / npx。

## 快速使用（已安装用户）

双击桌面 **DeepSeek Harness** 快捷方式即可：
自动启动 dsh web 服务 → 等待就绪 → 在独立窗口加载界面。

- 关闭窗口 = 最小化到系统托盘（服务保持运行）
- 托盘菜单：打开 / 检查更新… / 开机自动启动 / 退出（停止服务）
- 有新版本时启动会自动检测（来自 GitHub Releases），也可手动"检查更新…"

## 安装包

最新安装包见 GitHub Releases：
<https://github.com/timefeishi/dsh/releases>

## 从源码构建 app（克隆仓库后）

需要：Windows 10/11 x64、Node.js（>= 20，构建机需要）、网络。

```powershell
# 1. 克隆仓库
git clone https://github.com/timefeishi/dsh.git
cd dsh

# 2. 安装开发依赖（electron、electron-builder、electron-updater）
npm install

# 3. 准备内置运行环境（node.exe + dsh 依赖闭包，~335MB）
#    从本机 npx 缓存复制；若缓存缺失会提示先运行 npx 命令
powershell -ExecutionPolicy Bypass -File scripts\prepare-runtime.ps1

# 4. 构建 NSIS 安装包（输出到 release-upd\）
powershell -ExecutionPolicy Bypass -File scripts\publish.ps1

# 产物：release-upd\DeepSeek-Harness-Setup-<version>.exe
#       release-upd\latest.yml        （自动更新元数据）
#       release-upd\*.blockmap        （差分更新）
```

也可以不克隆，直接在**开发工作区**（dsh-desktop）内操作，步骤相同。

## 发布新版本

```powershell
# 1. 编辑 package.json，提升 version（如 1.0.1）

# 2. 构建 + 上传到 GitHub Releases
$env:GH_TOKEN = "你的 GitHub token（勾选 repo 权限）"
powershell -ExecutionPolicy Bypass -File scripts\publish.ps1 -Publish
```

`publish.ps1` 会自动：
- 重新生成内置运行时
- 清理上一次构建产物（**防止磁盘无限膨胀**，固定输出到 `release-upd\`）
- 构建安装包 + latest.yml + blockmap
- （加 `-Publish` 时）创建 GitHub Release 并上传三件套

其他设备上的 app 启动时即自动发现新版本并提示更新。

> 手动发布：构建后到 GitHub → Releases → Create new release，tag 填版本号，
> 上传 `DeepSeek-Harness-Setup-<v>.exe`、`latest.yml`、`*.exe.blockmap` 三个文件。
> ⚠️ 三件套必须同一次构建生成（sha512 配套），不能混用。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `main.js` | Electron 主进程：内置运行时定位、服务管理、托盘、开机自启、自动更新 |
| `scripts/prepare-runtime.ps1` | 从 npx 缓存重建内置运行环境 |
| `scripts/publish.ps1` | 构建 + 清理旧产物 + （可选）发布到 GitHub |
| `make-icon.js` | 生成应用图标 `assets/icon.ico` |
| `resources/dsh-runtime/` | 内置运行环境（git 忽略，构建时生成） |
| `release-upd/` | 构建产物（git 忽略，`publish.ps1` 每次清理重建） |

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_PORT` | 服务端口（默认 3080） |
| `DSH_HOME` | dsh 用户数据目录（默认 `~/.dsh`） |
| `DSH_USER_DATA_DIR` | 应用日志/单实例锁目录（默认 `%APPDATA%\DeepSeek Harness`） |
| `DSH_UPDATE_URL` | 覆盖自动更新源为自建服务器（默认 GitHub Releases） |

## 已知说明

- 未做代码签名，Windows SmartScreen 可能提示"未知发布者"，点"更多信息 → 仍要运行"即可
- 日志：安装版 `%APPDATA%\DeepSeek Harness\logs\dsh-web.log`；开发版 `./logs/`
- 卸载：设置 → 应用，或安装目录下 Uninstall 程序
