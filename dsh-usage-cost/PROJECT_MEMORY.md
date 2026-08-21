# PROJECT_MEMORY

> 本文件是 **dsh-usage-cost 插件项目**的记忆，随源码存于仓库 `dsh-desktop` 内的 `dsh-usage-cost\`。
> 仓库根是**桌面应用项目**（用户把 Harness 做成 Windows 桌面应用），
> 它的记忆在仓库根 `PROJECT_MEMORY.md`（含硬性协作规则、发布流程等）——两个项目在同一 git 库内，不要混淆。
> **硬性规则（来自桌面应用记忆，同样适用）**：清理进程必须用精确 PID，禁止宽泛 `Stop-Process -Name`；
> 不误杀用户正在运行的 Harness（端口 3080）。

## 项目：dsh-usage-cost —— DeepSeek Harness 用量与费用统计插件

为 DeepSeek Harness（桌面 app，Electron）开发的本地插件：实时统计 token 用量与费用（按会话/模型/总计），左侧外置计费窗口，每条回复末尾的「本轮」费用标签，峰谷自动计价。

**当前状态：功能完整、已上线、用户确认可用。** 最后验证日期：2026-08-16。

---

## 1. 源码位置（唯一真源，改这里）

```
C:\Users\16667\Desktop\dsh\dsh-desktop\dsh-usage-cost\
├── lib/index.js        # 宿主半（ESM）：设置命名空间 + 2 个投影单元
├── client.js           # 浏览器半（CJS factory，无构建步骤，手写）
├── package.json        # dsh.client 声明（platform: web）
├── install.ps1         # 幂等安装脚本（改完代码后重跑 + 重启 Harness）
├── README.md           # 完整文档（计价口径、配置、卸载）
├── test-host.mjs       # 宿主半集成测试（17 项断言）
├── test-client-render.mjs  # 客户端渲染测试（32 项断言）
└── restart-harness.ps1 # 辅助重启脚本（沙箱环境慎用，见 §7）
```

## 2. 架构

**宿主半**（`lib/index.js`，经 `~/.dsh/profiles/web/cordis.patch.yml` 的 `- insert:` 挂载）：
- `usage-cost` 设置命名空间（schemastery schema）：`enabled / currency / defaultModel / prices / peaking / peakingStart / timezone / peakHours / peakPrices`
- 投影单元 `usageCost`：每会话当前 provider/model（从 `request/context`）
- 投影单元 `usageCostByTurn`：每轮用量桶 `{turn: {inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, model, time}}`，带 (turn,step) 重试去重语义 —— **「本轮」标签的主数据源**，走与 tokenUsage 同一条投影通道（已验证可靠）

**浏览器半**（`client.js`，无构建步骤，`window.__ModuleLoader__.load` CJS factory）：
- `sidebar.footer.action`：计费按钮 = **唯一开关**（点开/再点关外置窗口；窗口被阻塞时回退应用内停靠面板）
- `shell.overlay`：统计面板（全屏外置模式 `?usage-cost=1#usage-cost` / 应用内停靠两种形态）
- `conversation.chat.assistant-actions`：「本轮 ¥xx」标签（**列表槽位，保证渲染**——之前试过 turnTail 链式槽位不渲染，勿回退）
- 计价全部客户端计算：`tokenUsage` 投影（用量）× `usageCost`/`usageCostByTurn`（模型/轮次）× 价格表（设置）

## 3. 安装状态（已装好，勿重复安装）

- 运行时：`C:\Users\16667\AppData\Roaming\DeepSeek Harness\dsh-runtime\node_modules\dsh-usage-cost\`（真实目录）
- profile 链接：`C:\Users\16667\.dsh\profiles\node_modules\dsh-usage-cost`（junction → 运行时目录）
- 挂载行：`~/.dsh/profiles/web/cordis.patch.yml`（**必须是 `- insert:` 块**，裸行会被整文件拒绝）
- apiproxy 白名单：**rc.7 起已不需要**（上游删除 `WEB_SETTINGS_NAMESPACES`，所有已注册设置命名空间自动对 Web 客户端放行）；rc.6 及更早由 `install.ps1` / `prepare-runtime.ps1` 自动补丁（两个脚本均已兼容：匹配不到就跳过）
- 用户配置：`~/.dsh/settings.yaml` 有 `usage-cost:` 段（官方现行价 + 默认模型）

**运行方式**：用户端 `D:\Program Files\DeepSeek Harness` **已卸载（2026-08-16，仅验证用）**，此后统一用**开发端** `C:\Users\16667\Desktop\dsh\dsh-desktop\release-upd\win-unpacked\DeepSeek Harness.exe`。两端共用同一运行时 tarball（sha256 一致）+ 同一 `~/.dsh` 数据目录，插件对开发端同样生效，**无需重装**。

> ⚠️ **更新覆盖风险**：app 启动时若安装包内 `dsh-runtime.sha256` 与已解压目录旁的不一致（依赖变化/新版本），会**自动删旧重解压** → `node_modules\dsh-usage-cost` 会被**清掉**。症状：插件按钮消失。**恢复 = 重跑 `install.ps1` + 重启**。（apiproxy 白名单补丁 rc.7 起已无此项，脚本自动跳过；重解压后 `main.js` 启动时会幂等重建挂载行 + junction。）

> ✅ **随 app 分发已实施（方案 A，2026-08-16）**：插件已烘焙进桌面应用的运行时构建管线
> （`dsh-desktop\scripts\prepare-runtime.ps1` 复制插件 + 打白名单补丁（rc.7+ 自动跳过）；`main.js` 启动时幂等写挂载行 + junction）。
> **2026-08-18 运行时核心已升 rc.7**（未发布）：rc.7 删除了 apiproxy 白名单机制，usage-cost 命名空间自动放行，无需补丁。发布前需用新版 win-unpacked 实机验证插件。
> **其他设备装 app 即自动带插件，且每次构建重新烘焙、免疫重解压清空**。装有新版 app 的设备无需手动
> `install.ps1`；本机开发迭代仍用它。

**更新流程**：改源码 → `install.ps1`（幂等）→ **重启 Harness**。⚠️ 桌面 app 端**没有开发者工具、Ctrl+F5 不生效**，唯一生效方式就是重启（见 §7）。

## 4. 功能清单（全部用户确认可用）

| 功能 | 说明 |
|---|---|
| 外置计费窗口 | 左侧粘连（16px 重叠自校正）、同高、拖动跟随（rAF 60fps）、可解粘/恢复（外置窗头部🔗） |
| 按钮=唯一开关 | 点开/再点关；面板内无任何自带关闭/停用按钮（用户明确要求） |
| 关 Harness 窗口联动关计费窗 | `visibilitychange`（窗口隐藏到托盘时）为主力；`beforeunload/pagehide`/心跳/后端探活/opener 自检兜底 |
| 「本轮 ¥xx」标签 | 每条回复操作行旁，悬停看 tokens/模型；按该轮时间峰谷计价 |
| 统计面板 | 总费用/总Tokens/计费输入/输出/缓存命中率/会话数；**全部/今日/本周/本月** 标签页；按模型分解；会话明细 |
| 官方价格 | v4-flash 0.02/1/2、v4-pro 0.025/3/6（CNY/百万）；**8/17 起峰谷自动生效**（peakingStart 门控） |
| 停用开关 | 仅 settings.yaml / 设置页（面板内已移除） |

## 5. 测试（改完必跑）

```powershell
node test-host.mjs         # 宿主：命名空间/两投影单元/fold 语义（17 断言）
node test-client-render.mjs # 客户端：真实 react-dom/server 渲染断言（32 断言）
```

测试直接驱动**运行时副本**（test-host 用绝对路径 import 运行时 lib），改完源码必须跑 install.ps1 同步后再测宿主侧。

## 6. 已知限制与待办

- **8/17（明天）峰谷自动切换**：peakingStart="2026-08-17" 已内置；峰值表 flash 0.10/3.0/9.0、pro 0.30/9.0/27.0，空闲=高峰一半。如需按请求时间精确拆分峰谷（目前逐轮标签按轮次时间、面板按当前时刻），需要宿主导入每请求时间戳——待办
- **粘连间隙**：自校正 + 16px 重叠已吸收大部分环境误差；外置窗底部有「吸附偏差 Npx」实时读数，用户若反馈有缝可按差值加补偿
- **窗口类型未知**：外置窗口可能是系统浏览器标签页（localStorage 与 Harness 隔离）——close()/心跳可能无效，visibilitychange 已验证可用（用户确认"关窗留托盘"场景正常）
- **插件列表 UI 只读**：启用/停用整个插件只能靠改 cordis.patch.yml 或 settings.yaml 的 enabled
- 卸载：删挂载行 + 删运行时目录/junction + 撤白名单（rc.7+ 无白名单，跳过）+ 重启（README 有详细步骤）

## 7. 关键环境事实（血泪教训，勿重蹈）

1. **桌面 app 端无开发者工具（F12 无效）、Ctrl+F5 不生效** —— 用户每次只能靠**重启 Harness** 加载新代码。所有"请强刷/F12 看报错"的调试手段都无效，不要再用
2. **关 Harness 窗口 ≠ 退出程序**：点 X 只是隐藏到托盘（右下角），**后端进程不死**、窗口 JS 继续跑。这是桌面应用的**设计行为**（见 `dsh-desktop\PROJECT_MEMORY.md` §3.1"关窗驻留托盘"），不是 bug。因此后端探活、心跳过期都无法感知"窗口关闭"——只有 `visibilitychange`（窗口隐藏时页面可见性变 hidden）能触发；托盘右键强退时 beforeunload/pagehide 才有效
3. **cordis.patch.yml 是补丁层**：新增插件必须用 `- insert:` 块；裸 `- id:` 行会报 `patch: entry not found` 且**整文件被拒**。诊断命令：`node <runtime>\node_modules\@deepseek-ai\dsh\lib\bin.js --profile web --dump-config`（需写权限）
4. **turnTail 链式槽位在本构建不渲染**（file-mentions 那条链的 select 机制与此插件的场景不兼容或未被触发），已放弃；`assistant-actions` 列表槽位保证渲染
5. **useSyncExternalStore 的 getSnapshot 必须返回稳定引用**：曾因每次返回新对象导致无限重渲染循环、面板崩溃、外置窗显示 harness 本体（那次"内容丢失"的真凶）
6. **宿主改动（新投影单元/schema）需要重启**才生效；客户端 bundle 改完 install.ps1 同步后重启即生效
7. 网络：沙箱 TLS 默认不可用（SEC_E_NO_CREDENTIALS），但 **danger-full-access 下 curl 可访问外网**（官方价格页就是这么抓的）；官方价格页 https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
8. 运行时与 profile：`~/.dsh/profiles/node_modules` 是指向运行时安装的 junction 集合（healProfilesModuleFallback 生成）；插件要真实目录在运行时 node_modules 里才能解析 @deepseek-ai 依赖

## 8. 配置速查（settings.yaml）

```yaml
usage-cost:
  enabled: true
  currency: CNY
  defaultModel: deepseek-v4-flash
  prices:                       # 8/17 前官方现行价（平坦）
    deepseek-v4-flash: { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 }
    deepseek-v4-pro:   { cacheMissInput: 3, cacheHitInput: 0.025, output: 6 }
  peaking: true                 # 8/17 起峰谷自动生效
  peakingStart: "2026-08-17"
  timezone: Asia/Shanghai
  peakHours: [[9, 12], [14, 18]]
  peakPrices:                   # 高峰价；空闲自动半价
    deepseek-v4-flash: { cacheMissInput: 3, cacheHitInput: 0.1, output: 9 }
    deepseek-v4-pro:   { cacheMissInput: 9, cacheHitInput: 0.3, output: 27 }
```

计价公式：`(未缓存输入 + 缓存写入) × cacheMissInput + 缓存读取 × cacheHitInput + 输出 × output`（每百万 token 单价，缓存写入按未命中价）。

## 9. 后续对话衔接建议

- 用户若要继续迭代，先读本文件 + `dsh-usage-cost/README.md`，再改源码、跑 install.ps1、让用户重启
- 上轮对话最后确认的体验闭环：**按钮开/关外置窗 + 关 Harness 窗口联动关 + 「本轮」标签正常显示**，用户对这三项满意
- 可能的方向：峰谷按请求时间精确拆分、面板加图表（日/周柱状图）、「本轮」标签位置回到回复末尾（基于已验证的列表槽位做）
