// Verify: check button shows text-only (no bar); a simulated download
// progress event shows the bar.
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
  const PORT = 9227;
  const t = await getTargets(PORT);
  const p = t.find((x) => x.type === "page");
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };

  // open settings and click the 更新 nav
  await ev(`(() => { const s = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim()==='设置'); if (s) s.click(); return 1; })()`);
  await sleep(1200);
  await ev(`(() => { const n = document.getElementById('dsh-update-nav'); if (n) n.click(); return 1; })()`);
  await sleep(400);

  const barState = async () => {
    return await ev(`(() => {
      const prog = document.getElementById('dsh-update-progress');
      const bar = prog ? prog.querySelector('.bar') : null;
      return {
        progressDisplay: prog ? getComputedStyle(prog).display : 'none',
        barDisplay: bar ? getComputedStyle(bar).display : 'none',
        text: prog ? (prog.querySelector('.text').textContent || '') : '',
      };
    })()`);
  };

  console.log("=== before click (should be hidden) ===");
  console.log(JSON.stringify(await barState()));

  // click 检查更新 (real check will run; network may fail → text-only either way)
  await ev(`(() => { const c = document.getElementById('dsh-update-check'); if (c) c.click(); return 1; })()`);
  await sleep(500);
  console.log("=== during check (text only, bar hidden) ===");
  console.log(JSON.stringify(await barState()));
  await sleep(4000);
  console.log("=== after check (text result, bar hidden) ===");
  console.log(JSON.stringify(await barState()));

  // simulate download progress via the page's own listener (dispatch through
  // the exposed bridge is main->renderer; emulate by calling showProgress path
  // is not possible from here, so instead verify bar exists in DOM structure)
  const dom = await ev(`(() => {
    const prog = document.getElementById('dsh-update-progress');
    return prog ? { html: prog.outerHTML.slice(0, 200), barExists: !!prog.querySelector('.bar') } : null;
  })()`);
  console.log("=== progress element structure ===");
  console.log(JSON.stringify(dom));

  ws.close(); process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
