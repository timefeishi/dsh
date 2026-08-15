// Probe DSH UI DOM via CDP using Node's built-in WebSocket.
"use strict";
const http = require("http");

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9223/json", (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}

(async () => {
  const targets = await getTargets();
  const page = targets.find((t) => t.type === "page");
  if (!page) { console.error("no page target"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };

  function send(method, params) {
    return new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
  }

  const script = `(() => {
    const out = { buttons: [], links: [], inputs: [], text: [], nav: [] };
    document.querySelectorAll('button').forEach((b) => {
      const t = (b.textContent || '').trim().slice(0, 60);
      if (t) out.buttons.push({ text: t, cls: (b.className || '').toString().slice(0, 80), aria: b.getAttribute('aria-label') || '' });
    });
    document.querySelectorAll('a').forEach((a) => {
      const t = (a.textContent || '').trim().slice(0, 60);
      if (t) out.links.push({ text: t, href: (a.getAttribute('href') || '').slice(0, 80) });
    });
    document.querySelectorAll('input,select,textarea').forEach((i) => {
      out.inputs.push({ type: i.type || i.tagName, placeholder: i.placeholder || '', cls: (i.className || '').toString().slice(0, 60) });
    });
    document.querySelectorAll('nav *, [role="navigation"] *, aside *').forEach((el) => {
      if (el.children.length === 0) {
        const t = (el.textContent || '').trim();
        if (t && t.length < 40) out.nav.push(t);
      }
    });
    document.querySelectorAll('*').forEach((el) => {
      if (el.children.length === 0) {
        const t = (el.textContent || '').trim();
        if (t && /设置|settings|更新|update|关于|about/i.test(t) && t.length < 80) out.text.push(t);
      }
    });
    return out;
  })()`;

  const r = await send("Runtime.evaluate", { expression: script, returnByValue: true });
  const data = r.result && r.result.result && r.result.result.value;
  if (!data) { console.error("no data", JSON.stringify(r).slice(0, 500)); process.exit(1); }
  console.log("=== BUTTONS ===");
  (data.buttons || []).slice(0, 50).forEach((b) => console.log(`  [${b.text}] cls=${b.cls} aria=${b.aria}`));
  console.log("=== LINKS ===");
  (data.links || []).slice(0, 30).forEach((l) => console.log(`  [${l.text}] href=${l.href}`));
  console.log("=== INPUTS ===");
  (data.inputs || []).slice(0, 20).forEach((i) => console.log(`  ${i.type} ph=${i.placeholder} cls=${i.cls}`));
  console.log("=== NAV ===");
  [...new Set(data.nav || [])].slice(0, 30).forEach((t) => console.log(`  ${t}`));
  console.log("=== SETTINGS-ISH TEXT ===");
  [...new Set(data.text || [])].slice(0, 40).forEach((t) => console.log(`  ${t}`));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
