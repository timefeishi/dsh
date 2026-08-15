// Test: manually set active on our nav cell, wait, see if React overrides it.
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
  const t = await getTargets(9229);
  const p = t.find((x) => x.type === "page");
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };

  // click our 更新 nav (its onclick shows overlay); then manually set active
  await ev(`(() => { const n = document.getElementById('dsh-update-nav'); if (n) n.click(); return 1; })()`);
  await sleep(500);
  await ev(`(() => {
    const n = document.getElementById('dsh-update-nav');
    document.querySelectorAll('.VOzbGW_navCell').forEach(c => c.classList.remove('VOzbGW_active'));
    n.classList.add('VOzbGW_active');
    return 1;
  })()`);
  await sleep(1500);
  const out = await ev(`(() => {
    const active = document.querySelector('.VOzbGW_navCell.VOzbGW_active');
    return {
      activeText: active ? (active.textContent || '').trim() : '(none)',
      updateActive: document.getElementById('dsh-update-nav').classList.contains('VOzbGW_active'),
    };
  })()`);
  console.log("after 1.5s:", JSON.stringify(out));
  await sleep(2000);
  const out2 = await ev(`(() => {
    const active = document.querySelector('.VOzbGW_navCell.VOzbGW_active');
    return {
      activeText: active ? (active.textContent || '').trim() : '(none)',
      updateActive: document.getElementById('dsh-update-nav').classList.contains('VOzbGW_active'),
    };
  })()`);
  console.log("after 3.5s:", JSON.stringify(out2));
  ws.close(); process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
