/**
 * dsh-usage-cost — browser half.
 *
 * Two slot entries, both root-scope:
 *  - `sidebar.footer.action` — a compact button at the sidebar foot (rail or
 *    wide) showing today's total cost, toggling the panel.
 *  - `shell.overlay` — a left-docked stats panel: per-session / per-model /
 *    total token usage and real-time cost, plus a master enable switch.
 *
 * Data: every session row already carries the token-meter `tokenUsage`
 * projection (provider-reported buckets) and this plugin's `usageCost`
 * projection (provider/model) in `SessionSummary.projectionValues`, so the
 * panel is pure client-side computation — no RPCs, no host state.
 *
 * This file is hand-written CJS for the client ModuleLoader
 * (`window.__ModuleLoader__.load`) — no build step. Externals resolve through
 * the loader's require: `react` (app-shell statics) and the packages listed
 * under `dsh.client.inject` in package.json.
 */
window.__ModuleLoader__.load({
	id: "dsh-usage-cost",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		const { jsx, jsxs } = react_jsx_runtime;

		// ── styles ────────────────────────────────────────────────────────────
		// Uses ONLY theme tokens that exist in the ui-theme defaults
		// (--dsw-alias-bg-*, --dsw-alias-border-*, --dsw-alias-label-*,
		// --dsw-alias-brand-primary); no hardcoded dark fallbacks, so the panel
		// follows the active light/dark theme.
		const css = `
.dsh-uc-railButton{min-height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:4px;padding:3px 4px;font-size:12px;line-height:18px;display:inline-flex;text-decoration:none;width:100%}
.dsh-uc-railButton:hover,.dsh-uc-railButton:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.dsh-uc-railButton[aria-pressed="true"]{color:var(--dsw-alias-label-primary)}
.dsh-uc-railButton svg{flex:none}
.dsh-uc-railButton .dsh-uc-badge{margin:0 0 0 auto;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:96px}
.dsh-uc-panel{position:fixed;left:0;top:0;bottom:0;width:320px;max-width:min(420px,100vw - 72px);z-index:60;box-sizing:border-box;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border-right:1px solid var(--dsw-alias-border-l2);box-shadow:0 8px 32px rgba(0,0,0,.25);font-size:13px;line-height:18px;pointer-events:auto}
.dsh-uc-panel.full{left:0;width:100%;max-width:none;border-right:0}
.dsh-uc-panel *{box-sizing:border-box}
.dsh-uc-header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-uc-title{font-size:14px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-uc-close{cursor:pointer;background:0 0;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;flex:none}
.dsh-uc-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.dsh-uc-close[aria-pressed="true"]{color:var(--dsw-alias-brand-primary)}
.dsh-uc-body{flex:1;min-height:0;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.dsh-uc-strip{display:flex;gap:8px}
.dsh-uc-tabs{display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.dsh-uc-tab{cursor:pointer;border:0;background:0 0;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:3px 10px;font-size:12px;line-height:18px}
.dsh-uc-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay)}
.dsh-uc-switch{cursor:pointer;border:0;border-radius:6px;padding:3px 10px;font-size:12px;line-height:18px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.dsh-uc-switch:hover{color:var(--dsw-alias-label-primary)}
.dsh-uc-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dsh-uc-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px}
.dsh-uc-card.wide{grid-column:1 / -1}
.dsh-uc-cardLabel{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-uc-cardValue{font-size:18px;line-height:26px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-uc-cardValue.small{font-size:13px;line-height:20px}
.dsh-uc-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-uc-section{display:flex;align-items:center;gap:8px;margin-top:2px}
.dsh-uc-sectionTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);flex:1}
.dsh-uc-modelRow{display:flex;align-items:center;gap:8px;padding:5px 2px;font-size:12px;line-height:18px}
.dsh-uc-modelName{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--dsw-font-mono,ui-monospace,monospace)}
.dsh-uc-modelBar{position:relative;flex:1;min-width:40px;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-1)}
.dsh-uc-modelBar > i{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:var(--dsw-alias-brand-primary)}
.dsh-uc-modelStat{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dsh-uc-modelCost{flex:none;font-variant-numeric:tabular-nums;min-width:64px;text-align:right}
.dsh-uc-sessionRow{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:8px;cursor:default}
.dsh-uc-sessionRow:hover{background:var(--dsw-alias-bg-layer-1)}
.dsh-uc-sessionTop{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-uc-sessionTitle{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;line-height:18px}
.dsh-uc-sessionCost{flex:none;font-variant-numeric:tabular-nums;font-size:12px;line-height:18px}
.dsh-uc-sessionMeta{display:flex;align-items:center;gap:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-uc-tag{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:4px;padding:0 6px;font-size:11px;line-height:16px;font-family:var(--dsw-font-mono,ui-monospace,monospace);max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-uc-empty{color:var(--dsw-alias-label-secondary);text-align:center;padding:24px 0}
.dsh-uc-turnCost{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;padding:0 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-1);cursor:default;user-select:none}
.dsh-uc-turnCost:hover{color:var(--dsw-alias-label-primary)}
.dsh-uc-regime{align-self:flex-start;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);padding:2px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.dsh-uc-footer{padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-uc-tetherReadout{margin-left:8px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dsh-uc-liveOk{color:var(--dsw-alias-state-success-primary)}
.dsh-uc-liveDown{color:var(--dsw-alias-state-error-primary)}
.dsh-uc-disabled{display:flex;flex-direction:column;align-items:center;gap:10px;justify-content:center;height:100%;color:var(--dsw-alias-label-secondary)}
`;
		const tagId = "dsh-usage-cost/styles";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-usage-cost";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ── locale ────────────────────────────────────────────────────────────
		const zh = {
			"button.label": "用量 {cost}",
			"button.aria": "打开用量与费用面板（今日 {cost}）",
			"panel.title": "用量与费用",
			"panel.close": "关闭",
			"panel.external": "在外置窗口中打开",
			"tether.attach": "吸附到 Harness 左侧",
			"tether.detach": "解除吸附",
			"panel.enable": "启用",
			"panel.disable": "停用",
			"panel.disabled": "用量统计已停用",
			"panel.disabledHint": "启用后重新显示统计面板。你也可以在 设置 → 插件配置 中管理。",
			"panel.loading": "加载中…",
			"panel.settingsUnavailable": "设置命名空间未暴露，正在使用内置默认价格。",
			"period.all": "全部",
			"period.today": "今日",
			"period.week": "本周",
			"period.month": "本月",
			"stat.totalCost": "总费用",
			"stat.totalTokens": "总 Tokens",
			"stat.billedInput": "计费输入",
			"stat.output": "输出",
			"stat.cacheHit": "缓存命中率",
			"stat.sessions": "会话",
			"model.title": "按模型",
			"session.title": "会话明细",
			"session.unknownModel": "未知模型",
			"empty": "暂无用量数据",
			"turnCost.label": "本轮 {cost}",
			"turnCost.title": "本轮 {tokens} tokens · {model}",
			"regime.peak": "当前：高峰时段费率",
			"regime.offpeak": "当前：空闲时段费率（半价）",
			"footer.prices": "价格可在「设置 → 插件配置 → usage-cost」中修改，或直接编辑 $DSH_HOME/settings.yaml。",
			"footer.tether": "吸附偏差 {delta}px",
			"footer.backendOk": "后端在线",
			"footer.backendDown": "后端失联（即将自关）",
			"tokens": "tokens"
		};
		const en = {
			"button.label": "Usage {cost}",
			"button.aria": "Open usage & cost panel (today {cost})",
			"panel.title": "Usage & Cost",
			"panel.close": "Close",
			"panel.external": "Open in an external window",
			"tether.attach": "Dock to the Harness left edge",
			"tether.detach": "Undock",
			"panel.enable": "Enable",
			"panel.disable": "Disable",
			"panel.disabled": "Usage stats disabled",
			"panel.disabledHint": "Enable to show the stats panel again. You can also manage it in Settings → Plugin config.",
			"panel.loading": "Loading…",
			"panel.settingsUnavailable": "Settings namespace not exposed — using bundled default prices.",
			"period.all": "All",
			"period.today": "Today",
			"period.week": "This week",
			"period.month": "This month",
			"stat.totalCost": "Total cost",
			"stat.totalTokens": "Total tokens",
			"stat.billedInput": "Billed input",
			"stat.output": "Output",
			"stat.cacheHit": "Cache hit",
			"stat.sessions": "Sessions",
			"model.title": "By model",
			"session.title": "Sessions",
			"session.unknownModel": "unknown model",
			"empty": "No usage data yet",
			"turnCost.label": "Turn {cost}",
			"turnCost.title": "This turn: {tokens} tokens · {model}",
			"regime.peak": "Peak-hour rate now",
			"regime.offpeak": "Off-peak rate now (half price)",
			"footer.prices": "Prices are editable in Settings → Plugin config → usage-cost, or directly in $DSH_HOME/settings.yaml.",
			"footer.tether": "Tether delta {delta}px",
			"footer.backendOk": "backend online",
			"footer.backendDown": "backend lost (closing soon)",
			"tokens": "tokens"
		};

		// ── shared panel state (module-level: one bundle instance per page) ──
		// Persisted in localStorage so the docked panel stays open ("常驻")
		// across page reloads; only the X button / Escape closes it.
		let panelOpen = false;
		try {
			if (typeof localStorage !== "undefined") panelOpen = localStorage.getItem("dsh-uc-open") === "1";
		} catch { /* storage unavailable (e.g. SSR test env) */ }
		const panelListeners = new Set();
		function subscribePanel(listener) {
			panelListeners.add(listener);
			return () => panelListeners.delete(listener);
		}
		function getPanelOpen() { return panelOpen; }
		function setPanelOpen(open) {
			if (panelOpen === open) return;
			panelOpen = open;
			try {
				if (typeof localStorage !== "undefined") localStorage.setItem("dsh-uc-open", open ? "1" : "0");
			} catch { /* ignore */ }
			for (const listener of panelListeners) listener();
		}
		// External cost-window open state (drives the sidebar button's pressed
		// look and its open/close toggle).
		let externalOpen = false;
		const externalListeners = new Set();
		function subscribeExternal(listener) {
			externalListeners.add(listener);
			return () => externalListeners.delete(listener);
		}
		function getExternalOpen() { return externalOpen; }
		function setExternalOpen(value) {
			if (externalOpen === value) return;
			externalOpen = value;
			for (const listener of externalListeners) listener();
		}
		/** External full-page mode: open this window at `?usage-cost=1#usage-cost`
		 * (e.g. a second window/tab of the harness) to get a persistent
		 * standalone dashboard that never auto-closes and never overlaps the
		 * app. Accepts the query param OR the fragment — some environments
		 * strip one or the other. */
		function usageCostFullPage() {
			if (typeof location === "undefined") return false;
			const search = typeof location.search === "string" ? location.search : "";
			const hash = typeof location.hash === "string" ? location.hash : "";
			return search.indexOf("usage-cost") !== -1 || hash.indexOf("#usage-cost") === 0;
		}
		/** Whether this window is the external (cost) window — decided ONLY by
		 * the URL markers (`?usage-cost=1` / `#usage-cost`). The main window
		 * never carries them. NOT based on window.opener: a main window with an
		 * opener (some app shells) would otherwise be misclassified, which
		 * would stop its heartbeat writes and even let it close itself on a
		 * backend hiccup. */
		function isExternalWindow() {
			return usageCostFullPage();
		}

		// ── tether (粘连) state ───────────────────────────────────────────────
		// When tethered, the MAIN window keeps the external window docked to its
		// LEFT edge (same height) and follows it when the harness is dragged:
		// it polls its own screenX/screenY/height and moveTo/resizeTo the popup.
		// The preference lives in localStorage and is synced across the two
		// same-origin windows via the `storage` event, so the toggle in the
		// external window controls the tethering performed by the main window.
		const TETHER_OVERLAP = 16;
		let externalWin = null;
		let externalWidth = 340;
		let tethered = false;
		let lastTetherDelta = 0;
		const tetherListeners = new Set();
		try {
			if (typeof localStorage !== "undefined") tethered = localStorage.getItem("dsh-uc-tether") === "1";
		} catch { /* ignore */ }
		// Stable snapshot object for useSyncExternalStore (identity must not
		// change between renders — a fresh object per call would loop forever).
		let tetherSnapshot = { tethered, delta: 0 };
		function subscribeTether(listener) {
			tetherListeners.add(listener);
			return () => tetherListeners.delete(listener);
		}
		function getTetherSnapshot() { return tetherSnapshot; }
		function publishTether() {
			const next = { tethered, delta: lastTetherDelta };
			if (next.tethered === tetherSnapshot.tethered && next.delta === tetherSnapshot.delta) return;
			tetherSnapshot = next;
			for (const listener of tetherListeners) listener();
		}
		function setTethered(value) {
			if (tethered === value) return;
			tethered = value;
			try {
				if (typeof localStorage !== "undefined") localStorage.setItem("dsh-uc-tether", value ? "1" : "0");
			} catch { /* ignore */ }
			publishTether();
			if (value) {
				ensureTetherLoop();
				syncExternalWindow();
			}
		}
		let tetherTimer = null;
		let tetherRaf = null;
		function ensureTetherLoop() {
			if (tetherRaf !== null || tetherTimer !== null) return;
			if (typeof requestAnimationFrame === "function") {
				const frame = () => {
					tetherRaf = requestAnimationFrame(frame);
					tetherTick();
				};
				tetherRaf = requestAnimationFrame(frame);
			} else {
				tetherTimer = setInterval(tetherTick, 100);
			}
		}
		function stopTetherLoop() {
			if (tetherRaf !== null) {
				cancelAnimationFrame(tetherRaf);
				tetherRaf = null;
			}
			if (tetherTimer !== null) {
				clearInterval(tetherTimer);
				tetherTimer = null;
			}
		}
		function tetherTick() {
			if (!externalWin || externalWin.closed) {
				setExternalOpen(false);
				stopTetherLoop();
				return;
			}
			if (!tethered) return;
			if (!syncExternalWindow()) stopTetherLoop();
		}
		/** Snap/resize the external window to hug the harness's left edge.
		 * Self-correcting: measures the popup's REAL right edge (its own
		 * screenX + outerWidth) against the harness's left edge and moves by
		 * the measured delta, so any mismatch between requested and realized
		 * window size is compensated instead of leaving a visible gap.
		 * Returns false when the environment blocks window control. */
		function syncExternalWindow() {
			if (!externalWin || externalWin.closed) return false;
			try {
				const w = externalWidth;
				const h = window.outerHeight || window.innerHeight;
				const targetRight = (window.screenX || 0) + TETHER_OVERLAP;
				const popupRight = (externalWin.screenX || 0) + (externalWin.outerWidth || w);
				const delta = targetRight - popupRight;
				if (delta !== lastTetherDelta) {
					lastTetherDelta = delta;
					publishTether();
				}
				const top = window.screenY || 0;
				if (delta !== 0 || externalWin.screenY !== top) {
					externalWin.moveTo((externalWin.screenX || 0) + delta, top);
				}
				const ch = externalWin.outerHeight || h;
				if (externalWin.outerWidth !== w || ch !== h) externalWin.resizeTo(w, h);
				return true;
			} catch {
				return false;
			}
		}
		// Cross-window preference sync: a toggle in the external window updates
		// this window's tether state too.
		if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
			window.addEventListener("storage", (event) => {
				if (event.key !== "dsh-uc-tether") return;
				const value = event.newValue === "1";
				if (tethered === value) return;
				tethered = value;
				publishTether();
				if (value) syncExternalWindow();
			});
			// Conceptually one unit: closing the harness also closes the cost
			// window (in the external window this no-ops — it never opened one).
			// `beforeunload` + `pagehide` cover normal closes.
			const closeExternalOnUnload = () => {
				try {
					if (externalWin && !externalWin.closed) externalWin.close();
				} catch { /* ignore */ }
			};
			window.addEventListener("beforeunload", closeExternalOnUnload);
			window.addEventListener("pagehide", closeExternalOnUnload);
			// Some desktop apps HIDE to tray/background on close instead of
			// unloading — the window's JS keeps running and the backend stays
			// alive, so neither unload nor the probe fires. Page-visibility
			// still flips to "hidden" when the window is hidden/minimized:
			// treat that as "the harness went away" and close the cost window.
			if (typeof document !== "undefined" && !isExternalWindow()) {
				document.addEventListener("visibilitychange", () => {
					if (document.visibilityState === "hidden") closeExternalOnUnload();
				});
			}
		}
		// External window safety net: if the harness (this window's opener) is
		// ever gone — including abrupt kills that skip unload events — the cost
		// window closes itself. No-op in the main window (no opener).
		if (typeof window !== "undefined" && typeof window.opener !== "undefined" && window.opener && isExternalWindow()) {
			const openerMonitor = setInterval(() => {
				try {
					if (window.opener.closed) window.close();
				} catch { /* cross-origin or already gone */ }
			}, 1000);
			window.addEventListener("pagehide", () => clearInterval(openerMonitor));
		}
		// ── cross-window liveness heartbeat ────────────────────────────────────
		// Works even when the two windows share NO opener relationship (e.g. an
		// Electron environment that opens the popup without a script-opener
		// link): the MAIN window writes a heartbeat to localStorage every
		// second; the external window closes itself once the heartbeat goes
		// stale (~5s after the harness window is gone). A missing heartbeat is
		// treated as unknown, so the popup only closes on a provably stale one.
		if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
			if (!isExternalWindow()) {
				try { localStorage.setItem("dsh-uc-heartbeat", String(Date.now())); } catch { /* ignore */ }
				setInterval(() => {
					try { localStorage.setItem("dsh-uc-heartbeat", String(Date.now())); } catch { /* ignore */ }
				}, 1000);
			} else {
				setInterval(() => {
					try {
						const last = Number(localStorage.getItem("dsh-uc-heartbeat") || 0);
						if (last > 0 && Date.now() - last > 5000) window.close();
					} catch { /* ignore */ }
				}, 2000);
			}
		}
		// ── backend-liveness probe (external window) ───────────────────────────
		// The most robust cross-app close signal: the Harness BACKEND process
		// is the app's life. When the harness quits, its backend dies and this
		// window's requests to it fail — so the external window closes itself
		// after two consecutive failed probes (~6s). Works regardless of window
		// ownership, opener links, or storage sharing. No-op in the main window.
		// The probe status is surfaced in the panel footer so the behavior is
		// observable ("后端在线/失联").
		let liveStatus = { backend: "ok" };
		const liveListeners = new Set();
		function subscribeLive(listener) {
			liveListeners.add(listener);
			return () => liveListeners.delete(listener);
		}
		function getLiveStatus() { return liveStatus; }
		function setLiveStatus(backend) {
			if (liveStatus.backend === backend) return;
			liveStatus = { backend };
			for (const listener of liveListeners) listener();
		}
		if (typeof window !== "undefined" && typeof fetch === "function" && isExternalWindow()) {
			let probeFailures = 0;
			const probe = async () => {
				let ok = false;
				try {
					const controller = new AbortController();
					const timer = setTimeout(() => controller.abort(), 3000);
					const res = await fetch(location.origin + "/", { cache: "no-store", signal: controller.signal });
					clearTimeout(timer);
					if (res.ok) ok = true;
				} catch { /* backend unreachable */ }
				if (ok) {
					probeFailures = 0;
					setLiveStatus("ok");
				} else {
					probeFailures += 1;
					setLiveStatus("down");
					if (probeFailures >= 2) {
						try { window.close(); } catch { /* ignore */ }
					}
				}
			};
			setInterval(probe, 3000);
			probe();
		}

		// ── settings scope (bound in apply) ───────────────────────────────────
		// Official DeepSeek API rates per 1M tokens (CNY), 2026-08-16:
		// flash 0.02/1/2 · pro 0.025/3/6 (hit/miss/output). From 2026-08-17 the
		// peak/off-peak scheme applies: peak hours 9–12 & 14–18 (Asia/Shanghai),
		// off-peak = half of peak. PEAK rates (hit/miss/output):
		//   flash 0.10/3.0/9.0 · pro 0.30/9.0/27.0
		const DEFAULT_PRICES = {
			"deepseek-v4-flash": { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 },
			"deepseek-v4-pro": { cacheMissInput: 3, cacheHitInput: 0.025, output: 6 }
		};
		const DEFAULT_PEAK_PRICES = {
			"deepseek-v4-flash": { cacheMissInput: 3, cacheHitInput: 0.1, output: 9 },
			"deepseek-v4-pro": { cacheMissInput: 9, cacheHitInput: 0.3, output: 27 }
		};
		const DEFAULT_SETTINGS = {
			enabled: true,
			currency: "CNY",
			defaultModel: "deepseek-v4-flash",
			prices: DEFAULT_PRICES,
			peaking: true,
			peakingStart: "2026-08-17",
			timezone: "Asia/Shanghai",
			peakHours: [[9, 12], [14, 18]],
			peakPrices: DEFAULT_PEAK_PRICES
		};
		let boundSettings = null;
		const LOADING_SNAPSHOT = { status: "loading", value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: "memory" };
		/** Stable module-level faces for useSyncExternalStore (identity must not change across renders). */
		function settingsSubscribe(listener) {
			return boundSettings ? boundSettings.subscribe(listener) : () => {};
		}
		function settingsGetSnapshot() {
			return boundSettings ? boundSettings.getSnapshot() : LOADING_SNAPSHOT;
		}
		function useSettings() {
			const snapshot = react.useSyncExternalStore(settingsSubscribe, settingsGetSnapshot, settingsGetSnapshot);
			if (snapshot.status === "ready" && snapshot.value && typeof snapshot.value === "object") {
				return { status: "ready", value: { ...DEFAULT_SETTINGS, ...snapshot.value } };
			}
			return { status: snapshot.status, value: DEFAULT_SETTINGS };
		}

		// ── math helpers ──────────────────────────────────────────────────────
		/** Current date (YYYY-MM-DD) in the configured timezone. */
		function currentDateInTz(timezone) {
			try {
				return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
			} catch {
				const d = new Date();
				return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
			}
		}
		/** Whether the peak/off-peak scheme is in force: enabled AND the
		 * configured start date has passed (before it, FLAT official rates). */
		function peakingActive(value) {
			if (!value.peaking) return false;
			const start = value.peakingStart;
			if (start) {
				const date = currentDateInTz(value.timezone || "Asia/Shanghai");
				if (date < start) return false;
			}
			return true;
		}
		/** Whether `at` (epoch ms; default now) falls inside a peak window. */
		function inPeakHours(peakHours, timezone, at) {
			if (!peakHours || peakHours.length === 0) return false;
			let hour;
			try {
				hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(new Date(at)));
			} catch {
				hour = new Date(at).getHours();
			}
			for (const pair of peakHours) {
				if (!Array.isArray(pair) || pair.length < 2) continue;
				const [start, end] = pair;
				if (hour >= start && hour < end) return true;
			}
			return false;
		}
		function numOr(v, fallback) {
			return typeof v === "number" && Number.isFinite(v) ? v : (typeof fallback === "number" && Number.isFinite(fallback) ? fallback : 0);
		}
		/**
		 * Resolve the effective price entry for `model` at time `at` (epoch ms;
		 * default now). With peaking enabled and a peak entry for the model, the
		 * peak rate applies inside peak hours and HALF of it outside (the
		 * official DeepSeek off-peak rule); otherwise the flat `prices` table is
		 * used as-is.
		 */
		function priceOf(value, model, at) {
			const prices = value.prices && typeof value.prices === "object" ? value.prices : {};
			const p = prices[model] || prices[value.defaultModel] || DEFAULT_PRICES[model] || DEFAULT_PRICES[value.defaultModel] || {};
			if (peakingActive(value)) {
				const peakTable = value.peakPrices && typeof value.peakPrices === "object" ? value.peakPrices : {};
				const peak = peakTable[model] || peakTable[value.defaultModel];
				if (peak && typeof peak === "object") {
					const isPeak = inPeakHours(value.peakHours, value.timezone || "Asia/Shanghai", at || Date.now());
					return {
						cacheMissInput: numOr(isPeak ? peak.cacheMissInput : peak.cacheMissInput / 2, p.cacheMissInput),
						cacheHitInput: numOr(isPeak ? peak.cacheHitInput : peak.cacheHitInput / 2, p.cacheHitInput),
						output: numOr(isPeak ? peak.output : peak.output / 2, p.output)
					};
				}
			}
			return {
				cacheMissInput: numOr(p.cacheMissInput, 0),
				cacheHitInput: numOr(p.cacheHitInput, 0),
				output: numOr(p.output, 0)
			};
		}
		/** Current regime label key for `now` (for the panel's rate hint). */
		function regimeKey(value) {
			if (!peakingActive(value)) return null;
			return inPeakHours(value.peakHours, value.timezone || "Asia/Shanghai", Date.now()) ? "regime.peak" : "regime.offpeak";
		}
		function formatTokens(n) {
			if (!Number.isFinite(n) || n <= 0) return "0";
			if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
			if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
			return String(Math.round(n));
		}
		function formatMoney(v, currency) {
			if (!Number.isFinite(v) || v <= 0) return "0";
			const fixed = v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4);
			if (currency === "CNY") return "¥" + fixed;
			if (currency === "USD") return "$" + fixed;
			return currency ? fixed + " " + currency : fixed;
		}
		function isToday(ms) {
			if (!Number.isFinite(ms)) return false;
			const d = new Date(ms);
			const now = new Date();
			return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
		}
		function isThisWeek(ms) {
			if (!Number.isFinite(ms)) return false;
			const startOfWeek = (d) => {
				const x = new Date(d);
				const day = (x.getDay() + 6) % 7; // Monday-first
				x.setDate(x.getDate() - day);
				x.setHours(0, 0, 0, 0);
				return x;
			};
			return startOfWeek(ms).getTime() === startOfWeek(Date.now()).getTime();
		}
		function isThisMonth(ms) {
			if (!Number.isFinite(ms)) return false;
			const d = new Date(ms);
			const now = new Date();
			return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
		}
		/** `period` is "all" | "today" | "week" | "month" (matched by session
		 * updatedAt — per-request timestamps aren't exposed, so this is the
		 * session-level approximation used across the panel). */
		function collectRows(byId, value, period) {
			const rows = [];
			for (const key of Object.keys(byId)) {
				const s = byId[key];
				if (!s || s.blank) continue;
				const usage = s.projectionValues ? s.projectionValues.tokenUsage : undefined;
				const route = s.projectionValues ? s.projectionValues.usageCost : undefined;
				const model = route && route.model ? route.model : value.defaultModel;
				const price = priceOf(value, model);
				const uncached = usage ? usage.uncachedInputTokens || 0 : 0;
				const cacheRead = usage ? usage.cacheReadTokens || 0 : 0;
				const cacheWrite = usage ? usage.cacheWriteTokens || 0 : 0;
				const output = usage ? usage.outputTokens || 0 : 0;
				const totalTokens = uncached + cacheRead + cacheWrite + output;
				const cost = ((uncached + cacheWrite) * price.cacheMissInput + cacheRead * price.cacheHitInput + output * price.output) / 1e6;
				if (period === "today" && !isToday(s.updatedAt)) continue;
				if (period === "week" && !isThisWeek(s.updatedAt)) continue;
				if (period === "month" && !isThisMonth(s.updatedAt)) continue;
				rows.push({
					id: s.id,
					title: s.displayTitle || s.id,
					model,
					uncached,
					cacheRead,
					cacheWrite,
					output,
					totalTokens,
					cost,
					updatedAt: s.updatedAt || 0
				});
			}
			rows.sort((a, b) => b.cost - a.cost || b.updatedAt - a.updatedAt);
			return rows;
		}
		function sum(rows, key) {
			let n = 0;
			for (const r of rows) n += r[key];
			return n;
		}
		function modelBreakdown(rows) {
			const map = new Map();
			for (const r of rows) {
				let m = map.get(r.model);
				if (!m) {
					m = { model: r.model, cost: 0, totalTokens: 0, uncached: 0, cacheRead: 0, output: 0, sessions: 0 };
					map.set(r.model, m);
				}
				m.cost += r.cost;
				m.totalTokens += r.totalTokens;
				m.uncached += r.uncached;
				m.cacheRead += r.cacheRead;
				m.output += r.output;
				m.sessions += 1;
			}
			return [...map.values()].sort((a, b) => b.cost - a.cost);
		}

		// ── shared icons ──────────────────────────────────────────────────────
		function BarIcon() {
			return jsx("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 16 16",
				fill: "currentColor",
				"aria-hidden": true,
				children: jsxs("g", {
					children: [
						jsx("rect", { x: 1, y: 8, width: 3, height: 7, rx: 0.8 }),
						jsx("rect", { x: 6.5, y: 4, width: 3, height: 11, rx: 0.8 }),
						jsx("rect", { x: 12, y: 1, width: 3, height: 14, rx: 0.8 })
					]
				})
			});
		}
		function CloseIcon() {
			return jsx("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.6,
				strokeLinecap: "round",
				"aria-hidden": true,
				children: jsxs("g", {
					children: [
						jsx("path", { d: "M4 4l8 8" }),
						jsx("path", { d: "M12 4l-8 8" })
					]
				})
			});
		}
		function ExternalIcon() {
			return jsx("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true,
				children: jsxs("g", {
					children: [
						jsx("path", { d: "M13 3L7 9" }),
						jsx("path", { d: "M9 3h4v4" }),
						jsx("path", { d: "M13 9v3.5A1.5 1.5 0 0 1 11.5 14h-7A1.5 1.5 0 0 1 3 12.5v-7A1.5 1.5 0 0 1 4.5 4H8" })
					]
				})
			});
		}
		function LinkIcon() {
			return jsx("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true,
				children: jsxs("g", {
					children: [
						jsx("path", { d: "M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2L7.7 4" }),
						jsx("path", { d: "M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.7" })
					]
				})
			});
		}
		/** 粘连/解除开关 — shown in the external window's header. */
		function TetherToggle({ t }) {
			const snap = react.useSyncExternalStore(subscribeTether, getTetherSnapshot, getTetherSnapshot);
			const on = snap.tethered;
			const label = on ? t("tether.detach") : t("tether.attach");
			return jsx("button", {
				type: "button",
				className: "dsh-uc-close",
				"aria-pressed": on,
				"aria-label": label,
				title: label,
				onClick: () => setTethered(!on),
				children: jsx(LinkIcon, {})
			});
		}

		// ── UsageButton: sidebar foot action ──────────────────────────────────
		function UsageButton({ wide, t, useSessions }) {
			const open = react.useSyncExternalStore(subscribePanel, getPanelOpen, getPanelOpen);
			const extOpen = react.useSyncExternalStore(subscribeExternal, getExternalOpen, getExternalOpen);
			const settings = useSettings();
			const byId = useSessions((state) => state.byId);
			// Hide only when EXPLICITLY disabled. While settings are still
			// loading or unavailable (namespace not exposed / memory mode), keep
			// the button visible and price with the bundled defaults.
			const disabled = settings.status === "ready" && settings.value.enabled === false;
			if (disabled) return null;
			const rows = react.useMemo(() => collectRows(byId, settings.value, "today"), [byId, settings.value]);
			const todayCost = sum(rows, "cost");
			const label = t("button.label", { cost: formatMoney(todayCost, settings.value.currency) });
			const aria = t("button.aria", { cost: formatMoney(todayCost, settings.value.currency) });
			return jsxs("button", {
				type: "button",
				className: "dsh-uc-railButton",
				"aria-pressed": open || extOpen,
				"aria-label": aria,
				title: aria,
				// The ONE switch: click to open the external cost window, click
				// again to close it. Falls back to the in-app docked panel when
				// the popup is blocked.
				onClick: () => {
					if (extOpen) {
						try { if (externalWin && !externalWin.closed) externalWin.close(); } catch { /* ignore */ }
						setExternalOpen(false);
						setPanelOpen(false);
					} else if (!openExternalPanel()) {
						setPanelOpen(!open);
					}
				},
				children: [
					jsx(BarIcon, {}),
					wide ? jsx("span", { className: "dsh-uc-badge", children: label }) : null
				]
			});
		}

		// ── UsagePanel: left-docked stats panel ───────────────────────────────
		function UsagePanel({ t, useSessions }) {
			const forceFull = usageCostFullPage();
			const open = forceFull || react.useSyncExternalStore(subscribePanel, getPanelOpen, getPanelOpen);
			const settings = useSettings();
			const byId = useSessions((state) => state.byId);
			const [period, setPeriod] = react.useState("all");
			const tether = react.useSyncExternalStore(subscribeTether, getTetherSnapshot, getTetherSnapshot);
			const live = react.useSyncExternalStore(subscribeLive, getLiveStatus, getLiveStatus);
			// Persistent by design: never closes on outside interaction. Only the
			// X button (or Escape in the docked mode) closes it.
			react.useEffect(() => {
				if (!open || forceFull) return;
				const onKey = (event) => {
					if (event.key === "Escape") setPanelOpen(false);
				};
				document.addEventListener("keydown", onKey);
				return () => document.removeEventListener("keydown", onKey);
			}, [open, forceFull]);
			if (!open) return null;

			const value = settings.value;
			const disabled = settings.status === "ready" && value.enabled === false;

			let body;
			if (settings.status === "loading") {
				body = jsx("div", { className: "dsh-uc-empty", children: t("panel.loading") });
			} else if (disabled) {
				body = jsxs("div", {
					className: "dsh-uc-disabled",
					children: [
						jsx("div", { children: t("panel.disabled") }),
						jsx("button", {
							type: "button",
							className: "dsh-uc-switch",
							onClick: () => { if (boundSettings) void boundSettings.set("enabled", true); },
							children: t("panel.enable")
						}),
						jsx("div", { className: "dsh-uc-hint", children: t("panel.disabledHint") })
					]
				});
			} else {
				const rows = collectRows(byId, value, period);
				const totalCost = sum(rows, "cost");
				const totalTokens = sum(rows, "totalTokens");
				const billedInput = sum(rows, "uncached") + sum(rows, "cacheRead") + sum(rows, "cacheWrite");
				const output = sum(rows, "output");
				const cacheRead = sum(rows, "cacheRead");
				const cacheHitRate = billedInput > 0 ? (cacheRead / billedInput) * 100 : 0;
				const models = modelBreakdown(rows);
				const maxModelCost = models.length > 0 ? models[0].cost : 0;
				const currency = value.currency;

				const modelRows = models.map((m) => jsxs("div", {
					className: "dsh-uc-modelRow",
					children: [
						jsx("span", { className: "dsh-uc-modelName", title: m.model, children: m.model }),
						jsx("span", { className: "dsh-uc-modelBar", children: jsx("i", { style: { width: (maxModelCost > 0 ? (m.cost / maxModelCost) * 100 : 0) + "%" } }) }),
						jsx("span", { className: "dsh-uc-modelStat", children: formatTokens(m.totalTokens) }),
						jsx("span", { className: "dsh-uc-modelCost", children: formatMoney(m.cost, currency) })
					]
				}, m.model));

				const sessionRows = rows.length === 0
					? jsx("div", { className: "dsh-uc-empty", children: t("empty") })
					: jsx("div", {
						children: rows.map((r) => jsxs("div", {
							className: "dsh-uc-sessionRow",
							children: [
								jsxs("div", {
									className: "dsh-uc-sessionTop",
									children: [
										jsx("span", { className: "dsh-uc-sessionTitle", title: r.title, children: r.title }),
										jsx("span", { className: "dsh-uc-sessionCost", children: formatMoney(r.cost, currency) })
									]
								}),
								jsxs("div", {
									className: "dsh-uc-sessionMeta",
									children: [
										jsx("span", { className: "dsh-uc-tag", title: r.model, children: r.model }),
										jsx("span", { children: formatTokens(r.totalTokens) + " " + t("tokens") })
									]
								})
							]
						}, r.id))
					});

				body = jsxs("div", {
					className: "dsh-uc-body",
					children: [
						settings.status === "unavailable" ? jsx("div", { className: "dsh-uc-hint", children: t("panel.settingsUnavailable") }) : null,
						regimeKey(value) ? jsx("div", { className: "dsh-uc-regime", children: t(regimeKey(value)) }) : null,
						jsxs("div", {
							className: "dsh-uc-tabs",
							role: "tablist",
							"aria-label": t("period.all"),
							children: ["all", "today", "week", "month"].map((p) => jsx("button", {
								type: "button",
								role: "tab",
								className: "dsh-uc-tab",
								"aria-selected": period === p,
								onClick: () => setPeriod(p),
								children: t("period." + p)
							}, p))
						}),
						jsxs("div", {
							className: "dsh-uc-cards",
							children: [
								jsxs("div", {
									className: "dsh-uc-card wide",
									children: [
										jsx("div", { className: "dsh-uc-cardLabel", children: t("stat.totalCost") }),
										jsx("div", { className: "dsh-uc-cardValue", children: formatMoney(totalCost, currency) })
									]
								}),
								jsxs("div", {
									className: "dsh-uc-card",
									children: [
										jsx("div", { className: "dsh-uc-cardLabel", children: t("stat.totalTokens") }),
										jsx("div", { className: "dsh-uc-cardValue small", children: formatTokens(totalTokens) })
									]
								}),
								jsxs("div", {
									className: "dsh-uc-card",
									children: [
										jsx("div", { className: "dsh-uc-cardLabel", children: t("stat.sessions") }),
										jsx("div", { className: "dsh-uc-cardValue small", children: String(rows.length) })
									]
								}),
								jsxs("div", {
									className: "dsh-uc-card",
									children: [
										jsx("div", { className: "dsh-uc-cardLabel", children: t("stat.billedInput") }),
										jsx("div", { className: "dsh-uc-cardValue small", children: formatTokens(billedInput) })
									]
								}),
								jsxs("div", {
									className: "dsh-uc-card",
									children: [
										jsx("div", { className: "dsh-uc-cardLabel", children: t("stat.cacheHit") }),
										jsx("div", { className: "dsh-uc-cardValue small", children: cacheHitRate.toFixed(1) + "%" })
									]
								}),
								jsxs("div", {
									className: "dsh-uc-card",
									children: [
										jsx("div", { className: "dsh-uc-cardLabel", children: t("stat.output") }),
										jsx("div", { className: "dsh-uc-cardValue small", children: formatTokens(output) })
									]
								})
							]
						}),
						models.length > 0 ? jsxs("div", {
							children: [
								jsx("div", { className: "dsh-uc-sectionTitle", children: t("model.title") }),
								jsx("div", { children: modelRows })
							]
						}) : null,
						jsx("div", { className: "dsh-uc-sectionTitle", children: t("session.title") }),
						sessionRows
					]
				});
			}

			return jsxs("div", {
				className: forceFull ? "dsh-uc-panel full" : "dsh-uc-panel",
				role: "dialog",
				"aria-label": t("panel.title"),
				children: [
					jsxs("div", {
						className: "dsh-uc-header",
						children: [
							jsx("div", { className: "dsh-uc-title", children: t("panel.title") }),
							// No self-close/hide/fullscreen controls by design:
							// the harness sidebar button is the single on/off
							// switch for the cost window. Only the tether
							// (粘连) toggle stays, in the external window.
							forceFull ? jsx(TetherToggle, { t }) : null
						]
					}),
					body,
					jsxs("div", {
						className: "dsh-uc-footer",
						children: [
							t("footer.prices"),
							forceFull ? jsx("span", { className: "dsh-uc-tetherReadout", children: t("footer.tether", { delta: String(tether.delta) }) }) : null,
							forceFull ? jsx("span", { className: "dsh-uc-tetherReadout " + (live.backend === "ok" ? "dsh-uc-liveOk" : "dsh-uc-liveDown"), children: t(live.backend === "ok" ? "footer.backendOk" : "footer.backendDown") }) : null
						]
					})
				]
			});
		}

		// ── TurnCostAction: per-turn cost label in the chat ───────────────────
		// Rendered in the assistant message's actions row via the
		// `conversation.chat.assistant-actions` LIST slot (guaranteed mount —
		// no chain competition). Usage comes from the host `usageCostByTurn`
		// projection (proven channel) with a chat-node scan fallback.
		/** Sum canonical usage buckets of one object; 0 when absent. */
		function usageTotal(u) {
			if (!u || typeof u !== "object") return 0;
			return (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0) + (u.outputTokens || 0);
		}
		/**
		 * Per-turn cost label, rendered in the assistant message's actions row
		 * (`conversation.chat.assistant-actions` — a LIST slot that always
		 * mounts, unlike the chain slot). Data sources:
		 *  1. host projection `usageCostByTurn` (the same proven channel as
		 *     tokenUsage — primary, reliable);
		 *  2. fallback: scan the chat's assistant nodes of this turn for usage.
		 * Model from the session's `usageCost` projection (fallback:
		 * defaultModel). Priced at the turn's own time (peak/off-peak aware).
		 * All hooks run unconditionally at the top (React rules).
		 */
		function TurnCostAction({ messageId, t, useSession, useProjection }) {
			const settings = useSettings();
			const nodes = useSession((s) => s.chat.legacy.nodes);
			const byTurn = useProjection("usageCostByTurn");
			const route = useProjection("usageCost");
			let buckets = null;
			let time = 0;
			try {
				let turn = null;
				if (nodes) {
					for (const n of nodes) {
						if (n && n.kind === "assistant" && n.messageId === messageId) {
							turn = n.turn;
							break;
						}
					}
				}
				if (turn == null) return null;
				const turnUsage = byTurn && byTurn[String(turn)];
				if (turnUsage && usageTotal(turnUsage) > 0) {
					buckets = turnUsage;
					time = turnUsage.time || 0;
				}
				if (!buckets && nodes) {
					for (const n of nodes) {
						if (!n || n.kind !== "assistant" || n.turn !== turn) continue;
						if (usageTotal(n.usage) > 0) {
							buckets = {
								inputTokens: n.usage.inputTokens || 0,
								cacheReadTokens: n.usage.cacheReadTokens || 0,
								cacheWriteTokens: n.usage.cacheWriteTokens || 0,
								outputTokens: n.usage.outputTokens || 0
							};
							time = n.time || time;
						}
					}
				}
			} catch { /* any read failure just yields no chip */ }
			if (!buckets) return null;
			let model = settings.value.defaultModel;
			if (route && route.model) model = route.model;
			const price = priceOf(settings.value, model, time || Date.now());
			const cost = ((buckets.inputTokens + buckets.cacheWriteTokens) * price.cacheMissInput
				+ buckets.cacheReadTokens * price.cacheHitInput
				+ buckets.outputTokens * price.output) / 1e6;
			if (cost <= 0) return null;
			const tokens = buckets.inputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens;
			const label = t("turnCost.label", { cost: formatMoney(cost, settings.value.currency) });
			const title = t("turnCost.title", { tokens: formatTokens(tokens), model });
			return jsx("span", { className: "dsh-uc-turnCost", title, children: label });
		}

		// ── external (外置) panel window ───────────────────────────────────────
		// Opens a second window at `#usage-cost` positioned as a sidecar to the
		// LEFT of the app window — the panel lives OUTSIDE the app and never
		// covers the sidebar. Falls back to the in-app docked panel when the
		// popup is blocked or the environment refuses window.open.
		function openExternalPanel() {
			try {
				const base = typeof location !== "undefined" ? location.href.split("#")[0] : "";
				const w = Math.min(380, Math.max(300, Math.floor((window.screen.availWidth || 1280) / 4)));
				externalWidth = w;
				const h = Math.floor((window.screen.availHeight || 800) * 0.92);
				const left = Math.max(0, (window.screenX || 0) - w + 24);
				const top = Math.max(0, window.screenY || 0);
				const win = window.open(base + "?usage-cost=1#usage-cost", "dsh-usage-cost", "width=" + w + ",height=" + h + ",left=" + left + ",top=" + top);
				if (win) {
					externalWin = win;
					setExternalOpen(true);
					win.focus();
					// Default to docked (粘连) on the first open; the preference
					// persists in localStorage afterwards and can be toggled from
					// the external window's header.
					try {
						if (typeof localStorage !== "undefined" && localStorage.getItem("dsh-uc-tether") === null) setTethered(true);
					} catch { /* ignore */ }
					// Tether loop polls the harness position and keeps the popup
					// docked to the left edge while `tethered` is on.
					ensureTetherLoop();
					syncExternalWindow();
					return true;
				}
			} catch { /* popup blocked / no window API */ }
			return false;
		}

		// ── plugin body ───────────────────────────────────────────────────────
		const inject = [
			"sessions",
			"slots",
			"locale",
			"connection",
			"remote",
			"settingsScope"
		];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("usageCost", { zh, en }), "dsh-usage-cost: dictionaries");
			boundSettings = ctx.settingsScope.bind({ namespace: "usage-cost" });
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "usage-cost",
				order: 20,
				locale: "usageCost"
			}, UsageButton));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "usage-cost-panel",
				order: 20,
				locale: "usageCost"
			}, UsagePanel));
			ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
				name: "conversation.chat.assistant-actions",
				id: "usage-cost-turn-action",
				order: 30,
				locale: "usageCost"
			}, TurnCostAction));
		}

		exports.apply = apply;
		exports.inject = inject;
		// Minimal test seam: lets automated tests (test-client-render.mjs) open
		// the module-level panel state. Harmless in production.
		exports.__test = { setPanelOpen };
		return module.exports;
	}
});
