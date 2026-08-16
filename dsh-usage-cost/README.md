# dsh-usage-cost

DeepSeek Harness 用量与费用统计插件：左侧栏底部按钮 + 左停靠统计面板，按**会话 / 模型 / 总计**实时展示 token 用量与消耗费用（类似 DeepSeek 官网的统计页），支持一键停用/启用。

- **宿主半**（`lib/index.js`）：注册 `usage-cost` 设置命名空间（启用开关 + 每模型价格表），并注册一个极简 `usageCost` 会话投影单元，跟踪每个会话当前使用的 provider/model。
- **浏览器半**（`client.js`）：读取每会话现成的 `tokenUsage` 投影（token-meter 从持久日志折叠出的 provider 上报用量）+ 本插件的 `usageCost` 投影，客户端实时计算费用——零 RPC、零宿主状态。

## 界面

- **左侧栏底部**新增一个带今日费用角标的按钮（`sidebar.footer.action`）。
- 点击后在左侧展开 **320px 固定面板**（`shell.overlay` 左停靠）：总费用、总 tokens、计费输入、输出、缓存命中率、会话数；「全部 / 今日」切换；按模型分解（带占比条）；会话明细列表（按费用排序）。
- 面板头部有**停用**开关；停用后按钮与面板隐藏，可在设置里或 `settings.yaml` 重新启用。

## 计价

费用 = token 桶 × 每百万 token 单价：

```
费用 = (未缓存输入 + 缓存写入) × cacheMissInput
     + 缓存读取 × cacheHitInput
     + 输出 × output
```

- 计费输入 = 未缓存输入 + 缓存读取 + 缓存写入（与聊天统计行的口径一致）。
- **缓存写入按未命中价计费**（DeepSeek 官方口径）。
- **内置价格为 DeepSeek 官方现行价**（2026-08-16，单位 CNY/百万 tokens，来源 [官方价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)）：

| 模型 | 输入·缓存命中 | 输入·缓存未命中 | 输出 |
|---|---|---|---|
| deepseek-v4-flash | ¥0.02 | ¥1 | ¥2 |
| deepseek-v4-pro | ¥0.025 | ¥3 | ¥6 |

> ✅ **峰谷自动计价已内置**（官方 2026-08-17 方案，默认开启）：高峰时段 9:00–12:00、14:00–18:00（北京时间），**空闲自动按高峰半价**。每条回复按**该轮实际发生时间**计价，面板/按钮按当前时刻计价并显示「当前：高峰/空闲时段费率」徽标。高峰费率表（每百万 tokens / CNY）：

| 模型 | 高峰·缓存命中 | 高峰·缓存未命中 | 高峰·输出（空闲=一半） |
|---|---|---|---|
| deepseek-v4-flash | ¥0.10 | ¥3.0 | ¥9.0 |
| deepseek-v4-pro | ¥0.30 | ¥9.0 | ¥27.0 |

> 若关闭峰谷（`peaking: false`），回退到上表平坦价。

### 配置

设置命名空间 `usage-cost`，两种改法任选：

1. **设置 → 插件配置 → usage-cost**（需要安装脚本为 apiproxy 白名单打过补丁；见下）。
2. 直接编辑 `$DSH_HOME/settings.yaml`（即 `~/.dsh/settings.yaml`，宿主热重载）：

```yaml
usage-cost:
  enabled: true
  currency: CNY
  defaultModel: deepseek-v4-flash
  prices:
    deepseek-v4-flash:
      cacheMissInput: 1
      cacheHitInput: 0.02
      output: 2
    deepseek-v4-pro:
      cacheMissInput: 3
      cacheHitInput: 0.025
      output: 6
  # ── 峰谷计价（8/17 起官方方案，默认开启）──
  peaking: true
  timezone: Asia/Shanghai
  peakHours: [[9, 12], [14, 18]]
  peakPrices:
    deepseek-v4-flash:
      cacheMissInput: 3
      cacheHitInput: 0.1
      output: 9
    deepseek-v4-pro:
      cacheMissInput: 9
      cacheHitInput: 0.3
      output: 27
```

## 安装

```powershell
# 在插件源码目录执行（幂等，可重复运行；改完代码后重跑即刷新安装）
.\install.ps1
# 然后重启 Harness（浏览器半与 apiproxy 白名单需重启生效）
```

安装脚本做四件事：

1. 把插件复制到运行时安装目录：`<runtime>\node_modules\dsh-usage-cost\`（真实目录，保证 `@deepseek-ai/*` 依赖可解析）。
2. 在 `~/.dsh/profiles/node_modules\dsh-usage-cost` 建 junction 指向上述目录（profile loader 从此解析）。
3. 在 `~/.dsh/profiles/web/cordis.patch.yml` 追加挂载行（宿主半支持热挂载；浏览器半仍需重启）。
4. 给 apiproxy 的 `WEB_SETTINGS_NAMESPACES` 白名单追加 `"usage-cost"`（否则浏览器读不到设置命名空间，面板会退回内置默认价并在面板内提示）。

### 手动安装（不想跑脚本时）

```powershell
$src = "C:\path\to\dsh-usage-cost"
$rt  = "C:\Users\<you>\AppData\Roaming\DeepSeek Harness\dsh-runtime"
# 1) 复制到运行时
Copy-Item $src (Join-Path $rt "node_modules\dsh-usage-cost") -Recurse -Force
# 2) profile 链接
New-Item -ItemType Junction -Path "C:\Users\<you>\.dsh\profiles\node_modules\dsh-usage-cost" -Target (Join-Path $rt "node_modules\dsh-usage-cost")
# 3) 在 ~/.dsh/profiles/web/cordis.patch.yml 追加：
#    - id: usage-cost
#      name: dsh-usage-cost
# 4) 编辑 <runtime>\node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js，
#    在 WEB_SETTINGS_NAMESPACES 数组里加 "usage-cost"
```

## 卸载

- 从 `cordis.patch.yml` 删除挂载行。
- 删除 `<runtime>\node_modules\dsh-usage-cost` 与 `~/.dsh/profiles\node_modules\dsh-usage-cost`。
- 从 apiproxy 白名单移除 `"usage-cost"`。
- 重启 Harness。

## 测试

```powershell
node test-host.mjs          # 宿主半：fake ctx 跑真实 apply()，验证命名空间/投影单元/fold（10 项断言）
node test-client-render.mjs # 客户端半：真实 react-dom/server 渲染组件树，断言计价数值（16 项断言）
```

两套测试都直接驱动运行时里安装的真实模块/代码，不依赖浏览器或 Harness 实例。

## 已知限制

- **「今日」按会话 `updatedAt` 的日历日近似**（会话级，不是按请求时间精确拆分）。
- **会话中途切换过模型的，按当前模型对全部 token 计价**（v1 近似；准确拆分需要 fold 请求历史）。
- **用量只统计 provider 上报的 usage**（与 token-meter 的 `tokenUsage` 口径一致；压缩摘要等无 usage 上报的请求不计入，官方统计行同样如此）。
- **实时性 = 每个请求结算后更新**（usage 落日志后投影推送），不是逐 token 滚动。
- 价格表默认值仅供参考；`cacheHitInput` 等请以 [DeepSeek 官方价格页](https://api-docs.deepseek.com/quick_start/pricing/) 为准。
