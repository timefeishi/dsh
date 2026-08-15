# DeepSeek Harness 桌面应用（可分发安装包）

把 DeepSeek Harness 的 Web GUI 变成"双击即用"的桌面应用，**自带完整运行环境**，
在任何 Windows x64 设备上安装后即可直接使用，无需安装 Node.js / dsh / npx。

## 🚀 安装包（推荐）

**`release/DeepSeek-Harness-Setup-1.0.0.exe`**（约 156 MB，NSIS 安装程序）

在其他设备上：
1. 拷贝安装包到目标电脑，双击运行
2. 选择安装目录（默认当前用户目录，无需管理员权限）
3. 安装完成后桌面出现 **DeepSeek Harness** 快捷方式
4. 双击即可使用：自动启动 dsh web 服务 → 等待就绪 → 在独立窗口加载界面

关闭窗口会最小化到系统托盘（服务保持运行）；托盘菜单可"打开"/"开机自启动"/"退出（停止服务）"。

> 目标设备需要 Windows 10/11 x64。安装包自带 node.exe 与 dsh 完整依赖树，
> 首次运行会在 `~/.dsh` 自动初始化 profile（无需网络、无需 pnpm）。

## 开发版（本机源码运行）

```powershell
cd C:\Users\16667\Desktop\dsh\dsh-desktop
npm install        # 安装 electron / electron-builder
npm start          # 以开发模式运行（自动复用或启动 dsh web）
```

开发模式优先使用 `resources/dsh-runtime` 内置运行时；若不存在则回退到
npx 缓存中的 dsh CLI。

## 重新打包安装包

```powershell
npm run dist          # 生成 NSIS 安装包到 release/
npm run dist:dir      # 只生成免安装目录 release/win-unpacked
```

构建时会从镜像下载 electron 与 electron-builder 工具链，已配置：
`ELECTRON_MIRROR`、`ELECTRON_BUILDER_BINARIES_MIRROR` 指向 npmmirror。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_PORT` | 服务端口（默认 3080） |
| `DSH_HOME` | dsh 用户数据目录（默认 `~/.dsh`） |
| `DSH_USER_DATA_DIR` | 应用日志/单实例锁目录（默认 `%APPDATA%\DeepSeek Harness`） |

## 文件说明

| 路径 | 说明 |
| --- | --- |
| `main.js` | Electron 主进程：内置运行时定位、服务管理、托盘、开机自启 |
| `resources/dsh-runtime/` | 内置运行环境：`node.exe` + dsh 完整依赖树（打包时内置） |
| `make-icon.js` | 生成应用图标 `assets/icon.ico` |
| `release/` | 构建产物：安装包与 win-unpacked 目录 |
| 日志 | 安装版：`%APPDATA%\DeepSeek Harness\logs\dsh-web.log`；开发版：`./logs/` |

## 已知说明

- 未做代码签名，Windows SmartScreen 可能提示"未知发布者"，点"更多信息 → 仍要运行"即可
- 卸载时通过"设置 → 应用"或安装目录下的 Uninstall 程序完成
