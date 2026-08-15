// Inspect settings panel nav structure in detail.
"use strict";
const http = require("http");
function getTargets() {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9223/json", (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}
(async () => {
  const t = await getTargets();
  const p = t.find((x) => x.type === "page");
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };

  const out = await ev(`(() => {
    const nav = [...document.querySelectorAll('.VOzbGW_navCell')];
    const panel = document.querySelector('.VOzbGW_panel');
    const navWrap = nav[0] ? nav[0].parentElement : null;
    return {
      navCount: nav.length,
      navTexts: nav.map(n => (n.textContent || '').trim()),
      navParentTag: navWrap ? navWrap.tagName : '',
      navParentCls: navWrap ? (navWrap.className || '').toString().slice(0, 100) : '',
      navFirstOuter: nav[0] ? nav[0].outerHTML.slice(0, 400) : '',
      panelChildTags: panel ? [...panel.children].map(c => c.tagName + '.' + ((c.className || '').toString().slice(0, 60))) : [],
      updateBtn: (() => { const b = document.getElementById('dsh-update-btn'); return b ? { outer: b.outerHTML.slice(0, 300), parent: b.parentElement ? b.parentElement.tagName + '.' + ((b.parentElement.className || '').toString().slice(0, 80)) : '' } : null; })(),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  ws.close(); process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
