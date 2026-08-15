// Final verification: port-agnostic tab switching with overlay + active.
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
  const PORT = 9230;
  const t = await getTargets(PORT);
  const p = t.find((x) => x.type === "page");
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };

  const state = async () => await ev(`(() => {
    const content = document.querySelector('.VOzbGW_content');
    const active = document.querySelector('.VOzbGW_navCell.VOzbGW_active');
    return {
      activeTab: active ? (active.textContent || '').trim() : '(none)',
      overlay: !!document.getElementById('dsh-update-overlay'),
      contentHead: content ? (content.textContent || '').trim().slice(0, 40) : '',
    };
  })()`);

  const clickTab = async (label) => {
    await ev(`(() => { const n = [...document.querySelectorAll('.VOzbGW_navCell')].find(b => (b.textContent||'').trim()==='${label}'); if (n) { n.click(); return 1; } return 0; })()`);
    await sleep(700);
  };

  await ev(`(() => { const s = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim()==='设置'); if (s) s.click(); return 1; })()`);
  await sleep(1200);

  console.log("open:        ", JSON.stringify(await state()));
  await clickTab("更新");
  console.log("→ 更新:      ", JSON.stringify(await state()));
  await clickTab("通用设置");
  console.log("→ 通用设置:  ", JSON.stringify(await state()));
  await clickTab("模型");
  console.log("→ 模型:      ", JSON.stringify(await state()));
  await clickTab("更新");
  console.log("→ 更新 again:", JSON.stringify(await state()));
  await clickTab("插件");
  console.log("→ 插件:      ", JSON.stringify(await state()));

  ws.close(); process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
