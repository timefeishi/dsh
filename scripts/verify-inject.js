// Verify: settings panel should contain the injected "更新" nav cell.
// Steps: open settings → check nav list has "更新" → click it → check content.
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
  const PORT = 9224;
  const t = await getTargets(PORT);
  const p = t.find((x) => x.type === "page");
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };

  // open settings
  await ev(`(() => { const s = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim()==='设置'); if (s) { s.click(); return 'clicked'; } return 'not found'; })()`);
  await sleep(1200);

  const r = await ev(`(() => {
    const nav = [...document.querySelectorAll('.VOzbGW_navList .VOzbGW_navCell, #dsh-update-nav')];
    const texts = nav.map(n => (n.textContent||'').trim());
    const updNav = document.getElementById('dsh-update-nav');
    let clickResult = '';
    if (updNav) { updNav.click(); clickResult = 'clicked'; }
    return { texts, hasUpdateNav: !!updNav, clickResult };
  })()`);
  await sleep(500);
  const content = await ev(`(() => {
    const c = document.querySelector('.VOzbGW_content');
    return c ? (c.textContent || '').trim().slice(0, 200) : 'no content pane';
  })()`);
  console.log("=== NAV ITEMS ===");
  console.log("  " + JSON.stringify(r.texts));
  console.log("hasUpdateNav:", r.hasUpdateNav, "click:", r.clickResult);
  console.log("=== CONTENT AFTER CLICK ===");
  console.log("  " + content);
  ws.close(); process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
