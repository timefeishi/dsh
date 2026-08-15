// Verify the re-injection fix: open settings → "更新" present → close →
// reopen → "更新" must still be present; also verify native class reuse.
"use strict";
const http = require("http");
function getTargets(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json`, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const PORT = 9226;
  const t = await getTargets(PORT);
  const p = t.find((x) => x.type === "page");
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };

  const openSettings = async () => {
    await ev(`(() => { const s = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim()==='设置'); if (s) { s.click(); return 1; } return 0; })()`);
    await sleep(1200);
  };
  const closeSettings = async () => {
    await ev(`(() => { const c = document.querySelector('.VOzbGW_close'); if (c) { c.click(); return 1; } const s = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim()==='设置'); if (s) { s.click(); return 2; } return 0; })()`);
    await sleep(1200);
  };
  const navState = async () => {
    return await ev(`(() => {
      const nav = document.getElementById('dsh-update-nav');
      const list = document.querySelector('.VOzbGW_navList');
      return {
        hasNav: !!nav,
        navClass: nav ? nav.className : '',
        navText: nav ? (nav.textContent||'').trim() : '',
        navIconSvg: nav ? !!nav.querySelector('svg') : false,
        navItems: list ? [...list.querySelectorAll('button')].map(b => (b.textContent||'').trim()) : [],
      };
    })()`);
  };

  console.log("=== 1st open ===");
  await openSettings();
  console.log(JSON.stringify(await navState()));

  console.log("=== close ===");
  await closeSettings();

  console.log("=== 2nd open (bug check) ===");
  await openSettings();
  console.log(JSON.stringify(await navState()));

  ws.close(); process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
