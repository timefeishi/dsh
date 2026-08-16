/**
 * Client-half render test: loads the REAL client.js bundle, drives its
 * apply() through a fake Cordis client context, then renders the registered
 * components with react-dom/server and asserts the computed figures.
 * Run: node test-client-render.mjs
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const requireFromRuntime = createRequire("C:/Users/16667/AppData/Roaming/DeepSeek Harness/dsh-runtime/x.js");
const React = requireFromRuntime("react");
const jsxRuntime = requireFromRuntime("react/jsx-runtime");
const { renderToString } = requireFromRuntime("react-dom/server");

// ── load the real bundle (workspace copy — identical to the installed one) ──
let loaded = null;
globalThis.window = { __ModuleLoader__: { load: (spec) => { loaded = spec; } } };
globalThis.document = undefined;
eval(readFileSync(new URL("./client.js", import.meta.url), "utf8"));
if (!loaded) throw new Error("bundle did not call __ModuleLoader__.load");

const mod = loaded.factory((spec) => {
  if (spec === "react") return React;
  if (spec === "react/jsx-runtime") return jsxRuntime;
  throw new Error("unexpected require: " + spec);
});

// ── zh dictionary (mirror of the bundle's, for realistic t()) ──
const zh = {
  "button.label": "用量 {cost}",
  "panel.title": "用量与费用",
  "panel.enable": "启用",
  "panel.disable": "停用",
  "panel.disabled": "用量统计已停用",
  "panel.loading": "加载中…",
  "period.all": "全部",
  "period.today": "今日",
  "period.week": "本周",
  "period.month": "本月",
  "stat.totalCost": "总费用",
  "stat.totalTokens": "总 Tokens",
  "stat.billedInput": "计费输入",
  "stat.cacheHit": "缓存命中率",
  "stat.output": "输出",
  "stat.sessions": "会话",
  "session.title": "会话明细",
  "model.title": "按模型",
  "empty": "暂无用量数据",
  "turnCost.label": "本轮 {cost}",
  "turnCost.title": "本轮 {tokens} tokens · {model}",
  "regime.peak": "当前：高峰时段费率",
  "regime.offpeak": "当前：空闲时段费率（半价）",
  "tokens": "tokens"
};
const t = (key, params) => {
  const text = zh[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (_, k) => String(params[k])) : text;
};

// ── fake client ctx ──
const registrations = [];
let testSettings = {
  status: "ready",
  value: {
    enabled: true,
    currency: "CNY",
    defaultModel: "deepseek-v4-flash",
    peaking: false, // flat pricing for the panel/button assertions below
    prices: {
      "deepseek-chat": { cacheMissInput: 2, cacheHitInput: 0.5, output: 8 },
      "deepseek-reasoner": { cacheMissInput: 4, cacheHitInput: 1, output: 16 }
    }
  }
};
const fakeCtx = {
  effect() {},
  locale: { register() {} },
  conversationEvents: { register() {} },
  settingsScope: {
    bind() {
      return {
        getSnapshot: () => testSettings,
        subscribe: () => () => {}
      };
    }
  },
  slots: {
    inject(_name, cb) { cb(); },
    register(opts, Component) { registrations.push({ opts, Component }); return () => {}; }
  }
};
mod.apply(fakeCtx);

const buttonReg = registrations.find((r) => r.opts.name === "sidebar.footer.action");
const panelReg = registrations.find((r) => r.opts.name === "shell.overlay");
if (!buttonReg || !panelReg) throw new Error("slot registrations missing");

const now = Date.now();
const listState = {
  ids: ["s1", "s2"],
  current: "s1",
  phase: "ready",
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
  byId: {
    s1: {
      id: "s1",
      displayTitle: "会话A",
      blank: false,
      updatedAt: now,
      projectionValues: {
        tokenUsage: { uncachedInputTokens: 1000000, cacheReadTokens: 500000, cacheWriteTokens: 0, outputTokens: 200000 },
        usageCost: { provider: "deepseek-official", model: "deepseek-chat" }
      }
    },
    s2: {
      id: "s2",
      displayTitle: "会话B",
      blank: false,
      updatedAt: now,
      projectionValues: {
        tokenUsage: { uncachedInputTokens: 250000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50000 },
        usageCost: { provider: "deepseek-official", model: "deepseek-reasoner" }
      }
    }
  }
};
const useSessions = (sel) => sel(listState);

let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : ""));
  if (!cond) failures += 1;
}

// ── panel open: render the panel ──
mod.__test.setPanelOpen(true);
let html = renderToString(React.createElement(panelReg.Component, { t, useSessions }));
check("panel renders total cost ¥5.65", html.includes("¥5.65"), html.includes("¥5.65") ? "" : "missing ¥5.65");
check("panel renders session A cost ¥3.85", html.includes("¥3.85"));
check("panel renders session B cost ¥1.80", html.includes("¥1.80"));
check("panel renders total tokens 2M", html.includes("2M"));
check("panel renders billed input 1.8M", html.includes("1.8M"));
check("panel renders cache hit 28.6%", html.includes("28.6%"));
check("panel lists both sessions", html.includes("会话A") && html.includes("会话B"));
check("panel shows model tags", html.includes("deepseek-chat") && html.includes("deepseek-reasoner"));
check("panel shows per-model section", html.includes("按模型"));
check("panel has no self-close/hide controls (button is the single switch)", !html.includes("停用"));

// ── today filter: exercised via the button, which always aggregates "today" ──
listState.byId.s2.updatedAt = now - 48 * 3600 * 1000;
const btnHtmlToday = renderToString(React.createElement(buttonReg.Component, { wide: true, t, useSessions }));
check("button today filter excludes stale session (¥3.85 not ¥5.65)", btnHtmlToday.includes("¥3.85") && !btnHtmlToday.includes("¥5.65"),
  btnHtmlToday.includes("¥3.85") ? "" : "unexpected button badge");
listState.byId.s2.updatedAt = now;

// ── disabled state ──
testSettings = { status: "ready", value: { ...testSettings.value, enabled: false } };
html = renderToString(React.createElement(panelReg.Component, { t, useSessions }));
check("disabled panel shows enable button", html.includes("启用") && html.includes("用量统计已停用"));

// ── button renders when enabled, null when disabled ──
testSettings = { status: "ready", value: { ...testSettings.value, enabled: true } };
let btnHtml = renderToString(React.createElement(buttonReg.Component, { wide: true, t, useSessions }));
check("button shows today cost ¥5.65", btnHtml.includes("¥5.65"));
testSettings = { status: "ready", value: { ...testSettings.value, enabled: false } };
btnHtml = renderToString(React.createElement(buttonReg.Component, { wide: true, t, useSessions }));
check("button hidden when disabled", btnHtml === "");

// ── settings unavailable → default prices still work ──
testSettings = { status: "unavailable", value: undefined };
html = renderToString(React.createElement(panelReg.Component, { t, useSessions }));
check("unavailable settings still renders totals (default prices)", html.includes("总费用"));
btnHtml = renderToString(React.createElement(buttonReg.Component, { wide: true, t, useSessions }));
check("button visible when settings unavailable (default prices)", btnHtml.includes("用量"), btnHtml === "" ? "button returned null" : "");

// ── panel closed → null ──
mod.__test.setPanelOpen(false);
html = renderToString(React.createElement(panelReg.Component, { t, useSessions }));
check("panel closed renders nothing", html === "");

// ── TurnCostChip: per-turn cost label ──
testSettings = {
  status: "ready",
  value: {
    enabled: true,
    currency: "CNY",
    defaultModel: "deepseek-v4-flash",
    peaking: false,
    prices: { "deepseek-v4-flash": { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 } }
  }
};
const turnReg = registrations.find((r) => r.opts.name === "conversation.chat.assistant-actions");
check("assistant-actions list registered for turn cost", !!turnReg, turnReg ? "" : "registration missing");
const useProjectionFor = (byTurn) => (key) => key === "usageCostByTurn" ? byTurn : (key === "usageCost" ? { provider: "deepseek-official", model: "deepseek-v4-flash" } : undefined);
const useProjectionFlash = () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" });
const emptyNodesSession = (sel) => sel({ chat: { legacy: { nodes: [] } } });
const nodesWith = (nodes) => (sel) => sel({ chat: { legacy: { nodes } } });
const turnProps = {
  messageId: "m1",
  t,
  useSession: nodesWith([
    { kind: "assistant", messageId: "m1", turn: 1, step: 1, time: Date.now(),
      usage: { inputTokens: 1000000, cacheReadTokens: 500000, cacheWriteTokens: 0, outputTokens: 200000 } }
  ]),
  useProjection: useProjectionFor({ "1": { inputTokens: 1000000, cacheReadTokens: 500000, cacheWriteTokens: 0, outputTokens: 200000, model: "deepseek-v4-flash", time: Date.now() } })
};
const chipHtml = renderToString(React.createElement(turnReg.Component, turnProps));
// cost = 1e6*1/1e6 + 5e5*0.02/1e6 + 2e5*2/1e6 = 1 + 0.01 + 0.4 = ¥1.41 (projection path)
check("turn cost renders ¥1.41 (projection path)", chipHtml.includes("¥1.41"), chipHtml);
check("turn cost shows token count in title", chipHtml.includes("tokens") || chipHtml.includes("1.7M"));
// fallback path: no projection map → scan chat assistant nodes for usage
const fallbackHtml = renderToString(React.createElement(turnReg.Component, {
  messageId: "m5",
  t,
  useSession: nodesWith([
    { kind: "assistant", messageId: "m5", turn: 5, step: 1, time: Date.now(),
      usage: { inputTokens: 500000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100000 } }
  ]),
  useProjection: useProjectionFor(void 0)
}));
// cost = 5e5*1/1e6 + 1e5*2/1e6 = 0.5 + 0.2 = ¥0.70
check("turn cost renders ¥0.70 (node-scan fallback)", fallbackHtml.includes("¥0.70"), fallbackHtml);
const emptyChipHtml = renderToString(React.createElement(turnReg.Component, {
  messageId: "missing",
  t,
  useSession: emptyNodesSession,
  useProjection: useProjectionFor(void 0)
}));
check("turn cost null without usage", emptyChipHtml === "");

// ── peak/off-peak (峰谷) automatic pricing ──
testSettings = {
  status: "ready",
  value: {
    enabled: true,
    currency: "CNY",
    defaultModel: "deepseek-v4-flash",
    peaking: true,
    peakingStart: "2020-01-01",
    timezone: "Asia/Shanghai",
    peakHours: [[9, 12], [14, 18]],
    prices: { "deepseek-v4-flash": { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 } },
    peakPrices: { "deepseek-v4-flash": { cacheMissInput: 3, cacheHitInput: 0.1, output: 9 } }
  }
};
const peakChip = (nodeTime) => renderToString(React.createElement(turnReg.Component, {
  messageId: "m2",
  t,
  useSession: nodesWith([
    { kind: "assistant", messageId: "m2", turn: 2, step: 1, time: nodeTime,
      usage: { inputTokens: 1000000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } }
  ]),
  useProjection: useProjectionFor(void 0)
}));
// 10:00 Asia/Shanghai = peak → 1e6 * 3 / 1e6 = ¥3.00
const peakHtml = peakChip(Date.UTC(2026, 7, 16, 2, 0, 0));
check("peak-hour turn billed at peak rate ¥3.00", peakHtml.includes("¥3.00"), peakHtml);
// 20:00 Asia/Shanghai = off-peak → half → ¥1.50
const offPeakHtml = peakChip(Date.UTC(2026, 7, 16, 12, 0, 0));
check("off-peak turn billed at half rate ¥1.50", offPeakHtml.includes("¥1.50"), offPeakHtml);
// panel regime badge: open the panel and assert the regime line renders
mod.__test.setPanelOpen(true);
html = renderToString(React.createElement(panelReg.Component, { t, useSessions }));
check("panel shows a regime badge with peaking on", html.includes("dsh-uc-regime"), html.includes("dsh-uc-regime") ? "" : "no regime badge");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
