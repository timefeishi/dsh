// Click the settings trigger, wait, then dump the settings panel structure.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const targets = await getTargets();
  const page = targets.find((t) => t.type === "page");
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
  const evalJS = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result && r.result.result.value;
  };

  // 1. click the settings trigger
  await evalJS(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const s = btns.find((b) => (b.textContent || '').trim() === '设置' || (b.getAttribute('aria-label') || '') === '设置');
    if (s) { s.click(); return 'clicked'; }
    return 'no settings btn: ' + btns.map(b => b.textContent.trim()).join(',');
  })()`);
  await sleep(1200);

  // 2. dump everything visible, focusing on dialog/panel/modal containers
  const data = await evalJS(`(() => {
    const out = { panels: [], buttons: [], structure: [] };
    // find likely overlay/panel containers
    document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="dialog" i], [class*="panel" i], [class*="drawer" i], [class*="popover" i]').forEach((p) => {
      out.panels.push({ tag: p.tagName, cls: (p.className || '').toString().slice(0, 100), role: p.getAttribute('role') || '' });
    });
    document.querySelectorAll('button').forEach((b) => {
      const t = (b.textContent || '').trim().slice(0, 60);
      if (t) out.buttons.push({ text: t, cls: (b.className || '').toString().slice(0, 80), aria: b.getAttribute('aria-label') || '', visible: b.offsetParent !== null });
    });
    // settings panel content text
    document.querySelectorAll('*').forEach((el) => {
      if (el.children.length === 0) {
        const t = (el.textContent || '').trim();
        if (t && /模型|provider|key|token|服务器|server|工作区|workspace|语言|theme|主题|自动|auto|代理|proxy|关于|about/i.test(t) && t.length < 60) out.structure.push(t);
      }
    });
    return out;
  })()`);

  console.log("=== PANELS ===");
  (data.panels || []).forEach((p) => console.log(`  ${p.tag} role=${p.role} cls=${p.cls}`));
  console.log("=== BUTTONS (visible flag) ===");
  (data.buttons || []).slice(0, 40).forEach((b) => console.log(`  [${b.text}] visible=${b.visible} cls=${b.cls} aria=${b.aria}`));
  console.log("=== PANEL TEXT ===");
  [...new Set(data.structure || [])].slice(0, 40).forEach((t) => console.log(`  ${t}`));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
