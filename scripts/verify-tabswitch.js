// Diagnose the tab-switch bug: open settings → click 更新 → click another
// tab (通用设置) → observe DOM changes + console errors.
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
  const PORT = 9228;
  const t = await getTargets(PORT);
  const p = t.find((x) => x.type === "page");
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };

  // enable console to capture errors
  await send("Runtime.enable");

  const state = async () => await ev(`(() => {
    const content = document.querySelector('.VOzbGW_content');
    const active = document.querySelector('.VOzbGW_navCell.VOzbGW_active');
    return {
      activeTab: active ? (active.textContent || '').trim() : '',
      contentChildCount: content ? content.children.length : -1,
      contentText: content ? (content.textContent || '').trim().slice(0, 80) : '',
      contentHTMLHead: content ? content.innerHTML.slice(0, 150) : '',
    };
  })()`);

  const clickTab = async (label) => {
    await ev(`(() => { const n = [...document.querySelectorAll('.VOzbGW_navCell')].find(b => (b.textContent||'').trim()==='${label}'); if (n) { n.click(); return 1; } return 0; })()`);
    await sleep(700);
  };

  await ev(`(() => { const s = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim()==='设置'); if (s) s.click(); return 1; })()`);
  await sleep(1200);

  console.log("=== open settings (通用设置 active) ===");
  console.log(JSON.stringify(await state()));

  await clickTab("更新");
  console.log("=== after clicking 更新 ===");
  console.log(JSON.stringify(await state()));

  await clickTab("通用设置");
  console.log("=== after clicking 通用设置 (bug check) ===");
  console.log(JSON.stringify(await state()));

  await clickTab("模型");
  console.log("=== after clicking 模型 ===");
  console.log(JSON.stringify(await state()));

  ws.close(); process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
