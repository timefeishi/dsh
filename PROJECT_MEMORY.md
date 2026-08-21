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

## 9.5 关联项目：dsh-usage-cost 插件（2026-08-16 新增）

> 在仓库内 `dsh-usage-cost\` 独立开发的 Harness 用量/费用统计插件，
> **独立项目，记忆文件见 `dsh-usage-cost\PROJECT_MEMORY.md`**（勿与本文件混淆）。

- 功能：外置计费窗口（左侧粘连/跟随）、每条回复「本轮」费用标签、今日/本周/本月统计、峰谷自动计价
- 安装：运行时 `dsh-runtime\node_modules\dsh-usage-cost` + `~/.dsh/profiles/web/cordis.patch.yml`（`- insert:` 块）+ apiproxy 白名单
- 与本应用的关系：插件装进 Harness 运行时，随本应用一起工作；**应用"关窗驻留托盘"行为直接影响插件的联动关闭逻辑**（插件用 `visibilitychange` 感知窗口隐藏）
- 状态：功能完整、用户确认可用；更新流程 = 改源码 → `install.ps1` → 重启 Harness（app 端无开发者工具，只有重启能加载新代码）
- **运行方式变更（2026-08-16）**：用户端安装（`D:\Program Files\DeepSeek Harness`）已卸载（仅验证用），此后用**开发端** `release-upd\win-unpacked\DeepSeek Harness.exe`
- ⚠️ **注意**：发布新版若运行时依赖变化，`dsh-runtime.sha256` 不一致会触发自动重解压 → **插件与 apiproxy 白名单补丁被清**，需重跑插件的 `install.ps1` 恢复
- **随 app 分发（方案 A，2026-08-16 已实施）**：插件烘焙进运行时 —— `prepare-runtime.ps1` 在 trim 后打包前复制插件（package.json+lib+client.js）到 `resources\dsh-runtime\node_modules\dsh-usage-cost` 并给 apiproxy 打白名单补丁（**rc.7 起上游删除白名单，脚本自动跳过，见下方 2026-08-18 记录**）；`main.js` 启动时（ensureRuntime 后）幂等确保 `~/.dsh/profiles/web/cordis.patch.yml` 的 `- insert:` 挂载行 + `~/.dsh/profiles/node_modules/dsh-usage-cost` junction。**效果：每台装 app 的设备自动带插件，且随每次构建重新烘焙、免疫重解压清空**。包体增量约 0.06MB（可忽略）
- 插件源码位置：仓库内 `dsh-usage-cost\`（`prepare-runtime.ps1` 默认取仓库内 `dsh-usage-cost`，可用 `-PluginSource` 覆盖）

---

## 9. 当前状态快照（2026-08-16）

- 最新版本 v1.0.4 已发布（含：设置面板更新栏、overlay 页签修复、进度条优化、更新说明）
- GitHub master 与本地同步（用户已手动 push）
- 用户当前会话运行在 3080（Program Files 安装版 v1.0.2 的运行时），**不要干扰**
- 构建产物：`release-upd\DeepSeek-Harness-Setup-1.0.4.exe`

## 9.6 运行时核心升级 rc.7（2026-08-18，未发布）

- **背景**：上游 deepseek-ai/deepseek-harness 发布 `dsh-v0.1.0-rc.7`；本地原为 rc.6（npx 缓存 + 运行中会话）。
- **已执行（仅更新、未发布）**：
  1. `npx --yes @deepseek-ai/dsh@0.1.0-rc.7 --version` → npx 缓存新增 `2ede61d9d1d3d32e`（rc.7）
  2. `scripts\prepare-runtime.ps1` 重建 `resources\dsh-runtime.tar.gz`：**74.1MB**（旧 85.9MB），sha256 `5c3051c32ab50dc48c7ee0b230c40b6bbc242841edb05baf0ab8f537c7dbde25`（旧 `90779e5f...`）；tarball 内 `@deepseek-ai/dsh` = **0.1.0-rc.7**，dsh-usage-cost 插件已烘焙
- **⚠️ rc.7 上游变更：apiproxy 白名单已删除** —— `dsh-host-apiproxy/lib/index.js` 不再有 `WEB_SETTINGS_NAMESPACES` / `exposedNamespaces()`，`settings.describe` 对所有已注册命名空间放行（含 usage-cost）。因此：
  - `scripts\prepare-runtime.ps1` 与 `dsh-usage-cost\install.ps1` 的白名单补丁改为**"匹配不到即跳过"**（兼容 rc.6 及更早，rc.7 自动跳过）
- **当前运行中的会话仍是 rc.6**（`%APPDATA%\DeepSeek Harness\dsh-runtime` 未动）。要让 rc.7 生效：重跑 `scripts\publish.ps1`（仅构建 win-unpacked）或走发布流程，然后重启 app（sha256 变化 → 自动重解压）。
- **待办**：发布前先用新 win-unpacked 实机验证 rc.7 下插件正常（usage-cost 设置页可见、按钮/统计可用）。
  - 注：上面 sha `5c3051c3` 为首次重建值；随后一次被连带杀的 publish.ps1 在杀进程后仍跑完了 prepare-runtime，tar.gz 重打包为 `f21c39c8`（gzip 头时间戳变化导致字节/指纹不同，**内容同为 rc.7**），见 §9.7。

## 9.7 开发端构建到 release-upd2（2026-08-18，未发布）

- **背景**：想把开发端（release-upd\win-unpacked）升到 rc.7。第一次尝试在对话里直接跑 `publish.ps1`（脚本自动应答"关闭运行中 app"）→ **失败**：脚本 `Stop-Process -Force` 杀 Harness 主进程时，Windows Job Object（KILL_ON_JOB_CLOSE）把构建子进程连带杀掉，构建死在 prepare-runtime 之后、删除 release-upd 之前（Tee-Object 日志停在 "Closed 4 process(es)."，但 tar.gz 已在 21:36:20 重打包完成）。
- **教训**：**在 Harness 会话里跑 publish.ps1 且让脚本杀进程 = 构建会被连带终止**。开发端构建必须避开运行中的 exe（或让用户退出后再跑）。
- **成功方案**：直接 electron-builder 到**新目录** `release-upd2`（不删、不碰正在运行的 release-upd）：
  ```powershell
  $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
  $env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
  cmd /c "cd /d dsh-desktop && node_modules\.bin\electron-builder.cmd --win nsis -c.directories.output=release-upd2"
  ```
- **产物**：`release-upd2\win-unpacked\DeepSeek Harness.exe`（打包 rc.7 运行时，tarball sha `f21c39c8...`，与仓库 `resources\dsh-runtime.tar.gz` 一致）。**使用**：托盘退出当前 app → 双击 release-upd2 的 exe → 启动时 sha 不匹配自动重解压 rc.7。
- **注意**：
  - `release-upd`（旧 v1.0.4/rc.6）保留作回退；确认稳定后可手动删除或改名（需退出 app 后操作）。
  - 以后正式发布时 `publish.ps1` 会把 `release-upd2` 识别为 stale 目录（发布时提示删除，属正常设计）。
  - 本次构建 rcedit 三次重试失败（"Unable to commit changes"，exe 图标/版本资源可能未更新）——**非致命**，不影响运行；8/16 构建曾正常。若在意可单独重跑 winCodeSign rcedit 修复。
  - 备用回退：`C:\Users\16667\Desktop\dsh\backup\DeepSeek-Harness-Setup-1.0.4.exe`（v1.0.4 安装包备份）。

## 9.8 事故记录：pzds-tool 插件丢失导致启动失败（2026-08-18）

- **现象**：切换 release-upd2（rc.7）后 app 启动不了；用户 mv `~/.dsh/profiles/web` → `web.bak` 后才启动成功。
- **根因**（日志 `%APPDATA%\DeepSeek Harness\logs\dsh-web.log`）：
  1. `dsh-pzds-tool` 是**手动装进 `%APPDATA%\DeepSeek Harness\dsh-runtime\node_modules`** 的插件（不在烘焙 tarball 里，8/16 构建与 rc.7 tarball 均无此条目），并通过 `~/.dsh/profiles/node_modules/dsh-pzds-tool` junction + `cordis.patch.yml` 的 insert 挂载。
  2. 升级 rc.7 → 启动时 sha 不匹配（f21c39c8 vs ff618f14）→ **自动删旧重解压运行时** → `dsh-pzds-tool` 被物理删除 → junction 断链。
  3. `cordis.patch.yml` 仍引用 `dsh-pzds-tool` → loader 报 `ERR_MODULE_NOT_FOUND: Cannot find package 'dsh-pzds-tool' imported from ...profiles\web` → **dsh 进程启动即退出（server exited code=1）→ app 启动不了**。
  4. 用户 mv profiles\web → dsh 重建默认 profile（无 pzds-tool 引用）→ 启动成功。
- **现状**：rc.7 正常运行；`usage-cost` 由 main.js 幂等修复（挂载行 + junction，14:17:28 日志确认）且 dump-config 可见；**pzds-tool 源码无副本（全盘搜索无果），插件本体丢失**；数据目录 `dsh-desktop\pzds_plugin\`（params/reports/history 等）仍在；`web.bak` 保留旧 patch（含 pzds-tool insert）供参考；cordis.yml 新旧均为默认 `[]`，无其他配置丢失。
- **⚠️ 教训（重要）**：
  - **任何手动装进 `%APPDATA%\DeepSeek Harness\dsh-runtime` 的非烘焙插件，运行时重解压时必被清除**；若 `cordis.patch.yml` 仍挂载它 → **整个 dsh 启动失败**（不只是插件失效）。
  - 对策：插件必须走"烘焙进 prepare-runtime.ps1"（同 usage-cost 方案 A）才能在升级后存活；升级前若有不打算烘焙的插件，先从 cordis.patch.yml 移除挂载行再升级。
  - 待办：用户找回 pzds-tool 源码后（若存在 git/云盘副本），建议烘焙进 `prepare-runtime.ps1` 并恢复挂载；找回前勿把 `web.bak` 的 pzds-tool insert 加回当前 `web\cordis.patch.yml`（会导致再次启动失败）。

### 9.8.1 pzds-tool 已从会话记录完整恢复（2026-08-18 晚，两次迭代）

- **源码找回**：原始会话 `~/.dsh/sessions/--C-Users-16667-Desktop-dsh-dsh-desktop--/session-46d0b4bf-.../session.jsonl.zstd`（"判断原神账号价值"）完整记录了插件开发（16 次 cordis_define + **静态化固化过程**）。用**手动逐帧 zstd 解压**（Node `zstdDecompressSync` 只解一帧，dsh 用私有多帧封装）提取。
- **❌ 第一次重建失败（教训）**：误用**动态插件版**代码（cordis_define 的 host.call 架构 + `__ModuleLoader__.load((module,exports)=>{})` 错误形式）自行转换格式 → 重启报 `client-modules: bundle .../client.js loaded without registering "dsh-pzds-tool" via __ModuleLoader__.load` → 用户再次 mv web 才能进。**教训：动态插件版与静态文件插件版是两套完全不同的架构，重建必须用会话里固化的原始文件，禁止从动态代码猜格式。**
- **✅ 第二次重建（成功）**：从会话 write 记录提取**固化版原始文件**（当时运行正常的静态插件版，seq 1034459/1040034/1082876）：
  - `lib/index.js`（5710B）：`installSettingsSection` 注册 `pzds-tool` 设置命名空间（params/command/status/result/history 五字段），`scope.watch` 监听 command → spawn 运行时 node.exe 跑 `pzds_plugin\runner.js` → 轮询 progress.json 回写 status、结束时写 result/history
  - `client.js`（13579B）：`__ModuleLoader__.load({ id: "dsh-pzds-tool", factory: (require)=>{...} })` + `require("react")`/`require("react/jsx-runtime")` + JSX 运行时；`exports.inject = ["slots","settingsScope","locale"]`；apply 里 `ctx.settingsScope.bind({namespace:"pzds-tool"})` + `ctx.slots.inject("settings.section", ...)`（设置面板"账号报告"页）
  - `package.json`（761B）：`dsh.client.inject` = runtime + ui-primitives（**无 locale**）；dependencies = dsh-settings/schemastery/zod
  - **通信架构**：client 经 settings 命名空间读写（非 host.call），host 端对应命名空间 watch
- **已安装并验证**（`dsh-pzds-tool\` 项目目录 = 固化版三文件 + install.ps1）：
  - 包已复制到 `%APPDATA%\DeepSeek Harness\dsh-runtime\node_modules\dsh-pzds-tool`，junction 复活
  - **mock 冒烟测试通过**（node 模拟 `window.__ModuleLoader__` 加载 client.js → id/apply/inject 正确注册；ESM import lib → name/SETTINGS_NAMESPACE/apply/Config 正常）
  - `web\cordis.patch.yml` = usage-cost + pzds-tool，dump-config 验证通过
  - **需重启 Harness 生效**
- **⚠️ 尚未烘焙**：pzds-tool 未加入 `prepare-runtime.ps1` 烘焙清单 → **下次运行时重解压（正式发布升级）仍会被清 + 若 patch 仍挂载会再次启动失败**。发布前必须：① 烘焙 `dsh-pzds-tool\` 进 `prepare-runtime.ps1`（同 usage-cost 方案 A），② 或升级前先从 patch 移除。
- **runner.js 硬编码路径依赖**：`WS_PATH` 指向运行时 `node_modules\ws`（重解压后仍在，因属 dsh 依赖树）；`BASE`/`PLUGIN_DIR` 指向 `dsh-desktop\pzds_plugin`；host 端 NODE/PLUGIN_DIR 同样硬编码。换机器/换路径需同步改。
- 会话解压工具与固化版备份：`logs\scan-sessions.js`/`dump-session.js`/`extract-cured.js` + `logs\cured-*`（固化版原始文件备份）；`logs\session-46d0b4bf.txt`（38MB 原始会话文本）。

### 9.8.2 pzds-tool 设置页空白修复（2026-08-18 深夜）

- **现象**：重启后设置面板里没有"账号报告"页（inspect 显示 `settings.section` 的 pzds-tool occupant `active: false` = 从未被渲染）；usage-cost 各槽位 active: true（不受影响）。
- **根因**：**rc.7 的 `settings.section` 契约要求 `label` 字段**（导航显示文本，官方写法 `label: () => t("nav")`）；固化版是 rc.6 时代写法（只有 `locale`，无 `label`）→ 导航不渲染该页 → 点不到 → 永不激活。usage-cost 注册的是 sidebar/overlay/assistant-actions 槽位，契约不要求 label，所以正常。
- **修复**：`dsh-pzds-tool\client.js` 的 settings.section register 增加 `label: () => t("section.label")`（字典已有 "section.label": 账号报告）。**mock 全流程测试通过**（load → apply 执行 → register → label 文本/namespace/组件断言）。已同步运行时。**需重启生效**。
- **经验**：rc.6 → rc.7 升级后，**客户端槽位契约可能变化**（如 settings.section 新增 label 要求）；对比官方包（dsh-client-ui-settings-general 等）的注册写法是排查关键。用法：`cordis_inspect_query(client, Slots, listSubTree, {root})` 看 occupants active 状态 + 官方包 client.js 对照。
- **⚠️ 固化版自带 JSX bug（2026-08-18 深夜二次修复）**：点击"账号报告"页后内容空白。根因：固化版 client.js 里**所有静态文本用了 `jsx(el, null, text)` / `jsx(el, props, text)` 第三参数形式**（React 的 jsx 第三参数是 **key**，不是 children！）→ 标题/label/按钮文字/option 文本全部丢失 → 只剩空输入框。**修复**：16 处全部改为 `jsx(el, { children: text })` 形式。**验证**：react-dom/server `renderToString(PzdsPanel)` 输出 2269 字节、含标题/label/按钮/状态文本。已同步运行时，需重启。遗留非致命 React key 警告（children 数组元素无 key + option 的 key 在 props 里 spread）——rc.6 时代就有，不影响显示，暂不处理。
- **⚠️ 固化版功能缺失补全（2026-08-18 深夜三次修复）**：用户指出"查看没反应、无删除按钮"（动态版 v9-v11 已有）。**教训：恢复插件必须把动态版功能清单与固化版逐项对比，不能只还原文件**。固化版缺/坏：
  1. **命令匹配 bug**：client 发 `"start:"+ts`/`"stop:"+ts`，host 只认 `"start"`/`"stop"`（精确相等）→ 生成报告/停止根本触发不了。改 host 为 `startsWith("start:")`/`startsWith("stop:")`。
  2. **打开报告**：固化版 client 调不存在的全局 `window.__dshPzdsOpenReport`。改走 settings 命名空间：client 写 `command:"open:"+path`，host watch 分支 spawn `cmd /c start path`。
  3. **删除历史**：固化版历史表格无删除按钮、host 无删除逻辑。补：client 表格加"删除"按钮写 `command:"delete:"+id`；host 加 `deleteHistory(id)`（删 history.json 条目 + 删报告文件）+ watch 分支，删除后刷新 history 字段。
  - **验证**：host mock 测试（start 触发 runner / open 触发 cmd / delete 删条目+删文件+scope 更新 / 未找到不崩溃）+ client renderToString（历史表格含查看+删除按钮）全部通过。已同步运行时，需重启生效。
- **⚠️⚠️ 真根因：host 重复注册命名空间导致 watch 从未注册（2026-08-19 凌晨第四次修复，此前三次都是打补丁）**：
  - **现象**：重启后 client 能渲染（label/删除按钮/表单都在），但"生成报告/查看/删除"全部无反应。
  - **实测定位**（apiproxy 直连，不靠 mock）：`POST /api/settings.mutate` 写 `command` **成功**（存储确实更新，describe 可读回），但 host 的 watch 从未处理 → **断点不在 client 写入，在 host 的 watch 未注册**。
  - **根因**：dsh-settings 的 `register(ns)` 有**重复注册检查**（`if (registrations.has(ns)) throw "already registered"`）。固化版 host 里 `installSettingsSection` **先注册一次** `pzds-tool`，随后自己的 `ctx.inject` 里**再次 `settings.register("pzds-tool")` → 必然抛错** → `scope.watch`（命令处理）**从未注册**。固化版 host 从 8/17 固化起从未真正工作过（8/17-8/18 的历史记录是**动态版** runner 写的，共享 history.json）。
  - **修复**（`lib/index.js` 重写命令驱动）：
    1. 去掉重复 `settings.register`，用 `sctx.settings.get(ns)` / `sctx.settings.update(ns, patch)` 直接读写；
    2. 用 **`sctx.on("settings/document-updated", ...)` 事件驱动**命令处理（client 经 apiproxy mutate 写入会触发该事件，官方机制）；
    3. **统一防重守卫** `if (cmd === lastCommand) return`——host 自己的 `settings.update` 会再次触发 document-updated 回声，不加守卫会**无限递归栈溢出**（测试实测 RangeError）。
  - **验证**：node 模拟真实 settings 服务 + 事件系统：register 仅 1 次 / delete 删条目+删文件+status 更新+无死循环 / open spawn / start spawn / 未找到不崩溃，全部通过。
  - **⚠️ 教训（血泪）**：mock 测试必须模拟**真实服务的失败语义**（如 register 重复抛错、update 触发事件回声），否则测试全绿但真实环境全灭。测试 client 渲染 ≠ host 链路可用。真实验证用 apiproxy 直连最可靠（`POST /api/settings.mutate` + describe 读回）。
- **⚠️⚠️⚠️ 定案修复 v4：用 scope.watch 官方机制（2026-08-19 凌晨）**：
  - v3（事件驱动 `sctx.on("settings/document-updated")`）**依然无效**（apiproxy 实测 command 写入成功但 host 不处理）。原因：`document-updated` 事件由 settings 服务在**其自身 ctx** 发出（`ctx.events.dispatch`），cordis 事件按 ctx 层级传播，host 插件（平级 ctx）的 `sctx.on` 收不到；client 能收到是因为经 `remote`（连接层）转发。
  - **正解**：dsh-settings 的官方通知机制是 **`scope.watch`**——`register()` 返回的 scope，`write→commit`（resolved 值变化时）直接调用 watcher 回调（`lib/index.js` commit 549-559 行）。client 的 mutate 走同一 `write` 路径，所以 watch 必触发。
  - **host 终版结构**：`ctx.inject(["settings","subprocess"])` 内**唯一一次** `settings.register("pzds-tool", Config, {base})` 拿 scope → `scope.watch` 驱动 handleCommand（防重守卫 `cmd === lastCommand`）→ `scope.get/update` 读写。**不再用 installSettingsSection**（它额外 register 一次导致冲突，是历代失效的根源）。
  - **验证**：host v4 测试模拟真实 commit→watcher 语义全过（delete 删条目+删文件+status+防回声 / open / start / 同命令防重）。已同步运行时。**待用户重启后 apiproxy 实测确认**。
- **修复遗留**：host v5（2026-08-19）：**启动时不再自动执行残留命令**——改为 `scope.update({command:""})` 清空历史点击残留（用户曾因重启自动打开上次点过的报告而困惑）。**用户重启后实测**：apiproxy 发 delete 无害命令 → status 变 "未找到该记录" ✅（host 命令链路最终确认可用；遗留 React key 警告无关紧要）。**待验证**：用户主动点击生成报告/查看/删除（此前因反复重启未真正点过）。

## 9.9 分析模式功能（mode: both/genshin/sr，2026-08-19 凌晨新增）

- **需求**：现有只支持"原神+崩铁连体"分析；新增 ①仅原神 ②仅崩铁 两种模式。
- **实现**（runner.js + client.js，host 无需改——params 自由透传）：
  - **参数**：`mode: "both" | "genshin" | "sr"`（默认 both）。
  - **列表地址**：原神 `goodsList/12`、崩铁 `goodsList/213`（新增常量 `LIST_URL_GENSHIN`/`LIST_URL_SR`；sr 地址从会话+runner 现有 fetchSrLinkedList 确认）。
  - **仅原神（genshin）**：fetchList 用 12 列表但**跳过点崩铁筛选**；详情 `if (hasSR && mode!=='genshin')` **跳过崩铁点击**；筛选不筛连体崩铁；报告只显示原神分/资源分列。
  - **仅崩铁（sr）**：走 fetchSrLinkedList（213 列表）但**不筛连体原神**（返回全部崩铁账号）→ `scoreSrFromTitle` 标题解析崩铁角色+资源 → 报告只显示崩铁分/崩铁资源列（绕详情页 WAF，与既有 srList 方案一致）。
  - **连体（both）**：现状不变。
  - **报告**：buildReport/detailCell 加 mode 参数（标题、表格列、明细、资源段按模式显示）；sr 模式的 scoreSrFromTitle 输出补全为 buildReport 兼容形状（genshin:0 等）。
- **验证**：runner 语法 OK；buildReport 三模式测试全过（标题/列/明细断言）；client 渲染测试确认"分析模式"下拉（原神+崩铁连体/仅原神/仅崩铁）出现且 formToParams 透传 mode。client 已同步运行时。**需重启 Harness 生效**；真实验证需用户跑（依赖登录态 Chrome + CDP）。
- **⚠️ 修正：仅崩铁模式改为详情页抓取（2026-08-19 凌晨，用户指出标题解析不全）**：`scoreSrFromTitle`（标题解析）只能拿到标题里的角色/资源，很多账号数据在详情页。**改为**：sr 模式 = 213 列表（fetchSrLinkedList 不筛连体）→ **`cdpFetchDetailsParallel` 的 fetchOne 新增 `P.mode==='sr'` 分支**（详情页主体即崩铁账号：轮询找"点击查看五星角色属性"标记段、必要时点含"开拓等级"的卡展开，srText 复用连体 findSrMark 思路，`parseSRText` 解析角色 + `extractResources` 提取资源，`gensChars:[]`）→ `scoreGoods` 评分（只算崩铁，测试验证 genshin=0/sr>0/total=sr+srRes）。**runner.js 每次运行是新进程，改动即时生效，无需重启 Harness**；client 的 mode 下拉需重启出现。

## 9.10 两步式：数据抓取与分析解耦（2026-08-19 深夜）

- **需求**：改计分规则不应重新抓取网站。**第一步"获取数据"抓取保存；第二步"分析报告"用本地数据评分出报告（可反复调规则）。**
- **runner.js**：新增 `action: "fetch" | "analyze" | "report"`（默认 report=抓+分析，兼容旧行为）。主流程重构：①fetch/report 抓列表+详情并存 `details.json`（fetch 后写 `result.json`=`{fetchCount,mode,message:'数据已获取'}` 退出）；②analyze 读 `details.json`（无 CDP/Chrome）→ 筛选 → scoreGoods → 报告；③CDP 检查仅在 `action!=='analyze'` 时执行。
- **client.js**：按钮改为「获取数据」「分析报告」「停止」；fetchData 发 `action:"fetch"`、analyze 发 `action:"analyze"`；状态提示两步流程。
- **host**：finalStatus.message 改为优先用 `result.message`（fetch 显示"数据已获取"）。
- **⚠️ 踩坑（血泪）**：**PowerShell `Set-Content -Encoding UTF8` 写 JSON 带 BOM** → runner `JSON.parse` 抛错 → `args={}` → **误走默认 report 模式触发真实抓取 + 自动启动调试 Chrome**（发生两次！用户网站被风控拦截）。**修复**：写 JSON 用 `[System.IO.File]::WriteAllText(path, json, UTF8Encoding($false))` 无 BOM。**教训：给 runner 传参必须无 BOM；测试 runner 前确认无并发抓取进程 + 只杀精确 PID（曾误杀 dsh server 进程导致 Harness 崩溃，用户重启恢复）。**
- **✅ 验证（2026-08-19 深夜）**：details.json（180 个崩铁账号）→ analyze 零抓取 → 生成崩铁报告（154 账号，¥554453，总分 371899.7）。**网站被拦截期间只能点"分析报告"（安全），别点"获取数据"。**
- **数据现状**：details.json=180 崩铁账号（146 有 srText）；20:41 连体报告、23:23 原神报告的**原始详情已被后续抓取覆盖**（单一 details.json），仅报告 HTML 保留（含角色命座+资源数量，如需可从中提取重建 analyze 数据）。

## 9.11 数据集架构（2026-08-20 凌晨）：数据 ↔ 报告 1:1 覆盖

- **需求（用户设计）**：原始数据列表展示（像历史报告）；点击某条数据的"分析"→ 生成该数据集的报告；**1 个数据集只对应 1 份报告，重复分析覆盖**（干净结构）。
- **runner.js**：
  - **fetch**：每次"获取数据"创建数据集 `datasets/{id}/data.json` + 更新 `datasets/index.json`（id=时间戳、time、mode、count、reportFile、updatedAt），`result.json` 带 `datasetId`。
  - **analyze**：读 `datasets/{datasetId}/data.json`（缺省取最新；兜底旧 details.json）→ 评分 → 报告写 **`datasets/{id}/report.html`（覆盖）** → 更新 index 的 reportFile/lastResult。
  - **report（抓+分析，兼容）**：创建数据集后写 `datasets/{id}/report.html`。
  - **history.json 写入已移除**（数据集 index 即唯一历史）。
- **host**：`history` 字段改为读 `datasets/index.json`（数据集列表）；`deleteHistory` 改为 `deleteDataset`（删目录+index+报告）。
- **client**：顶部仅「获取数据」「停止」；下方**数据集表格**（时间/模式/账号数/报告状态 + 操作：分析/查看/删除）；`analyzeDataset(id)` 发 `action:"analyze",datasetId`；`pathOf` 相对路径转绝对。
- **✅ 验证**：迁移旧 details.json → 数据集 `20260819161350`（180 崩铁账号）；analyze 两次 → 同一 `datasets/20260819161350/report.html` 覆盖（507KB），index 更新 reportFile/lastResult。**需重启 Harness 加载数据集版 client**（0:05 重启的实例是两步版，数据集 UI 未加载）。
- **⚠️ "分析没反应"根因（2026-08-20 凌晨最终定位）**：**client 的 `settingsScope.set` 挂起**（SettingsScopeController 的 enqueue/write 队列不 resolve；host 侧 apiproxy 直连 mutate 全部正常——已用 node fetch 模拟验证）。**修复**：client 的 fetchData/analyzeDataset/stop/openReport/deleteHistory **全部改用直接 `fetch('/api/settings.mutate')`**（`apiMutate` helper，绕过 settingsScope 写入队列；读取/订阅仍走 boundSettings）。**✅ 模拟验证**：apiMutate(params+command) → host → runner → finished。**同时移除页面 top 表格**（用户认为无用）。
- **⚠️ 数据源"只剩一份"说明（用户疑问）**：旧数据（20:41 连体报告、23:23 原神报告）的**原始详情被单一 details.json 覆盖**（架构缺陷：每次抓取写同一文件），**报告 HTML 仍完整保留**（`reports/` 下 962KB/1075KB 两份，含全部角色命座+资源数量，可查看；如需重建为可分析的数据集可从 HTML 提取）。
- **✅ 数据恢复 + 设计验证（2026-08-20）**：用户的设计（每份数据独立、点哪份分析哪份）本就正确，旧实现单一文件覆盖是实现的错。已从两份报告 HTML **提取重建为独立数据集**（`logs/extract-reports.js`）：`20260819124155`（连体，301 账号，244 原神角色/267 崩铁）、`20260819152320`（原神，729 账号，646 原神角色/684 资源）。**analyze 验证**：各自生成独立的 `datasets/{id}/report.html`，互不影响（3 份数据集：连体 301 + 原神 729 + 崩铁 180）。重建数据 `mailInfo:true`（报告无此信息，分析时不勾"仅未绑定邮箱"则无影响）。
