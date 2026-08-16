# DeepSeek Harness 桌面应用 — 项目记忆汇总

> **用途**：跨对话的持久记忆。开启新对话时，请先完整阅读本文件，
> 以恢复对项目的全部上下文。后续对话中本项目相关的状态变化请同步更新本文件。

---

## 0. 硬性协作规则（必须遵守）

这些是用户明确设定的规则，优先级最高，任何对话中都不得违背：

1. **不要直接执行用户的指令**。用户下达执行类指令时，必须先**保持怀疑态度分析**：
   - 这个指令是否合理、是否有副作用/风险？
   - 是否存在更好的方案？
   - 指令与已知事实是否冲突？
   然后给出自己的分析和**合适的执行方案**（可附推荐），等用户确认或用户已明确授权后再执行。
2. **不要盲目相信用户的"我以为"**，但也不要否定——用事实/实测验证后给出结论。
3. **不破坏正在运行的东西**：用户的 DeepSeek Harness 会话（端口 3080）是用户正在使用的，
   任何操作都不得误杀它的进程（尤其不要用 `Stop-Process -Name 'DeepSeek Harness'` 这类宽泛匹配）。
   清理进程必须用精确 PID。
4. **沙箱环境访问 GitHub 极不稳定**（时好时坏、偶发超时/认证失败）。涉及 push/发布失败时，
   先检查是否网络问题，本地提交是安全的；可让用户在自己的终端执行 `git push`。
5. **安全**：GitHub token 已多次出现在对话中（已泄露），务必提醒用户去 GitHub 删除重建。
   发布用 token 存在本地文件 `scripts/gh-token.txt`（git-ignored），不写入代码/文档。
6. **中文交流**。文件/脚本注释可用中文，代码标识符用英文。

---

## 1. 项目概述

把 DeepSeek Harness 的 Web GUI 做成"双击即用"的 Windows 桌面应用：
- 自带完整运行环境（node.exe + dsh 依赖树），目标设备**无需安装 Node/dsh/npx**
- 双击启动 → 自动拉起 dsh web 服务 → 独立窗口加载界面 → 托盘驻留
- 支持自动更新（electron-updater + GitHub Releases）
- 可分发安装包（NSIS），其他设备安装后即可用

当前版本：**v1.0.4**（已发布到 GitHub Releases）。

---

## 2. 环境与路径

| 项 | 值 |
| --- | --- |
| 开发工作区（唯一本地 git 库） | `C:\Users\16667\Desktop\dsh\dsh-desktop` |
| GitHub 远端仓库 | `https://github.com/timefeishi/dsh`（owner: timefeishi, repo: dsh） |
| 构建产物目录 | `release-upd\`（win-unpacked 免安装版 + NSIS 安装包） |
| 内置运行时 | `resources\dsh-runtime\`（git-ignored，构建时从 npx 缓存重建） |
| 运行时压缩包 | `resources\dsh-runtime.tar.gz` + `resources\dsh-runtime.sha256`（git-ignored） |
| 用户 app 安装位置 | `D:\Program Files\DeepSeek Harness`（本机测试安装） |
| app 用户数据 | `%APPDATA%\DeepSeek Harness`（日志、解压的运行时、单实例锁） |
| dsh CLI 来源 | npx 缓存 `%LOCALAPPDATA%\npm-cache\_npx\<hash>\node_modules\@deepseek-ai\dsh` |
| 服务端口 | 默认 3080（用户当前会话所在，**勿动**） |
| Node 版本 | v24.19.0（构建机） |
| Electron | v33.4.11 |

---

## 3. 技术架构与关键机制

### 3.1 应用结构（main.js 为主进程）
- **启动流程**：单实例锁 → createTray → setupAutoUpdater → ensureRuntime（解压运行时）→ 检测/启动 dsh web → 加载 UI
- **关窗驻留托盘**：关窗 = 隐藏到托盘，服务继续跑；托盘"退出"才停服务
- **开机自启**：托盘菜单勾选（`app.setLoginItemSettings`，参数 `--dsh-autostart`）
- **环境变量**：`DSH_PORT`（端口）、`DSH_HOME`（dsh 用户数据）、`DSH_USER_DATA_DIR`（app 数据/单实例锁隔离，测试并行实例用）、`DSH_UPDATE_URL`（覆盖更新源，测试用）
- **运行时定位**：打包版运行时在 `userData/dsh-runtime`（首次启动从 tar.gz 解压）；dev 模式回退 npx 缓存

### 3.2 运行时打包与哈希同步（重要设计）
- `prepare-runtime.ps1`：从 npx 缓存复制依赖树 → `trim-runtime.ps1` 裁剪（只留 win32-x64，保护原生模块）→ 打包 tar.gz → 计算 SHA-256 存 `dsh-runtime.sha256`
- app 启动时比对"安装包内 sha256" vs "已解压目录旁的 `.dsh-runtime.sha256`"：**不一致（依赖变化）→ 自动删旧重解压**；一致则秒开
- 收益：安装快（1 个 tar.gz 而非 3 万小文件）、依赖增删自动同步、无需版本号管理
- **裁剪保护清单**（不能删的包）：koffi、node-pty、sharp、katex、shiki、@shikijs、@img、@vscode、@mixmark-io、@earendil-works、@tanstack（koffi 的 ESM 入口运行时 import `src/`，删了会崩）

### 3.3 自动更新（electron-updater）
- 更新源：GitHub Releases（`publish.provider=github, owner=timefeishi, repo=dsh`）
- 启动时后台检查 + 托盘"检查更新…" + **设置面板"更新"页签**（含"检查更新"按钮）
- 下载进度可视化（`download-progress` 事件 → 页面进度条）；下载完成提示重启
- **更新说明**：发布时填写 release notes（见 §5），app 弹窗展示 `info.releaseNotes`

### 3.4 设置面板注入（页面 UI 集成）
- 通过 `did-finish-load` + `executeJavaScript` 向 harness 页面注入"更新"导航项
- 复用原生类 `VOzbGW_navCell`（样式与原生一致）；`MutationObserver` 持续重新注入（面板每次打开重建）
- 点击"更新"→ **overlay 叠加面板**（`#dsh-update-overlay`，绝对定位覆盖内容区）——**绝不能 `content.innerHTML=''`**（会破坏 React 协调，导致页签无法切换，已踩坑修复）
- 事件委托：点原生页签时移除 overlay

---

## 4. 脚本清单（scripts/）

| 脚本 | 作用 |
| --- | --- |
| `prepare-runtime.ps1` | 重建运行时：复制 npx 缓存 → 裁剪 → 打包 tar.gz + sha256 |
| `trim-runtime.ps1` | 裁剪 node_modules（win32-x64 only，含保护清单） |
| `publish.ps1` | 构建：清 stale release 目录（防磁盘膨胀）→ 检测运行中 app → 重建运行时 → electron-builder 构建/发布。参数：`-Publish`、`-CleanAll`、`-ReleaseNotesFile` |
| `release.ps1` | 一键发布：git 检测（master/干净/同步）→ 版本号 → 交互填更新说明 → 调 publish.ps1。参数：`-Version`、`-ReleaseNotes`、`-SkipGitCheck` |
| `发布新版.bat` | 双击入口 → 调 `scripts\release.ps1`（注意路径是 scripts 子目录） |
| `make-icon.js` | 生成图标 assets/icon.ico |
| `probe-*.js` / `verify-*.js` | CDP 探针/验证脚本（排查页面结构、注入效果），可复用 |

### 发布命令速查
```powershell
# 一键发布（双击 发布新版.bat 等价）
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 1.0.5

# 仅构建
powershell -ExecutionPolicy Bypass -File scripts\publish.ps1

# 仅清理历史 release 目录
powershell -ExecutionPolicy Bypass -File scripts\publish.ps1 -CleanAll

# GH_TOKEN 来源：环境变量 或 scripts\gh-token.txt（git-ignored，一行 token）
```

---

## 5. 发布流程（已定稿）

1. `git add/commit/push`（保持本地=远端、工作树干净）
2. 双击 `发布新版.bat` 或 `release.ps1 -Version x.y.z`
   - git 检测：master 分支、工作树干净、本地与 origin 同步（否则报错停止）
   - 升版本号（改 package.json，提交+推送）
   - **交互填写更新说明**（逐行输入，空行结束；或 `-ReleaseNotes "a; b; c"`）
   - 构建安装包 → 上传 GitHub Releases（exe + blockmap + latest.yml）
3. 其他设备 app 启动时自动检测新版本，弹窗显示更新说明

**踩坑记录**（发布相关）：
- PowerShell 单行 git 输出是裸字符串非数组，`Output[-1]` 会取到最后一个字符（如 'r'）→ 用 `Select-Object -Last 1`
- `git push` 成功时 stderr 有 "To ..."，配合 `$ErrorActionPreference='Stop'` + `2>&1` 会误判失败 → 用 `Invoke-Git` 辅助函数只按 exit code 判断
- electron-builder 的 `-c.directories.output` / `-c.releaseInfo.*` 参数在 PowerShell 里会被误解析 → 用 `cmd /c` 字符串方式传递
- `Set-Content -Encoding UTF8`（PS5）写 JSON 带 BOM 会破坏 electron-builder → 用 `[System.IO.File]::WriteAllText` + UTF8 无 BOM
- electron-builder 首次构建需手动放置 winCodeSign 缓存到 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`（darwin 符号链接解压失败问题）

---

## 6. 历史决策记录（为什么这样做）

| 决策 | 原因/替代方案 |
| --- | --- |
| 运行时内置而非在线下载 | 目标设备无 node/npm；@deepseek-ai/* 私有生态包无法裸 npm install |
| tar.gz 单文件 + 首启解压（方案 A） | 安装快；曾考虑"首启下载"（方案 B）会引入网络依赖，放弃 |
| 哈希同步而非版本号同步依赖 | 依赖变化自动重解压，无需人工维护 |
| 保守裁剪 + 保护清单 | 激进裁剪导致 koffi 启动崩溃（实测踩坑） |
| 设置面板 overlay 而非替换内容区 | `innerHTML=''` 破坏 React 协调导致页签切换失效 |
| 复用原生 `VOzbGW_navCell` 类 | 样式与页面完全一致，不突兀 |

---

## 7. 安全事项

- ⚠️ **GitHub token 已泄露**（多次出现在对话/日志中，具体值见对话历史，此处不记录）
  - 用户需去 GitHub → Settings → Developer settings → Personal access tokens 删除重建
  - 新 token 写入 `scripts/gh-token.txt`（git-ignored）
- 发布脚本不硬编码 token；token 文件不入库
- 未做代码签名，其他设备 SmartScreen 会提示"未知发布者"（点"仍要运行"即可）；用户暂不做签名

---

## 8. 待办 / 已知问题

- [ ] 验证 `releaseNotesFile` 参数通过 `cmd /c` 方式是否真正生效（v1.0.4 的 body 是 API 手动补的）——用户计划在下次发布时自行验证
- [ ] 用户去 GitHub 删除重建 token 并更新 `scripts/gh-token.txt`
- [ ] 清理：本地可能残留 `release\`（旧）等历史目录（`publish.ps1 -CleanAll` 可清）
- [ ] 代码签名（用户暂缓，未来可做：商业证书或 Azure Trusted Signing）

---

## 9. 当前状态快照（2026-08-16）

- 最新版本 v1.0.4 已发布（含：设置面板更新栏、overlay 页签修复、进度条优化、更新说明）
- GitHub master 与本地同步（用户已手动 push）
- 用户当前会话运行在 3080（Program Files 安装版 v1.0.2 的运行时），**不要干扰**
- 构建产物：`release-upd\DeepSeek-Harness-Setup-1.0.4.exe`
