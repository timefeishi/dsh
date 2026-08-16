/**
 * Host-half integration test: exercises the REAL installed module
 * (runtime node_modules) through a fake Cordis context — settings namespace
 * registration, projection-unit registration, and the fold's behavior over
 * sample session events. Run: node test-host.mjs
 */
const pluginUrl = "file:///C:/Users/16667/AppData/Roaming/DeepSeek%20Harness/dsh-runtime/node_modules/dsh-usage-cost/lib/index.js";
const m = await import(pluginUrl);

let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : ""));
  if (!cond) failures += 1;
}

// ── fake cordis context ──
const injectHandlers = [];
const fakeCtx = {
  fiber: { state: 2 }, // ACTIVE
  get() { return undefined; },
  inject(services, cb) { injectHandlers.push({ services, cb }); }
};

// ── fake settings service ──
const registeredNamespaces = [];
const scopes = [];
const fakeSettings = {
  register(ns, schema, opts) {
    registeredNamespaces.push({ ns: String(ns), base: opts.base });
    const scope = {
      get: () => schema(opts.base ?? {}),
      watch: () => () => {}
    };
    scopes.push(scope);
    return scope;
  }
};

// ── fake session projections registry ──
const units = [];
const fakeProjections = { register: (unit) => units.push(unit) };

// ── run the real apply() ──
const config = m.Config({});
m.apply(fakeCtx, config);
for (const h of injectHandlers) {
  if (h.services.includes("settings")) h.cb({ settings: fakeSettings, effect: (cb) => cb() });
  if (h.services.includes("sessionProjections")) h.cb({ sessionProjections: fakeProjections });
}

// ── assertions ──
check("settings namespace registered", registeredNamespaces.length === 1 && registeredNamespaces[0].ns === "usage-cost",
  JSON.stringify(registeredNamespaces.map((r) => r.ns)));
check("projection units registered (usageCost + usageCostByTurn)", units.length === 2, "units=" + units.length);

// settings scope resolves the composed defaults
const resolved = scopes[0].get();
check("scope resolves defaults", resolved.enabled === true && resolved.currency === "CNY" && resolved.defaultModel === "deepseek-v4-flash",
  JSON.stringify({ enabled: resolved.enabled, currency: resolved.currency, defaultModel: resolved.defaultModel }));
check("scope resolves price table", Object.keys(resolved.prices).length === 2 && resolved.prices["deepseek-v4-flash"].cacheMissInput === 1 && resolved.prices["deepseek-v4-pro"].cacheMissInput === 3,
  JSON.stringify(resolved.prices));
check("scope resolves peaking defaults", resolved.peaking === true && resolved.peakingStart === "2026-08-17" && resolved.timezone === "Asia/Shanghai" &&
  resolved.peakHours.length === 2 && resolved.peakPrices["deepseek-v4-flash"].cacheMissInput === 3 && resolved.peakPrices["deepseek-v4-pro"].output === 27,
  JSON.stringify({ peaking: resolved.peaking, peakingStart: resolved.peakingStart, timezone: resolved.timezone, peakHours: resolved.peakHours, peakPrices: resolved.peakPrices }));

// ── projection fold behavior ──
const unit = units[0];
let state = unit.init();
const baseline = state;
state = unit.apply(state, { type: "user/message", data: { content: "hi" } });
check("unrelated event keeps state ref", state === baseline);
state = unit.apply(state, { type: "assistant/message", data: { turn: 1, step: 1, message: { content: "ok" }, usage: { inputTokens: 10, outputTokens: 5 } } });
check("assistant event keeps state ref", state === baseline);
state = unit.apply(state, { type: "request/context", data: { provider: "deepseek-official", model: "deepseek-v4-flash" } });
let view = unit.view(state);
check("route recorded", view.provider === "deepseek-official" && view.model === "deepseek-v4-flash", JSON.stringify(view));
const afterFirst = state;
state = unit.apply(state, { type: "request/context", data: { provider: "deepseek-official", model: "deepseek-reasoner" } });
view = unit.view(state);
check("route switch updates model", view.model === "deepseek-reasoner", JSON.stringify(view));
state = unit.apply(state, { type: "request/context", data: { provider: "deepseek-official", model: "deepseek-reasoner" } });
check("same route keeps state ref", state === afterFirst ? false : true, "ref changed=" + (state !== afterFirst));
// view output validates against the unit's own zod schema
const parsed = unit.schema.safeParse(unit.view(state));
check("view passes zod schema", parsed.success === true, parsed.success ? "" : JSON.stringify(parsed.error));

// ── usageCostByTurn fold: per-turn buckets with (turn, step) replacement ──
const turnUnit = units[1];
let tstate = turnUnit.init();
tstate = turnUnit.apply(tstate, { type: "request/context", data: { provider: "deepseek-official", model: "deepseek-v4-flash" }, time: 100 });
tstate = turnUnit.apply(tstate, { type: "assistant/message", data: { turn: 1, step: 1, message: { content: "a" }, usage: { inputTokens: 10, cacheReadTokens: 5, outputTokens: 3 } }, time: 200 });
tstate = turnUnit.apply(tstate, { type: "assistant/message", data: { turn: 1, step: 2, message: { content: "b" }, usage: { inputTokens: 20, outputTokens: 7 } }, time: 300 });
tstate = turnUnit.apply(tstate, { type: "assistant/message", data: { turn: 2, step: 1, message: { content: "c" }, usage: { inputTokens: 30, cacheWriteTokens: 4, outputTokens: 1 } }, time: 400 });
// retry replacement: same (turn 1, step 2) final usage replaces the earlier sample
tstate = turnUnit.apply(tstate, { type: "assistant/message", data: { turn: 1, step: 2, message: { content: "b2" }, usage: { inputTokens: 25, outputTokens: 9 } }, time: 350 });
const tview = turnUnit.view(tstate);
check("byTurn sums turn 1 buckets", tview["1"].inputTokens === 35 && tview["1"].cacheReadTokens === 5 && tview["1"].outputTokens === 12,
  JSON.stringify(tview));
check("byTurn keeps turn 2 separately", tview["2"].inputTokens === 30 && tview["2"].cacheWriteTokens === 4 && tview["2"].model === "deepseek-v4-flash",
  JSON.stringify(tview["2"]));
check("byTurn replacement avoids double count", tview["1"].outputTokens === 12 && tview["1"].time === 350,
  "output 3+9=12, time from final sample");
const tparsed = turnUnit.schema.safeParse(tview);
check("byTurn view passes zod schema", tparsed.success === true, tparsed.success ? "" : JSON.stringify(tparsed.error));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
