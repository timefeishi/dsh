/**
 * dsh-pzds-tool — browser half (静态插件版).
 *
 * Settings-page section "账号报告": parameter form + 生成报告/停止 buttons.
 * Communication is via the `pzds-tool` settings namespace (no dynamic
 * `host.call`): the form writes `command`/`params`, and the panel subscribes
 * to the namespace to render `status`/`result`/`history` written by the host.
 *
 * Hand-written CJS for the client ModuleLoader — no build step.
 * NOTE: jsx/jsxs children go in PROPS (jsx(el, { children })), never as a
 * third positional argument (that third slot is `key`).
 */
window.__ModuleLoader__.load({
	id: "dsh-pzds-tool",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		const { jsx, jsxs } = react_jsx_runtime;

		// ── styles ────────────────────────────────────────────────────────────
		const css = `
.pzds-page { font-family: 'Microsoft YaHei', sans-serif; font-size: 13px; color: inherit; max-width: 720px; padding: 4px; }
.pzds-page h3 { margin: 0 0 12px; font-size: 16px; }
.pzds-field { margin-bottom: 9px; display: flex; align-items: center; gap: 8px; }
.pzds-field label { width: 120px; flex-shrink: 0; color: var(--dsw-alias-label-secondary,#777); }
.pzds-field input, .pzds-field select {
  flex: 1; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l1,#ccc); border-radius: 6px; font-size: 13px; box-sizing: border-box;
  background: var(--dsw-alias-bg-layer-1,transparent); color: inherit;
}
.pzds-section { margin: 14px 0 8px; font-weight: bold; border-bottom: 1px solid var(--dsw-alias-border-l1,#eee); padding-bottom: 4px; color: var(--dsw-alias-brand-primary,#2a6); }
.pzds-btn { display: inline-block; padding: 9px 20px; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; color: #fff; background: var(--dsw-alias-brand-primary,#2a6); }
.pzds-btn:disabled { opacity: .6; cursor: not-allowed; }
.pzds-btn.gray { background: #888; margin-left: 8px; }
.pzds-status { margin-top: 12px; padding: 9px 11px; background: var(--dsw-alias-bg-layer-1,rgba(0,0,0,.04)); border: 1px solid var(--dsw-alias-border-l1,#ddd); border-radius: 8px; white-space: pre-wrap; }
.pzds-status.err { background: #fdf0f0; border-color: #ecc; }
.pzds-top { margin-top: 10px; }
.pzds-top table { border-collapse: collapse; width: 100%; font-size: 12px; }
.pzds-top th, .pzds-top td { border: 1px solid var(--dsw-alias-border-l1,#ddd); padding: 4px 6px; text-align: right; }
.pzds-top th { background: var(--dsw-alias-bg-layer-1,rgba(0,0,0,.05)); }
.pzds-top td:first-child { text-align: left; }
.pzds-history { margin-top: 16px; }
.pzds-history table { border-collapse: collapse; width: 100%; font-size: 12px; }
.pzds-history th, .pzds-history td { border: 1px solid var(--dsw-alias-border-l1,#ddd); padding: 5px 6px; text-align: left; }
.pzds-history th { background: var(--dsw-alias-bg-layer-1,rgba(0,0,0,.05)); }
.pzds-history .opbtn { color: var(--dsw-alias-brand-primary,#2a6); cursor: pointer; text-decoration: underline; margin-right: 10px; background: none; border: none; font-size: 12px; padding: 0; }
.pzds-history .delbtn { color: #c33; cursor: pointer; text-decoration: underline; background: none; border: none; font-size: 12px; padding: 0; }
`;
		const tagId = "dsh-pzds-tool/styles";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-pzds-tool";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ── default form values ──────────────────────────────────────────────
		const DEFAULT_FORM = {
			mode: "both", pages: "2", minPrice: "1000", maxPrice: "5000", minScore: "", sortBy: "score",
			genshinVersion: "6.8", srVersion: "4.4", decay: "3", baseFactor: "0.8",
			consProgression: "5", c1Factor: "0.5", zeroCons: "true", includeResources: "true",
			unboundMail: "true", linkedSR: "true", concurrency: "3",
		};

		// ── settings scope (bound in apply) ─────────────────────────────────
		let boundSettings = null;
		const LOADING_SNAPSHOT = { status: "loading", value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: "memory" };
		function settingsSubscribe(listener) {
			return boundSettings ? boundSettings.subscribe(listener) : () => {};
		}
		function settingsGetSnapshot() {
			return boundSettings ? boundSettings.getSnapshot() : LOADING_SNAPSHOT;
		}

		function useNamespace() {
			const snapshot = react.useSyncExternalStore(settingsSubscribe, settingsGetSnapshot, settingsGetSnapshot);
			if (snapshot.status === "ready" && snapshot.value && typeof snapshot.value === "object") {
				return { status: "ready", value: snapshot.value };
			}
			return { status: snapshot.status, value: {} };
		}

		/** Flatten the namespace params back into the form (stringify numbers as-is). */
		function paramsToForm(params) {
			const out = {};
			Object.keys(DEFAULT_FORM).forEach((k) => {
				const v = params ? params[k] : undefined;
				out[k] = v === undefined || v === null ? DEFAULT_FORM[k] : String(v);
			});
			return out;
		}

		/** Convert the form strings into runner param values. */
		function formToParams(form) {
			const num = (k) => { const v = parseFloat(form[k]); return isNaN(v) ? undefined : v; };
			const bool = (k) => form[k] === "true";
			const p = {
				mode: form.mode || "both",
				pages: Math.max(1, Math.floor(num("pages") || 2)),
				minPrice: num("minPrice") || 0,
				maxPrice: num("maxPrice") || 0,
				minScore: num("minScore") || 0,
				sortBy: form.sortBy || "score",
				genshinVersion: num("genshinVersion") || 6.8,
				srVersion: num("srVersion") || 4.4,
				decay: num("decay") || 3,
				baseFactor: num("baseFactor") || 0.8,
				consProgression: num("consProgression") || 5,
				c1Factor: num("c1Factor") || 0.5,
				zeroCons: bool("zeroCons"),
				includeResources: bool("includeResources"),
				unboundMail: bool("unboundMail"),
				linkedSR: bool("linkedSR"),
				concurrency: Math.max(1, Math.min(6, Math.floor(num("concurrency") || 3))),
			};
			Object.keys(p).forEach((k) => { if (p[k] === undefined) delete p[k]; });
			return p;
		}

		// ── panel component ─────────────────────────────────────────────────
		// 主动轮询模式：每 2s 读一次 pzds-tool 命名空间（不依赖 settings 订阅推送，
		// 后者在本环境不触发实时刷新——host 处理完但界面不更新）。读写全走直接 fetch。
		function PzdsPanel() {
			const [live, setLive] = react.useState(null); // null=加载中
			const [form, setForm] = react.useState(DEFAULT_FORM);
			const [busy, setBusy] = react.useState(false);
			const initRef = react.useRef(false);

			const apiDescribe = react.useCallback(async () => {
				try {
					const res = await window.fetch("/api/settings.describe", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ type: "client-request", rpcId: "pzds-poll-" + Date.now(), method: "settings.describe", payload: {} })
					});
					const json = await res.json();
					const ns = (json.result && json.result.value && json.result.value.namespaces || []).find(n => n.ns === "pzds-tool");
					if (ns && ns.value) {
						setLive(ns.value);
						if (!initRef.current) { initRef.current = true; setForm(paramsToForm(ns.value.params)); }
						// busy 跟随 phase：每次轮询都检查（不依赖 phase 值变化，避免点击前后同为终态时不复位）
						const ph = (ns.value.status && ns.value.status.phase) || "";
						if (ph === "finished" || ph === "failed" || ph === "stopped") setBusy(false);
						else if (ph === "starting" || ph === "detail" || ph === "filter" || ph === "fetch-list" || ph === "sr-detail" || ph === "waf-wait" || ph === "list-done" || ph === "detail-done") setBusy(true);
					}
				} catch (e) {}
			}, []);

			react.useEffect(() => {
				apiDescribe();
				const t = setInterval(apiDescribe, 2000);
				return () => clearInterval(t);
			}, [apiDescribe]);

			const value = live || { status: {}, result: null, history: [], params: {} };
			const status = value.status || {};
			const result = value.result || null;
			const history = value.history || [];
			const phase = status.phase || "";

			const set = (k) => (ev) => setForm({ ...form, [k]: ev.target.value });
			const field = (label, key, opts) => {
				const tag = opts && opts.type === "select" ? "select" : "input";
				const extra = opts && opts.type === "select"
				? { children: (opts.options || []).map(o => jsx("option", { key: o.v, value: o.v, children: o.t })) }
				: { type: opts && opts.type === "number" ? "number" : "text", step: opts && opts.step };
			return jsx("div", { className: "pzds-field", children: [
				jsx("label", { children: label }),
				jsx(tag, Object.assign({ value: form[key], onChange: set(key) }, extra))
			] });
			};

			// 直接发 settings mutate（绕过 settingsScope.set 的 enqueue 挂起问题，
			// 与 host 的 scope.watch 链路直连；读取/订阅仍走 boundSettings）
			const apiMutate = async (ops) => {
				const rpcId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("pzds-" + Date.now());
				const res = await window.fetch("/api/settings.mutate", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ type: "client-request", rpcId, method: "settings.mutate", payload: { ns: "pzds-tool", ops } })
				});
				const json = await res.json();
				if (!json.result || !json.result.ok) throw new Error((json.result && json.result.error && json.result.error.message) || "写入失败");
				return json;
			};
			const fetchData = async () => {
				setBusy(true); setResult(null); setStatus('开始获取数据（抓取网站，可能触发风控）...');
				try {
					await apiMutate([{ op: "set", path: ["params"], value: { ...formToParams(form), action: "fetch" } }]);
					await apiMutate([{ op: "set", path: ["command"], value: "start:" + Date.now() }]);
				} catch (e) { setStatus('启动异常: ' + String(e && e.message || e)); setBusy(false); }
			};
			const analyzeDataset = async (id) => {
				setBusy(true); setResult(null); setStatus('正在分析数据集 ' + id + '（不访问网站，秒级完成）...');
				try {
					await apiMutate([{ op: "set", path: ["params"], value: { ...formToParams(form), action: "analyze", datasetId: id } }]);
					await apiMutate([{ op: "set", path: ["command"], value: "start:" + Date.now() }]);
				} catch (e) { setStatus('启动异常: ' + String(e && e.message || e)); setBusy(false); }
			};
			// 数据集相对路径（datasets/{id}/report.html）→ 绝对路径
			const pathOf = (rel) => (rel ? "C:\\Users\\16667\\Desktop\\dsh\\dsh-desktop\\pzds_plugin\\" + rel.split("/").join("\\") : "");
			const stop = async () => {
				try { await apiMutate([{ op: "set", path: ["command"], value: "stop:" + Date.now() }]); } catch (e) {}
				setStatus('已停止');
			};
			const openReport = async (path) => {
				if (!path) return;
				try { await apiMutate([{ op: "set", path: ["command"], value: "open:" + path }]); } catch (e) { setStatus('打开失败: ' + String(e && e.message || e)); }
			};
			const deleteHistory = async (id) => {
				try { await apiMutate([{ op: "set", path: ["command"], value: "delete:" + id }]); } catch (e) { setStatus('删除失败: ' + String(e && e.message || e)); }
			};

			const statusText = (() => {
				if (!phase) return "先点「获取数据」抓取保存，再在下方数据集列表点「分析」生成报告。";
				let t = "阶段: " + phase;
				if (status.message) t += "\n" + status.message;
				if (phase !== "finished" && phase !== "failed" && phase !== "stopped" && status.done != null && status.total != null) t += "\n进度: " + status.done + "/" + status.total;
				return t;
			})();
			const isErr = phase === "failed";

			const children = [];

			children.push(jsx("h3", { children: "原神+崩铁 连体账号价值分报告工具" }));

			children.push(jsx("div", { className: "pzds-section", children: "抓取范围" }));
			children.push(field("分析模式", "mode", { type: "select", options: [{ v: "both", t: "原神+崩铁连体" }, { v: "genshin", t: "仅原神" }, { v: "sr", t: "仅崩铁" }] }));
			children.push(field("列表页数", "pages", { type: "number", step: 1 }));
			children.push(field("价格下限(元)", "minPrice", { type: "number" }));
			children.push(field("价格上限(元)", "maxPrice", { type: "number" }));
			children.push(field("最低总分", "minScore", { type: "number" }));
			children.push(field("报告主排序", "sortBy", { type: "select", options: [{ v: "score", t: "按总价值分" }, { v: "ratio", t: "按性价比" }] }));

			children.push(jsx("div", { className: "pzds-section", children: "评分参数" }));
			children.push(field("原神当前版本", "genshinVersion", { type: "number", step: 0.1 }));
			children.push(field("崩铁当前版本", "srVersion", { type: "number", step: 0.1 }));
			children.push(field("版本衰减分/小版本", "decay", { type: "number", step: 0.1 }));
			children.push(field("基础分系数", "baseFactor", { type: "number", step: 0.05 }));
			children.push(field("命座递进基础值", "consProgression", { type: "number", step: 1 }));
			children.push(field("1命折扣", "c1Factor", { type: "number", step: 0.05 }));
			children.push(field("0命角色", "zeroCons", { type: "select", options: [{ v: "true", t: "不算分" }, { v: "false", t: "减半" }] }));
			children.push(field("含资源分", "includeResources", { type: "select", options: [{ v: "true", t: "包含" }, { v: "false", t: "不包含" }] }));

			children.push(jsx("div", { className: "pzds-section", children: "网页端精准筛选（自动执行）" }));
			children.push(field("仅未绑定邮箱", "unboundMail", { type: "select", options: [{ v: "true", t: "启用" }, { v: "false", t: "关闭" }] }));
			children.push(field("仅连体崩铁", "linkedSR", { type: "select", options: [{ v: "true", t: "启用" }, { v: "false", t: "关闭" }] }));

			children.push(jsx("div", { className: "pzds-section", children: "性能" }));
			children.push(field("并发tab数(1-6)", "concurrency", { type: "number", step: 1 }));

			children.push(jsx("div", { className: "pzds-section", children: "操作" }));
			children.push(jsx("div", { style: { marginTop: 4 }, children: [
				jsx("button", { className: "pzds-btn", disabled: busy, onClick: fetchData, children: busy ? "运行中..." : "获取数据" }),
				jsx("button", { className: "pzds-btn gray", disabled: !busy, onClick: stop, children: "停止" })
			] }));

			if (statusText) children.push(jsx("div", { className: "pzds-status" + (isErr ? " err" : ""), children: statusText }));

			// ── 数据集列表（1 数据集 ↔ 1 报告；点"分析"用当前计分规则生成/覆盖该数据集报告）──
			const dsChildren = [];
			dsChildren.push(jsx("h4", { style: { margin: "8px 0" }, children: "数据集（原始数据）" }));
			if (!history || history.length === 0) {
				dsChildren.push(jsx("div", { className: "pzds-status", children: "暂无数据集，先点「获取数据」抓取保存。" }));
			} else {
				const rows = history.map(x => jsx("tr", { key: x.id, children: [
					jsx("td", { children: x.time }),
					jsx("td", { children: ({ both: "原神+崩铁", genshin: "仅原神", sr: "仅崩铁" }[x.mode] || x.mode) }),
					jsx("td", { children: x.count }),
					jsx("td", { children: x.reportFile ? "已生成" : "未分析" }),
					jsx("td", { children: [
						jsx("button", { className: "opbtn", onClick: () => analyzeDataset(x.id), children: "分析" }),
						x.reportFile ? jsx("button", { className: "opbtn", onClick: () => openReport(pathOf(x.reportFile)), children: "查看" }) : null,
						jsx("button", { className: "delbtn", onClick: () => deleteHistory(x.id), children: "删除" })
					] })
				] }));
				dsChildren.push(jsx("table", { children: jsx("tbody", { children: rows }) }));
			}
			children.push(jsx("div", { className: "pzds-history", children: dsChildren }));

			return jsx("div", { className: "pzds-page", children });
		}

		const inject = [
			"slots",
			"settingsScope",
			"locale"
		];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("pzdsTool", {
				zh: { "section.label": "账号报告" },
				en: { "section.label": "Account Report" }
			}), "dsh-pzds-tool: dictionaries");
			const t = ctx.locale.bind("pzdsTool");
			boundSettings = ctx.settingsScope.bind({ namespace: "pzds-tool" });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "pzds-tool",
				order: 30,
				label: () => t("section.label"),
				locale: "pzdsTool"
			}, PzdsPanel));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
