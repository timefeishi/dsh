// Inspect native settings panel styles: nav cell computed styles + content
// pane structure so the injected "更新" entry matches the page aesthetics.
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
  const PORT = 9225;
  const t = await getTargets(PORT);
  const p = t.find((x) => x.type === "page");
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };

  await ev(`(() => { const s = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim()==='设置'); if (s) { s.click(); return 1; } return 0; })()`);
  await sleep(1200);

  const out = await ev(`(() => {
    const cs = (el) => { if (!el) return null; const s = getComputedStyle(el); return { color: s.color, bg: s.backgroundColor, font: s.fontSize + '/' + s.lineHeight + ' ' + s.fontFamily, pad: s.padding, radius: s.borderRadius, gap: s.gap }; };
    const nav = document.querySelector('.VOzbGW_navCell');
    const navList = document.querySelector('.VOzbGW_navList');
    const content = document.querySelector('.VOzbGW_content');
    const settingsTitle = content ? content.querySelector('h1,h2,h3,[class*="title" i]') : null;
    // a sample setting row in content (e.g. language row)
    const rows = content ? [...content.querySelectorAll('div')].filter(d => (d.textContent||'').trim().length>0 && d.children.length>=2).slice(0,3) : [];
    return {
      navComputed: cs(nav),
      navOuter: nav ? nav.outerHTML.slice(0, 500) : '',
      navListComputed: cs(navList),
      contentComputed: cs(content),
      settingsTitleText: settingsTitle ? settingsTitle.textContent.trim() : '',
      settingsTitleComputed: cs(settingsTitle),
      sampleRows: rows.map(r => ({ cls: (r.className||'').toString().slice(0,80), text: (r.textContent||'').trim().slice(0,60), cs: cs(r) })),
      panelBg: (() => { const pn = document.querySelector('.VOzbGW_panel'); return pn ? getComputedStyle(pn).backgroundColor : ''; })(),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  ws.close(); process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
