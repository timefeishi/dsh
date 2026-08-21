// pzds 原神+崩铁连体账号 价值分自动化工具 - 执行脚本
// 用法: node runner.js <params.json>
// params: { pages, maxPrice, minScore, sortBy, genshinVersion, srVersion, decay, baseFactor, consProgression, c1Factor, zeroCons, includeResources, cdpPort }
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const WS_PATH = 'C:\\Users\\16667\\AppData\\Roaming\\DeepSeek Harness\\dsh-runtime\\node_modules\\ws';
const WebSocket = require(WS_PATH);

// 插件资产统一放在 pzds_plugin 目录（类似 dsh-usage-cost 的独立插件文件夹）
const BASE = 'C:\\Users\\16667\\Desktop\\dsh\\dsh-desktop';
const PLUGIN_DIR = path.join(BASE, 'pzds_plugin');
const PROGRESS = path.join(PLUGIN_DIR, 'progress.json');
const RESULT = path.join(PLUGIN_DIR, 'result.json');
const REPORT = path.join(PLUGIN_DIR, 'report.html');
const HISTORY = path.join(PLUGIN_DIR, 'history.json');
const PARAMS = path.join(PLUGIN_DIR, 'params.json');
const DETAILS = path.join(PLUGIN_DIR, 'details.json');
// 数据集目录：每次"获取数据"创建 datasets/{id}/（data.json + 覆盖式 report.html），
// 数据集列表在 datasets/index.json（1 个数据集 ↔ 1 份报告，重复分析覆盖）
const DATASETS = path.join(PLUGIN_DIR, 'datasets');
const DATASETS_INDEX = path.join(DATASETS, 'index.json');

function progress(p) { try { fs.writeFileSync(PROGRESS, JSON.stringify(p)); } catch (e) {} }

// ---------- 参数 ----------
let args = {};
try { args = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch (e) { args = {}; }
const P = {
  // 分析模式: "both"=原神+崩铁连体号（默认）| "genshin"=仅原神 | "sr"=仅崩铁
  mode: String(args.mode || 'both'),
  pages: Math.max(1, parseInt(args.pages) || 2),
  maxPrice: parseInt(args.maxPrice) || 0,
  minPrice: parseInt(args.minPrice) || 0,
  minScore: parseInt(args.minScore) || 0,
  genshinVersion: parseFloat(args.genshinVersion) || 6.8,
  srVersion: parseFloat(args.srVersion) || 4.4,
  decay: parseFloat(args.decay) || 3,
  baseFactor: parseFloat(args.baseFactor) || 0.8,
  consProgression: parseFloat(args.consProgression) || 5,
  c1Factor: parseFloat(args.c1Factor) || 0.5,
  zeroCons: !!args.zeroCons,
  includeResources: args.includeResources !== false,
  cdpPort: parseInt(args.cdpPort) || 9222,
  // 多 tab 并发抓取详情（登录后无 WAF，可并行；默认 3 个 tab）
  concurrency: Math.max(1, Math.min(6, parseInt(args.concurrency) || 3)),
};
// 商品列表页：原神 goodsList/12，崩铁(星铁) goodsList/213
const LIST_URL_GENSHIN = 'https://www.pzds.com/goodsList/12';
const LIST_URL_SR = 'https://www.pzds.com/goodsList/213';

// ---------- 评分表 ----------
const genshinRatings = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'pzds_role_table.json'), 'utf8'));
const srRatingsAll = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'pzds_sr_ratings.json'), 'utf8'));
const srRatings = {};
Object.keys(srRatingsAll).forEach(k => {
  if (['姬子', '瓦尔特', '布洛妮娅', '杰帕德', '克拉拉', '白露', '彦卿'].includes(k)) return; // 常驻不计分
  // 转换为含 base 的结构（base = score × 10），与 roleScore 期望一致
  srRatings[k] = { base: srRatingsAll[k].score * 10, version: srRatingsAll[k].version };
});

function roleScore(rating, cons, cur) {
  if (!rating || typeof rating.base !== 'number' || typeof rating.version !== 'number') return 0;
  const B = rating.base * P.baseFactor;
  const decay = Math.max(0, (cur - rating.version)) * P.decay;
  if (cons === 0) {
    return P.zeroCons ? 0 : Math.max(0, (B - decay) * 0.5);
  }
  const consBonus = P.consProgression * cons * (cons + 1) / 2;
  const bonus = (cons + 1) * B + consBonus;
  let v = Math.max(0, bonus - decay);
  if (cons === 1) v *= P.c1Factor;
  return v;
}

const norm = n => n.replace(/[·•&]/g, '').replace(/\s+/g, '').toLowerCase();
const srIndex = {};
Object.keys(srRatings).forEach(n => { srIndex[norm(n)] = n; });
const gensIndex = {};
Object.keys(genshinRatings).forEach(n => { gensIndex[norm(n)] = n; });

// ---------- HTTP ----------
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { resolve(fetch(res.headers.location)); return; }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}
function jsonRequest(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(url);
    const req = http.request(u, { method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(d); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 自动启动调试 Chrome（CDP） ----------
// runner 依赖带 --remote-debugging-port 的 Chrome。若 9222 不可用，
// 自动用用户的登录 profile 拉起调试 Chrome（保持 pzds 登录态）。
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe' : '',
].filter(Boolean);
// 专用调试 profile：Chrome 对已存在/在用的 profile 拒绝绑定调试端口，
// 对全新目录则可以。首次自动创建（从真实登录 profile 复制，保留 pzds 登录态）。
const CHROME_PROFILE_DIR = process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + '\\Google\\Chrome\\User Data - dsh' : '';
const CHROME_REAL_PROFILE = process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + '\\Google\\Chrome\\User Data' : '';

function cdpPortOpen(port) {
  return new Promise((resolve) => {
    try {
      const req = http.get('http://127.0.0.1:' + port + '/json/version', { timeout: 1500 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    } catch (e) { resolve(false); }
  });
}

async function ensureCdp(port, timeoutMs) {
  if (await cdpPortOpen(port)) return { ok: true, spawned: false };
  // 找 Chrome
  let chromePath = null;
  for (const c of CHROME_CANDIDATES) {
    if (fs.existsSync(c)) { chromePath = c; break; }
  }
  if (!chromePath) return { ok: false, error: '未找到 Chrome 可执行文件' };
  // 确保专用调试 profile 存在（首次从真实登录 profile 复制，保留 pzds 登录态）
  if (CHROME_PROFILE_DIR && !fs.existsSync(CHROME_PROFILE_DIR)) {
    if (CHROME_REAL_PROFILE && fs.existsSync(CHROME_REAL_PROFILE)) {
      console.log('首次运行：从登录 profile 复制专用调试 profile（保留 pzds 登录态）...');
      try {
        fs.cpSync(CHROME_REAL_PROFILE, CHROME_PROFILE_DIR, { recursive: true });
        console.log('专用调试 profile 已创建');
      } catch (e) {
        console.log('复制 profile 失败（继续尝试）: ' + e.message);
      }
    }
  }
  console.log('CDP ' + port + ' 不可用，自动启动调试 Chrome...');
  const args = ['--remote-debugging-port=' + port];
  if (CHROME_PROFILE_DIR) args.push('--user-data-dir=' + CHROME_PROFILE_DIR);
  args.push('--no-first-run', '--no-default-browser-check');
  const child = spawnDetached(chromePath, args);
  // 等待 CDP 就绪
  const deadline = Date.now() + (timeoutMs || 30000);
  while (Date.now() < deadline) {
    await sleep(1200);
    if (await cdpPortOpen(port)) return { ok: true, spawned: true };
  }
  return { ok: false, error: '已启动 Chrome 但 ' + port + ' 未就绪（若 Chrome 已用无调试参数运行，请关闭所有 Chrome 窗口后重试）' };
}

function spawnDetached(cmd, args) {
  const { spawn } = require('child_process');
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', (e) => console.log('启动 Chrome 失败: ' + e.message));
  child.unref();
  return child;
}

// ---------- 列表抓取 ----------
function parseListPage(html) {
  const goods = [];
  // 商品卡片: <a ... href="/goodsDetails/NO/6" title="..." ...>...</a> 内含价格 div
  // 注意 <a> 与 href 之间可能还有其他属性（如 data-v-*）
  const cardRe = /<a [^>]*href="\/goodsDetails\/([A-Z0-9]{4,6})\/6[^"]*"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = cardRe.exec(html))) {
    const no = m[1];
    const title = m[2];
    const inner = m[3];
    if (no === 'N0VLA') continue; // 活动广告
    const priceM = inner.match(/newGoodsList_box_pir[^>]*>¥\s*([\d,]+)/);
    const price = priceM ? parseInt(priceM[1].replace(/,/g, '')) : 0;
    if (price >= 999990) continue; // 广告占位
    goods.push({ no, title, price });
  }
  return goods;
}

async function fetchList() {
  // 列表页为无限滚动加载，?page=N 无效。通过 CDP 新建 tab 滚动加载获取全部商品。
  const goods = [];
  // 检测 CDP
  let tabs;
  try {
    tabs = await jsonRequest('GET', 'http://127.0.0.1:' + P.cdpPort + '/json/list');
  } catch (e) {
    throw new Error('CDP 不可用: 请先启动带调试端口的 Chrome (--remote-debugging-port=' + P.cdpPort + ')。错误: ' + e.message);
  }
  // 用 Target.createTarget 创建新 tab（避免污染用户当前页面）
  const created = await jsonRequest('PUT', 'http://127.0.0.1:' + P.cdpPort + '/json/new?' + encodeURIComponent(LIST_URL_GENSHIN));
  let targetId = created && created.id;
  // 等待新 tab 就绪并获取其 webSocketDebuggerUrl
  let tabWs = null;
  for (let t = 0; t < 10; t++) {
    await sleep(1500);
    try {
      const list = await jsonRequest('GET', 'http://127.0.0.1:' + P.cdpPort + '/json/list');
      const found = list.find(x => x.type === 'page' && (targetId ? x.id === targetId : x.url.includes('goodsList')));
      if (found && found.webSocketDebuggerUrl) { tabWs = found.webSocketDebuggerUrl; break; }
    } catch (e) {}
  }
  if (!tabWs) {
    // 回退：复用现有 page tab
    const tab = tabs.find(t => t.type === 'page');
    if (!tab) throw new Error('未找到可用的 Chrome 标签页');
    tabWs = tab.webSocketDebuggerUrl;
  }
  const ws = new WebSocket(tabWs);
  let id = 0;
  const pending = {};
  function send(method, params) {
    return new Promise((resolve) => {
      const msgId = ++id;
      pending[msgId] = resolve;
      ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
    });
  }
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
  });
  await new Promise(res => ws.on('open', res));
  await send('Page.enable');
  await send('Runtime.enable');
  async function evalSafe(expr) {
    try {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r && r.result && r.result.result) return r.result.result.value;
      return null;
    } catch (e) { return null; }
  }

  // 导航到列表页（干净 URL + 强制刷新清 SPA 状态）
  await send('Page.navigate', { url: LIST_URL_GENSHIN + '?from=' + Date.now() });
  await sleep(8000);
  // 确保页面加载完成（等待商品卡片出现）
  for (let w = 0; w < 6; w++) {
    const cnt = await evalSafe(`(() => { const l = (document.documentElement.outerHTML.match(/goodsDetails\\/([A-Z0-9]{4,6})\\/6/g) || []); return [...new Set(l)].length; })()`);
    if (cnt > 0) break;
    await sleep(3000);
  }

  // ── 网页端精准筛选（与用户手动操作一致）──
  // 顺序很重要：先填价格 → 再点未绑定邮箱 → 再展开点崩铁
  progress({ phase: 'filter', message: '执行网页筛选（价格/未绑定邮箱/连体崩铁）...' });
  console.log('执行网页筛选...');
  // 1. 填价格（必须先填，否则后续筛选会重置价格）
  if (P.minPrice || P.maxPrice) {
    const fr = await evalSafe(`(() => {
      const inputs = [...document.querySelectorAll('input')];
      const min = inputs.find(i => (i.placeholder || '') === '最低值' && (i.className || '').includes('el-input__inner'));
      const max = inputs.find(i => (i.placeholder || '') === '最高值' && (i.className || '').includes('el-input__inner'));
      if (!min || !max) return '无价格框';
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      if (${P.minPrice}) { setter.call(min, '${P.minPrice}'); min.dispatchEvent(new Event('input', { bubbles: true })); }
      if (${P.maxPrice}) { setter.call(max, '${P.maxPrice}'); max.dispatchEvent(new Event('input', { bubbles: true })); }
      min.dispatchEvent(new Event('change', { bubbles: true }));
      max.dispatchEvent(new Event('change', { bubbles: true }));
      return 'filled ' + min.value + '-' + max.value;
    })()`);
    console.log('填价格: ' + fr);
    await sleep(2500);
  }
  // 2. 点"未绑定邮箱"
  if (args.unboundMail !== false) {
    const mr = await evalSafe(`(() => {
      const els = [...document.querySelectorAll('.opt-item-name')].filter(el => (el.innerText || '').trim() === '未绑定邮箱');
      if (!els.length) return '无未绑定邮箱选项';
      els[0].click(); return 'clicked';
    })()`);
    console.log('点未绑定邮箱: ' + mr);
    await sleep(2500);
  }
  // 3. 展开并点"崩铁"（连体游戏区）——仅"原神+崩铁连体"模式需要；"仅原神"模式跳过
  if (args.linkedSR !== false && P.mode !== 'genshin') {
    // 点"未绑定邮箱"后筛选区会重新渲染，"崩铁"选项可能短暂不在 DOM：
    // 轮询等待其出现（出现即点），找不到则尝试点击展开按钮（.down）后再找
    let srClicked = false;
    const srFilterDeadline = Date.now() + 14000;
    while (Date.now() < srFilterDeadline && !srClicked) {
      const sr = await evalSafe(`(() => {
        const els = [...document.querySelectorAll('.opt-item-name')].filter(el => (el.innerText || '').trim() === '崩铁');
        if (!els.length) return 'none';
        els[0].click();
        return 'clicked';
      })()`);
      if (sr === 'clicked') { srClicked = true; break; }
      // 尝试展开可见的 .down（某些筛选组需要展开后才渲染选项）
      await evalSafe(`(() => {
        const downs = [...document.querySelectorAll('.down')].filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        // 优先点"连体号"相关筛选组的展开按钮（其 .filter-list 文本含"连体"），否则点第一个可见的
        const target = downs.find(el => {
          const fl = el.closest('.filter-list');
          return fl && ((fl.innerText || '').includes('连体') || (fl.innerText || '').includes('游戏'));
        }) || downs[0];
        if (target) { target.click(); return 'expanded'; }
        return 'no-down';
      })()`);
      await sleep(1500);
    }
    console.log('点崩铁: ' + (srClicked ? 'clicked' : '无崩铁选项'));
    await sleep(3500);
  }

  // 滚动加载：每次滚动到底部，直到商品数不再增长或达到目标页数
  const targetCount = P.pages * 10; // 每页约10个商品
  let lastCount = 0;
  let stableRounds = 0;
  // 筛选（点崩铁）后列表重新加载，先等待商品卡片出现（最多 15s）
  const firstLoadDeadline = Date.now() + 15000;
  while (Date.now() < firstLoadDeadline) {
    const html = await evalSafe('document.documentElement.outerHTML') || '';
    const cnt = parseListPage(html).length;
    if (cnt > 0) { console.log('筛选后列表已加载: ' + cnt + ' 个商品'); break; }
    await sleep(1000);
  }
  for (let i = 0; i < P.pages * 4 + 4; i++) {
    progress({ phase: 'fetch-list', page: Math.floor(i / 2) + 1, total: P.pages, message: '滚动加载列表 (' + lastCount + ' 个商品)...' });
    const html = await evalSafe('document.documentElement.outerHTML') || '';
    const pageGoods = parseListPage(html);
    const seenLocal = new Set();
    pageGoods.forEach(g => {
      if (seenLocal.has(g.no)) return;
      seenLocal.add(g.no);
      if (P.maxPrice && g.price > P.maxPrice) return;
      const dup = goods.some(x => x.no === g.no);
      if (!dup) goods.push(g);
    });
    if (goods.length === lastCount) stableRounds++;
    else stableRounds = 0;
    lastCount = goods.length;
    console.log('滚动' + (i + 1) + ': ' + goods.length + ' 个商品');
    if (goods.length >= targetCount || stableRounds >= 3) break;
    // 滚动到底部触发加载，等待加载完成
    await evalSafe('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(4000);
    await evalSafe('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(3000);
  }
  ws.close();
  return goods;
}

// ---------- 详情抓取：SSR 并发 + CDP 补崩铁（混合模式） ----------
// ---------- 详情抓取：SSR 并发抓原神数据 + CDP 补崩铁（混合模式） ----------
// SSR 直连无 WAF（Node https），可高并发；崩铁角色需浏览器点击展开（用 CDP，限速避免风控）
const SSR_CONCURRENCY = 10;

function fetchHttps(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9' } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

// 从 SSR HTML 提取详情数据
// ---------- CDP 完整抓取详情（登录后无 WAF，原神+崩铁+资源一次抓完） ----------
async function cdpFetchDetails(goods) {
  const results = [];
  let tabs;
  try {
    tabs = await jsonRequest('GET', 'http://127.0.0.1:' + P.cdpPort + '/json/list');
  } catch (e) {
    throw new Error('CDP 不可用: 请先启动带调试端口的 Chrome (--remote-debugging-port=' + P.cdpPort + ')。错误: ' + e.message);
  }
  // 优先复用已访问过详情页的 tab（有 Vue 组件状态，连体卡片点击行为正常）
  // 次选：新建干净 tab
  let tab = tabs.find(t => t.type === 'page' && t.url.includes('goodsDetails'));
  if (!tab) {
    try {
      const created = await jsonRequest('PUT', 'http://127.0.0.1:' + P.cdpPort + '/json/new?about:blank');
      if (created && created.id) {
        for (let t = 0; t < 10 && !tab; t++) {
          await sleep(1200);
          const list = await jsonRequest('GET', 'http://127.0.0.1:' + P.cdpPort + '/json/list');
          tab = list.find(x => x.id === created.id) || null;
        }
      }
    } catch (e) {}
  }
  if (!tab) {
    tab = tabs.find(t => t.type === 'page' && !t.url.includes('about:blank')) || tabs.find(t => t.type === 'page');
  }
  if (!tab) throw new Error('未找到可用的 Chrome 标签页');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;
  const pending = {};
  function send(method, params) {
    return new Promise((resolve) => {
      const msgId = ++id;
      pending[msgId] = resolve;
      ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
    });
  }
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
  });
  await new Promise(res => ws.on('open', res));
  await send('Page.enable');
  await send('Runtime.enable');
  async function evalSafe(expr) {
    try {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r && r.result && r.result.result) return r.result.result.value;
      return null;
    } catch (e) { return null; }
  }

  // 条件等待页面加载（含 WAF 检测，登录后一般不会出现）
  async function waitLoad(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const st = await evalSafe(`(() => {
        const t = document.body ? document.body.innerText : '';
        return JSON.stringify({
          len: t.length,
          loaded: t.length > 300 && (t.includes('商品描述') || t.includes('冒险等阶') || t.includes('绑定') || t.includes('商品编号')),
          waf: (t.includes('滑动') && t.includes('验证')) || t.includes('请按住滑块'),
        });
      })()`);
      if (st) {
        const j = JSON.parse(st);
        if (j.loaded) return 'ok';
        if (j.waf) {
          console.log('⚠ 检测到滑块验证，等待恢复（如持续出现请手动通过一次）...');
          await sleep(3000);
          continue;
        }
      }
      await sleep(600);
    }
    return 'timeout';
  }

  for (let i = 0; i < goods.length; i++) {
    const g = goods[i];
    progress({ phase: 'detail', done: i, total: goods.length, current: g.no, message: '抓取详情 ' + (i + 1) + '/' + goods.length + ' ' + g.no });
    try {
      await send('Page.navigate', { url: 'https://www.pzds.com/goodsDetails/' + g.no + '/6' });
      const loadState = await waitLoad(15000);
      if (loadState !== 'ok') {
        console.log(g.no + ' 加载失败(' + loadState + ')');
        results.push({ no: g.no, title: g.title, price: g.price, gensChars: [], srText: '', resources: null, hasSR: false, mailInfo: false, err: loadState });
        continue;
      }
      await sleep(600);
      const body = await evalSafe('document.body ? document.body.innerText : ""') || '';
      const nuxt = await evalSafe('window.__NUXT__ ? JSON.stringify(window.__NUXT__).slice(0, 200000) : ""') || '';

      // 原神角色
      const gensChars = extractGenshin(nuxt, body);
      // 崩铁区（"仅原神"模式跳过崩铁抓取）
      const hasSR = body.includes('崩坏星穹铁道') || body.includes('崩铁');
      const mailInfo = /未绑定邮箱|不送邮箱|送网易未实名邮箱/.test(body);
      let srText = '';
      if (hasSR && P.mode !== 'genshin') {
        // 等待页面完全渲染（连体卡片稳定后再点击）——确保 conjoined-goods 的"查看"已加载
        await sleep(6000);
        // 等待崩铁区卡片出现（conjoined-goods 或含崩铁文本的 goods-card）
        const cardDeadline = Date.now() + 6000;
        while (Date.now() < cardDeadline) {
          const hasCard = await evalSafe(`(() => {
            const c = [...document.querySelectorAll('.conjoined-goods, .goods-card')].find(el => {
              const t = (el.innerText || '').trim();
              return (t.includes('崩坏星穹铁道') || t.includes('崩铁')) && !t.includes('查看主账号');
            });
            return !!c;
          })()`);
          if (hasCard) break;
          await sleep(500);
        }
        // 点击崩铁区（含"崩坏星穹铁道"文本的 conjoined-goods 连体卡片）的"查看"
        const clickResult = await evalSafe(`(() => {
          // 优先：含"崩坏星穹铁道"文本的 conjoined-goods
          const srCards = [...document.querySelectorAll('.conjoined-goods')].filter(card => {
            const t = (card.innerText || '').trim();
            return t.includes('崩坏星穹铁道') || t.includes('崩铁');
          });
          for (const card of srCards) {
            const viewBtns = [...card.querySelectorAll('*')].filter(b => (b.innerText || '').trim() === '查看' && b.children.length === 0);
            if (viewBtns.length) {
              try { card.scrollIntoView({ block: 'center' }); } catch (e) {}
              viewBtns[0].click();
              return 'clicked-sr-card';
            }
          }
          // 次优：所有 conjoined-goods 卡片（无崩铁文本时）
          const cards = [...document.querySelectorAll('.conjoined-goods')];
          for (const card of cards) {
            const viewBtns = [...card.querySelectorAll('*')].filter(b => (b.innerText || '').trim() === '查看' && b.children.length === 0);
            if (viewBtns.length) {
              try { card.scrollIntoView({ block: 'center' }); } catch (e) {}
              viewBtns[0].click();
              return 'clicked-conjoined';
            }
          }
          // 再优：含"崩坏星穹铁道"的 goods-card
          const candidates = [...document.querySelectorAll('.goods-card, [class*="goods-card"]')].filter(el => {
            const t = (el.innerText || '').trim();
            return t.includes('崩坏星穹铁道') && !t.includes('查看主账号');
          });
          for (const block of candidates) {
            const viewBtns = [...block.querySelectorAll('*')].filter(b => (b.innerText || '').trim() === '查看' && b.children.length === 0);
            if (viewBtns.length) {
              try { block.scrollIntoView({ block: 'center' }); } catch (e) {}
              viewBtns[0].click(); return 'clicked-goods-card';
            }
          }
          // 兜底：任意含崩铁文本的短块内的"查看"
          const srBlocks = [...document.querySelectorAll('*')].filter(el => {
            const t = (el.innerText || '').trim();
            return (t.includes('崩坏星穹铁道') || t.includes('崩铁')) && t.length < 4000 && !t.includes('查看主账号');
          });
          for (const block of srBlocks) {
            const viewBtns = [...block.querySelectorAll('*')].filter(b => (b.innerText || '').trim() === '查看' && b.children.length === 0);
            if (viewBtns.length) { viewBtns[0].click(); return 'clicked-fallback'; }
          }
          return 'no';
        })()`);
        if (clickResult && clickResult !== 'clicked-conjoined' && clickResult !== 'clicked-goods-card' && clickResult !== 'clicked-fallback') {
          console.log(g.no + ' 点击结果: ' + clickResult);
        }
        // 条件等待崩铁角色出现（点击查看五星角色属性）
        const srDeadline = Date.now() + 10000;
        while (Date.now() < srDeadline) {
          const has = await evalSafe(`document.body ? document.body.innerText.includes('点击查看五星角色属性') : false`);
          if (has) break;
          await sleep(600);
        }
        await sleep(400);
        // 从崩铁卡片内提取角色段（避免混入原神区）
        const body2 = await evalSafe(`(() => {
          const card = [...document.querySelectorAll('.conjoined-goods')].find(el => {
            const t = (el.innerText || '').trim();
            return (t.includes('崩坏星穹铁道') || t.includes('崩铁')) && t.includes('点击查看五星角色属性');
          });
          return card ? card.innerText : (document.body ? document.body.innerText : '');
        })()`) || '';
        const idx = body2.indexOf('点击查看五星角色属性');
        if (idx !== -1) {
          srText = body2.slice(idx, idx + 2500);
        }
      }
      const resources = extractResources(body + '\n' + (srText || ''));
      results.push({
        no: g.no, title: g.title, price: g.price,
        gensChars, srText, resources, hasSR, mailInfo,
      });
      console.log((i + 1) + '/' + goods.length + ' ' + g.no + ' 原神' + gensChars.length + '角色 崩铁' + (srText ? srText.length : 0) + '字');
    } catch (e) {
      results.push({ no: g.no, title: g.title, price: g.price, gensChars: [], srText: '', resources: null, hasSR: false, mailInfo: false, err: String(e && e.message || e) });
      console.log((i + 1) + '/' + goods.length + ' ' + g.no + ' 错误');
    }
    if ((i + 1) % 5 === 0 || i + 1 === goods.length) {
      try { fs.writeFileSync(DETAILS, JSON.stringify(results, null, 1)); } catch (e) {}
    }
    await sleep(300);
  }
  ws.close();
  try { fs.writeFileSync(DETAILS, JSON.stringify(results, null, 1)); } catch (e) {}
  return results;
}

// ---------- 详情抓取：多 tab 并发版（登录后无 WAF，可并行） ----------
// 每个 worker 占用一个 Chrome tab，从共享队列取商品串行处理；N 个 worker 并行。
async function cdpFetchDetailsParallel(goods) {
  const CONCURRENCY = P.concurrency;
  // 打开 N 个 tab（优先复用已有 goodsDetails tab，不足则新建）
  const tabs = [];
  let allTabs;
  try {
    allTabs = await jsonRequest('GET', 'http://127.0.0.1:' + P.cdpPort + '/json/list');
  } catch (e) {
    throw new Error('CDP 不可用: 请先启动带调试端口的 Chrome (--remote-debugging-port=' + P.cdpPort + ')。错误: ' + e.message);
  }
  // 复用已有详情 tab（有 Vue 组件状态，连体卡片点击行为正常）
  const existing = allTabs.filter(t => t.type === 'page' && t.url.includes('goodsDetails'));
  for (const t of existing) {
    if (tabs.length >= CONCURRENCY) break;
    try { tabs.push({ wsUrl: t.webSocketDebuggerUrl, reused: true }); } catch (e) {}
  }
  // 新建剩余 tab
  for (let i = tabs.length; i < CONCURRENCY; i++) {
    try {
      const created = await jsonRequest('PUT', 'http://127.0.0.1:' + P.cdpPort + '/json/new?about:blank');
      if (!created || !created.id) break;
      let tab = null;
      for (let t = 0; t < 10 && !tab; t++) {
        await sleep(1200);
        const list = await jsonRequest('GET', 'http://127.0.0.1:' + P.cdpPort + '/json/list');
        tab = list.find(x => x.id === created.id && x.webSocketDebuggerUrl) || null;
      }
      if (tab) tabs.push({ wsUrl: tab.webSocketDebuggerUrl, reused: false });
    } catch (e) {}
  }
  if (!tabs.length) throw new Error('未找到可用的 Chrome 标签页');

  // 为每个 tab 建立 CDP 会话
  const workers = [];
  for (const t of tabs) {
    const ws = new WebSocket(t.wsUrl);
    let id = 0;
    const pending = {};
    function send(method, params) {
      return new Promise((resolve) => {
        const msgId = ++id;
        pending[msgId] = resolve;
        ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
      });
    }
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
    });
    await new Promise(res => ws.on('open', res));
    await send('Page.enable');
    await send('Runtime.enable');
    // ★ 关键：模拟焦点，规避 Chrome 对后台 tab 的节流（否则 Vue hydration 不完成、点击无效）
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    async function evalSafe(expr) {
      try {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
        if (r && r.result && r.result.result) return r.result.result.value;
        return null;
      } catch (e) { return null; }
    }
    workers.push({ ws, send, evalSafe });
  }

  const results = [];
  let done = 0;
  const queue = goods.slice();
  let qi = 0;
  const locker = {};

  // 条件等待页面加载（含 WAF 检测，登录后一般不会出现）
  async function waitLoad(w, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const st = await w.evalSafe(`(() => {
        const t = document.body ? document.body.innerText : '';
        return JSON.stringify({
          len: t.length,
          loaded: t.length > 300 && (t.includes('商品描述') || t.includes('冒险等阶') || t.includes('绑定') || t.includes('商品编号')),
          waf: (t.includes('滑动') && t.includes('验证')) || t.includes('请按住滑块'),
        });
      })()`);
      if (st) {
        const j = JSON.parse(st);
        if (j.loaded) return 'ok';
        if (j.waf) {
          console.log('⚠ 检测到滑块验证，等待恢复...');
          await sleep(3000);
          continue;
        }
      }
      await sleep(600);
    }
    return 'timeout';
  }

  // 抓单个商品（原 cdpFetchDetails 循环体）
  async function fetchOne(w, g) {
    await w.send('Page.navigate', { url: 'https://www.pzds.com/goodsDetails/' + g.no + '/6' });
    const loadState = await waitLoad(w, 15000);
    if (loadState !== 'ok') {
      console.log(g.no + ' 加载失败(' + loadState + ')');
      return { no: g.no, title: g.title, price: g.price, gensChars: [], srText: '', resources: null, hasSR: false, mailInfo: false, err: loadState };
    }
    await sleep(600);
    // ── 仅崩铁模式：详情页主体即崩铁账号（无"原神主卡+崩铁连体卡"结构），
    // 直接提取崩铁角色段 + 崩铁资源（复用 parseSRText/extractResources）──
    if (P.mode === 'sr') {
      const srRoleNames = Object.keys(srRatings);
      let srText = '';
      let body = '';
      const deadline = Date.now() + 18000;
      while (Date.now() < deadline && !srText) {
        body = await w.evalSafe('document.body ? document.body.innerText : ""') || '';
        // 主体无角色标记时，尝试点含"开拓等级"的卡/区块的"查看"（主号区展开）
        if (!body.includes('点击查看五星角色属性')) {
          await w.evalSafe(`(() => {
            const cards = [...document.querySelectorAll('.conjoined-goods, .goods-card, [class*="goods-card"]')].filter(card => {
              const t = (card.innerText || '').trim();
              return t.includes('开拓等级');
            });
            for (const card of cards) {
              const btns = [...card.querySelectorAll('*')].filter(b => (b.innerText || '').trim() === '查看' && b.children.length === 0);
              if (btns.length) { try { card.scrollIntoView({ block: 'center' }); } catch (e) {} btns[0].click(); return 'clicked'; }
            }
            return 'no';
          })()`);
          await sleep(800);
          body = await w.evalSafe('document.body ? document.body.innerText : ""') || '';
        }
        // 找含崩铁角色的"点击查看五星角色属性"段（与连体 findSrMark 同思路）
        const positions = [];
        let from = 0;
        while ((from = body.indexOf('点击查看五星角色属性', from)) !== -1) { positions.push(from); from += 5; }
        for (let i = positions.length - 1; i >= 0; i--) {
          const seg = body.slice(positions[i], positions[i] + 2000);
          if (srRoleNames.some(name => seg.includes(name))) { srText = seg; break; }
        }
        if (!srText) await sleep(900);
      }
      const mailInfo = /未绑定邮箱|不送邮箱|送网易未实名邮箱/.test(body);
      const resources = extractResources(body + '\n' + (srText || ''));
      return { no: g.no, title: g.title, price: g.price, gensChars: [], srText, resources, hasSR: !!(srText || body.includes('崩坏星穹铁道') || body.includes('崩铁')), mailInfo };
    }
    const body = await w.evalSafe('document.body ? document.body.innerText : ""') || '';
    const nuxt = await w.evalSafe('window.__NUXT__ ? JSON.stringify(window.__NUXT__).slice(0, 200000) : ""') || '';

    const gensChars = extractGenshin(nuxt, body);
    const mailInfo = /未绑定邮箱|不送邮箱|送网易未实名邮箱/.test(body);
    let hasSR = body.includes('崩坏星穹铁道') || body.includes('崩铁');
    // 崩铁区异步渲染：等待其出现（最多 12s 轮询），避免并发下读取过早漏判
    if (!hasSR) {
      const srAppearDeadline = Date.now() + 12000;
      while (Date.now() < srAppearDeadline) {
        await sleep(900);
        const b2 = await w.evalSafe('document.body ? document.body.innerText : ""') || '';
        if (b2.includes('崩坏星穹铁道') || b2.includes('崩铁')) { hasSR = true; break; }
        const hasCard = await w.evalSafe(`(() => {
          const c = [...document.querySelectorAll('.conjoined-goods, .goods-card')].find(el => {
            const t = (el.innerText || '').trim();
            return (t.includes('崩坏星穹铁道') || t.includes('崩铁')) && !t.includes('查看主账号');
          });
          return !!c;
        })()`);
        if (hasCard) { hasSR = true; break; }
      }
    }
    let srText = '';
    if (hasSR) {
      await sleep(6000);
      // 等待崩铁卡（含"开拓等级"特征）出现——原神主卡也是 conjoined-goods，不能只等"含崩铁文本"
      const srRoleNames = Object.keys(srRatings);
      function findSrMark(text) {
        const positions = [];
        let from = 0;
        while ((from = text.indexOf('点击查看五星角色属性', from)) !== -1) { positions.push(from); from += 5; }
        for (let i = positions.length - 1; i >= 0; i--) {
          const seg = text.slice(positions[i], positions[i] + 1800);
          if (srRoleNames.some(name => seg.includes(name))) return positions[i];
        }
        return positions.length ? positions[positions.length - 1] : -1;
      }
      let lastClickResult = '';
      for (let attempt = 0; attempt < 3 && !srText; attempt++) {
        // 等待含"开拓等级"的崩铁卡出现（最多 10s）
        const cardDeadline = Date.now() + 10000;
        let srCardReady = false;
        while (Date.now() < cardDeadline) {
          const hasCard = await w.evalSafe(`(() => {
            const c = [...document.querySelectorAll('.conjoined-goods, .goods-card, [class*="goods-card"]')].find(el => {
              const t = (el.innerText || '').trim();
              return t.includes('开拓等级') && !t.includes('查看主账号');
            });
            return !!c;
          })()`);
          if (hasCard) { srCardReady = true; break; }
          await sleep(500);
        }
        if (!srCardReady) break; // 页面没有崩铁连体卡
        // 点击崩铁卡的"查看"（只点含"开拓等级"的卡，避免误点原神主卡）
        const clickResult = await w.evalSafe(`(() => {
          const srCards = [...document.querySelectorAll('.conjoined-goods, .goods-card, [class*="goods-card"]')].filter(card => {
            const t = (card.innerText || '').trim();
            return t.includes('开拓等级') && !t.includes('查看主账号');
          });
          for (const card of srCards) {
            const viewBtns = [...card.querySelectorAll('*')].filter(b => (b.innerText || '').trim() === '查看' && b.children.length === 0);
            if (viewBtns.length) {
              try { card.scrollIntoView({ block: 'center' }); } catch (e) {}
              viewBtns[0].click();
              return 'clicked-sr-card';
            }
          }
          return 'no';
        })()`);
        lastClickResult = clickResult;
        if (clickResult && clickResult !== 'no') {
          console.log(g.no + ' 点击结果: ' + clickResult);
        }
        // 等待标记出现
        const srDeadline = Date.now() + 10000;
        while (Date.now() < srDeadline) {
          const has = await w.evalSafe(`document.body ? document.body.innerText.includes('点击查看五星角色属性') : false`);
          if (has) break;
          await sleep(600);
        }
        await sleep(3000);
        const body2 = await w.evalSafe(`(() => {
          // 优先：含"开拓等级"的卡片（崩铁独有特征）
          const card = [...document.querySelectorAll('.conjoined-goods, .goods-card, [class*="goods-card"]')].find(el => {
            const t = (el.innerText || '').trim();
            return t.includes('开拓等级') && t.includes('点击查看五星角色属性');
          }) || [...document.querySelectorAll('.conjoined-goods')].find(el => {
            const t = (el.innerText || '').trim();
            return (t.includes('崩坏星穹铁道') || t.includes('崩铁')) && !t.includes('冒险等阶') && t.includes('点击查看五星角色属性');
          });
          return card ? card.innerText : (document.body ? document.body.innerText : '');
        })()`) || '';
        // 取包含崩铁角色的"点击查看五星角色属性"标记（崩铁区在页面靠后），避免误取原神区
        const srIdx = findSrMark(body2);
        if (srIdx !== -1) {
          srText = body2.slice(srIdx, srIdx + 2500);
        } else {
          const r2 = body2.indexOf('五星角色');
          srText = r2 !== -1 ? body2.slice(r2, r2 + 1200) : '';
        }
        if (srText && !srRoleNames.some(name => srText.includes(name))) {
          // 提取内容不含任何崩铁角色 → 点错了（展开原神区），重试
          console.log(g.no + ' 提取非崩铁内容(第' + (attempt + 1) + '次)，重试点击...');
          srText = '';
        }
      }
      if (lastClickResult === 'no' && !srText) {
        // 无崩铁卡但页面有崩铁字样 → 记录原始标记（可能是唯一标记）
        const bodyB = await w.evalSafe('document.body ? document.body.innerText : ""') || '';
        const idx = bodyB.indexOf('点击查看五星角色属性');
        if (idx !== -1) srText = bodyB.slice(idx, idx + 2500);
      }
    }
    const resources = extractResources(body + '\n' + (srText || ''));
    return { no: g.no, title: g.title, price: g.price, gensChars, srText, resources, hasSR, mailInfo };
  }

  // 并发 worker：从队列取商品
  async function worker(w) {
    while (true) {
      let g = null;
      if (qi < queue.length) { g = queue[qi++]; } // 单线程 JS 无竞争
      if (!g) break;
      try {
        const r = await fetchOne(w, g);
        results.push(r);
        done++;
        progress({ phase: 'detail', done, total: goods.length, current: g.no, message: '抓取详情 ' + done + '/' + goods.length + ' ' + g.no + ' (并发' + CONCURRENCY + ')' });
        console.log(done + '/' + goods.length + ' ' + g.no + ' 原神' + r.gensChars.length + '角色 崩铁' + (r.srText ? r.srText.length : 0) + '字');
      } catch (e) {
        results.push({ no: g.no, title: g.title, price: g.price, gensChars: [], srText: '', resources: null, hasSR: false, mailInfo: false, err: String(e && e.message || e) });
        done++;
        console.log(done + '/' + goods.length + ' ' + g.no + ' 错误');
      }
      if (done % 5 === 0 || done === goods.length) {
        try { fs.writeFileSync(DETAILS, JSON.stringify(results, null, 1)); } catch (e) {}
      }
      await sleep(300);
    }
  }

  await Promise.all(workers.map(w => worker(w)));
  workers.forEach(w => { try { w.ws.close(); } catch (e) {} });
  try { fs.writeFileSync(DETAILS, JSON.stringify(results, null, 1)); } catch (e) {}
  return results;
}


// 仅补崩铁数据（复用已抓的连体号，慢速避免风控）
async function cdpFetchSrOnly(linkedGoods) {
  const results = [];
  let tabs;
  try {
    tabs = await jsonRequest('GET', 'http://127.0.0.1:' + P.cdpPort + '/json/list');
  } catch (e) {
    throw new Error('CDP 不可用: ' + e.message);
  }
  const tab = tabs.find(t => t.type === 'page' && !t.url.includes('about:blank')) || tabs.find(t => t.type === 'page');
  if (!tab) throw new Error('未找到 Chrome 标签页');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;
  const pending = {};
  function send(method, params) {
    return new Promise((resolve) => {
      const msgId = ++id;
      pending[msgId] = resolve;
      ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
    });
  }
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
  });
  await new Promise(res => ws.on('open', res));
  await send('Page.enable');
  await send('Runtime.enable');
  // ★ 关键：模拟焦点，规避 Chrome 对后台 tab 的节流（否则 Vue hydration 不完成、点击无效）
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function evalSafe(expr) {
    try {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r && r.result && r.result.result) return r.result.result.value;
      return null;
    } catch (e) { return null; }
  }

  for (let i = 0; i < linkedGoods.length; i++) {
    const g = linkedGoods[i];
    progress({ phase: 'sr-detail', done: i, total: linkedGoods.length, current: g.no, message: '崩铁数据 ' + (i + 1) + '/' + linkedGoods.length + ' ' + g.no });
    const res = { no: g.no, srText: '', resources: g.resources || { genshin: {}, sr: {} }, hasSR: true };
    try {
      await send('Page.navigate', { url: 'https://www.pzds.com/goodsDetails/' + g.no + '/6' });
      // 条件等待（含 WAF 检测，WAF 时等待自动恢复）
      const deadline = Date.now() + 15000;
      let loaded = false;
      let wafSeen = false;
      while (Date.now() < deadline) {
        const st = await evalSafe(`(() => {
          const t = document.body ? document.body.innerText : '';
          return JSON.stringify({ len: t.length, waf: (t.includes('滑动') && t.includes('验证')) || t.includes('请按住滑块') });
        })()`);
        if (st) {
          const j = JSON.parse(st);
          if (j.len > 300) { loaded = true; break; }
          if (j.waf) {
            if (!wafSeen) { wafSeen = true; console.log('⚠ ' + g.no + ' 滑块，等待恢复...'); progress({ phase: 'waf-wait', message: '滑块验证，等待风控恢复' }); }
            await sleep(5000); // WAF 时等 5 秒再试
            continue;
          }
        }
        await sleep(800);
      }
      if (!loaded) {
        console.log((i + 1) + '/' + linkedGoods.length + ' ' + g.no + ' 加载失败' + (wafSeen ? ' (滑块)' : ''));
        results.push(res);
        continue;
      }
      // 点击查看崩铁（优先 goods-card 内的"查看"）
      await evalSafe(`(() => {
        // 优先：conjoined-goods 连体卡片内的"查看"
        const cards = [...document.querySelectorAll('.conjoined-goods')];
        for (const card of cards) {
          const viewBtns = [...card.querySelectorAll('*')].filter(b => (b.innerText || '').trim() === '查看' && b.children.length === 0);
          if (viewBtns.length) { viewBtns[0].click(); return 'clicked'; }
        }
        const candidates = [...document.querySelectorAll('.goods-card, [class*="goods-card"]')].filter(el => {
          const t = (el.innerText || '').trim();
          return t.includes('崩坏星穹铁道') && !t.includes('查看主账号');
        });
        for (const block of candidates) {
          const viewBtns = [...block.querySelectorAll('*')].filter(b => (b.innerText || '').trim() === '查看' && b.children.length === 0);
          if (viewBtns.length) { viewBtns[0].click(); return 'clicked'; }
        }
        const srBlocks = [...document.querySelectorAll('*')].filter(el => {
          const t = (el.innerText || '').trim();
          return (t.includes('崩坏星穹铁道') || t.includes('崩铁')) && t.length < 4000 && !t.includes('查看主账号');
        });
        for (const block of srBlocks) {
          const viewBtns = [...block.querySelectorAll('*')].filter(b => (b.innerText || '').trim() === '查看' && b.children.length === 0);
          if (viewBtns.length) { viewBtns[0].click(); return 'clicked'; }
        }
        return 'no';
      })()`);
      await sleep(3000);
      // 全页提取，取"星穹铁道"后最后一个标记（崩铁段）
      const body2 = await evalSafe('document.body ? document.body.innerText : ""') || '';
      const idx = body2.indexOf('星穹铁道');
      if (idx !== -1) {
        const seg = body2.slice(idx);
        let lastIdx = -1;
        let from = 0;
        while ((from = seg.indexOf('点击查看五星角色属性', from)) !== -1) { lastIdx = from; from += 5; }
        if (lastIdx !== -1) res.srText = seg.slice(lastIdx, lastIdx + 2000);
        else {
          const r2 = seg.indexOf('五星角色');
          res.srText = r2 !== -1 ? seg.slice(r2, r2 + 1200) : '';
        }
      }
      const sM = re => { const m2 = body2.match(re); return m2 ? parseInt(m2[1]) : 0; };
      res.resources.sr.星轨专票 = Math.max(sM(/(\d+)张星轨专票/), sM(/(\d+)个星轨专票/));
      res.resources.sr.星穹 = sM(/(\d+)个星穹/);
      res.resources.sr.古老梦华 = sM(/(\d+)个古老梦华/);
      console.log((i + 1) + '/' + linkedGoods.length + ' ' + g.no + ' 崩铁' + (res.srText ? res.srText.length : 0) + '字');
    } catch (e) {
      console.log(g.no + ' 崩铁抓取错误: ' + (e && e.message));
    }
    results.push(res);
    await sleep(800); // 限速防风控
  }
  ws.close();
  return results;
}


// 原神角色提取: "角色N命" / "角色N+M" / "满命角色" / "N命角色"
function extractGenshin(nuxt, body) {
  const chars = [];
  // 1. __NUXT__ sellingPointLabels（兼容多种格式）
  try {
    const m = nuxt.match(/"sellingPointLabels":\s*\[([^\]]*)\]/);
    if (m) {
      const items = m[1].match(/"([^"]+)"/g) || [];
      items.forEach(s => {
        const v = s.replace(/"/g, '');
        if (/满命/.test(v)) {
          const name = v.replace('满命', '').trim();
          if (name && name.length <= 10) chars.push({ name, cons: 6 });
          return;
        }
        let mm = v.match(/^(\d+)命(.+)$/);
        if (mm) {
          const name = mm[2].trim();
          const cons = parseInt(mm[1]);
          if (name && name.length <= 10 && cons >= 0 && cons <= 6) chars.push({ name, cons });
          return;
        }
        mm = v.match(/^(.+?)(\d+)\+?\d*$/);
        if (mm) {
          const name = mm[1].trim();
          const cons = parseInt(mm[2]);
          if (name && name.length <= 10 && cons >= 0 && cons <= 6) chars.push({ name, cons });
        }
      });
    }
  } catch (e) {}
  if (!chars.length) {
    // 2. 正文 "N命角色" 格式（原神完整详情）
    const i = body.indexOf('【五星角色及命座】');
    if (i !== -1) {
      const j = body.indexOf('【四星角色及命座】');
      const seg = body.slice(i, j !== -1 ? j : i + 3000);
      const re = /(\d+)命([^\s，,；;:：]+)/g;
      let m;
      while ((m = re.exec(seg))) {
        const name = m[2].trim();
        const cons = parseInt(m[1]);
        if (name && name.length <= 10 && cons >= 0 && cons <= 6) chars.push({ name, cons });
      }
    }
  }
  // 3. 标题 "满命X" / "N命X"（全文搜索，命中评分表内角色才计入）
  if (!chars.length) {
    const re = /(\d+)命([\u4e00-\u9fa5A-Za-z·]+)/g;
    let m;
    while ((m = re.exec(body))) {
      const name = m[2].trim();
      const cons = parseInt(m[1]);
      if (name && name.length <= 10 && cons >= 0 && cons <= 6 && gensIndex[norm(name)]) chars.push({ name, cons });
    }
    const m6 = body.match(/满命([\u4e00-\u9fa5A-Za-z·]+)/g);
    if (m6) m6.forEach(s => { const name = s.replace('满命', ''); if (name && name.length <= 10 && gensIndex[norm(name)]) chars.push({ name, cons: 6 }); });
  }
  // 白名单过滤（评分表内才计分，取最高命座）
  const best = {};
  chars.forEach(c => {
    const key = norm(c.name);
    const canon = gensIndex[key];
    if (!canon) return;
    const k2 = 'R:' + canon;
    if (best[k2] === undefined || c.cons > best[k2]) best[k2] = c.cons;
  });
  return Object.entries(best).map(([k, cons]) => ({ name: k.slice(2), cons }));
}

// 崩铁角色解析（逐行 + N阶 + 冒号列表）
function parseSRText(srText) {
  const out = [];
  if (!srText) return out;
  const lines = srText.split('\n').map(l => l.trim()).filter(Boolean);
  let pendingCons = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\d+$/.test(line)) { pendingCons = parseInt(line, 10); continue; }
    const mm = line.match(/^(\d+)\+(\d+)$/);
    if (mm) { pendingCons = parseInt(mm[1], 10); continue; }
    if (pendingCons !== null) {
      let name = line.replace(/LV\.?\d*$/i, '').trim().replace(/[（(].*[)）]/g, '').trim();
      if (name && name.length <= 12 && !/^\d+$/.test(name) && !/[:：]/.test(name)) out.push({ name, cons: pendingCons });
      pendingCons = null;
    }
  }
  const re = /(\d+)阶([^\s,，;；:：]+)/g;
  let m;
  while ((m = re.exec(srText))) {
    let name = m[2].replace(/LV\.?\d*$/i, '').trim();
    if (name && name.length <= 12) out.push({ name, cons: parseInt(m[1], 10) });
  }
  const cm = srText.match(/五星角色[:：]([^\n【]+)/);
  if (cm) {
    cm[1].split(/[,，]/).forEach(seg => {
      seg = seg.trim();
      if (!seg || /^\d+阶/.test(seg)) return;
      if (seg.length <= 12 && !/^\d+$/.test(seg) && !/阶$/.test(seg)) out.push({ name: seg, cons: 0 });
    });
  }
  // 白名单
  const best = {};
  out.forEach(p => {
    const key = norm(p.name);
    const canon = srIndex[key];
    if (!canon) return;
    const k2 = 'R:' + canon;
    if (best[k2] === undefined || p.cons > best[k2]) best[k2] = p.cons;
  });
  return Object.entries(best).map(([k, cons]) => ({ name: k.slice(2), cons }));
}

// 资源提取
function extractResources(text) {
  const r = { genshin: { 纠缠之缘: 0, 原石: 0, 创世结晶: 0 }, sr: { 星轨专票: 0, 星穹: 0, 古老梦华: 0 } };
  const gM = re => { const m = text.match(re); return m ? parseInt(m[1]) : 0; };
  r.genshin.纠缠之缘 = gM(/(\d+)个纠缠之缘/);
  r.genshin.原石 = gM(/(\d+)个原石/);
  r.genshin.创世结晶 = gM(/(\d+)个创世结晶/);
  r.sr.星轨专票 = Math.max(gM(/(\d+)张星轨专票/), gM(/(\d+)个星轨专票/));
  r.sr.星穹 = gM(/(\d+)个星穹/);
  r.sr.古老梦华 = gM(/(\d+)个古老梦华/);
  return r;
}

// ---------- 评分 ----------
function scoreGoods(details) {
  const rows = details.map(d => {
    let gensScore = 0, srScore = 0;
    const gensDetail = (d.gensChars || []).map(c => {
      const s = roleScore(genshinRatings[c.name], c.cons, P.genshinVersion);
      gensScore += s;
      return { name: c.name, cons: c.cons, score: Math.round(s * 10) / 10 };
    });
    const srChars = parseSRText(d.srText || '');
    const srDetail = srChars.map(c => {
      const s = roleScore(srRatings[c.name], c.cons, P.srVersion);
      srScore += s;
      return { name: c.name, cons: c.cons, score: Math.round(s * 10) / 10 };
    });
    let gensRes = 0, srRes = 0;
    const res = d.resources || { genshin: {}, sr: {} };
    if (P.includeResources) {
      gensRes = (res.genshin.纠缠之缘 || 0) * 1 + (res.genshin.原石 || 0) / 160 + (res.genshin.创世结晶 || 0) / 160;
      srRes = (res.sr.星轨专票 || 0) * 1 + (res.sr.星穹 || 0) / 160 + (res.sr.古老梦华 || 0) / 160;
    }
    const total = gensScore + srScore + gensRes + srRes;
    return {
      no: d.no, title: d.title, price: d.price,
      genshin: Math.round(gensScore * 10) / 10,
      sr: Math.round(srScore * 10) / 10,
      genshinRes: Math.round(gensRes * 10) / 10,
      srRes: Math.round(srRes * 10) / 10,
      gensDetail, srDetail,
      gensResources: res.genshin, srResources: res.sr,
      total: Math.round(total * 10) / 10,
      ratio: d.price > 0 ? Math.round(total / d.price * 100) / 100 : 0,
    };
  });
  return rows;
}

// ---------- 报告 ----------
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function chipHtml(items) {
  return items.slice().sort((a, b) => b.score - a.score).map(d =>
    '<span class="chip">' + esc(d.name) + ' ' + d.cons + '命 ' + d.score + '</span>').join('');
}
function detailCell(r, mode) {
  const m = mode || 'both';
  let h = '';
  if ((m === 'both' || m === 'genshin') && (r.gensDetail || []).length) h += '<details><summary>原神明细 (' + r.gensDetail.length + '角色, ' + r.genshin + '分)</summary><div class="srlist">' + chipHtml(r.gensDetail) + '</div></details>';
  if ((m === 'both' || m === 'sr') && (r.srDetail || []).length) h += '<details><summary>崩铁明细 (' + r.srDetail.length + '角色, ' + Math.round(((r.sr || 0) + (r.srFromTitle || 0)) * 10) / 10 + '分)</summary><div class="srlist">' + chipHtml(r.srDetail) + '</div></details>';
  if (P.includeResources && (r.genshinRes > 0 || r.srRes > 0)) {
    const resLabel = m === 'genshin' ? '资源分 原神+' + r.genshinRes : m === 'sr' ? '资源分 崩铁+' + r.srRes : '资源分 原神+' + r.genshinRes + ' 崩铁+' + r.srRes;
    h += '<details><summary>' + resLabel + '</summary><div class="srlist">';
    if (m !== 'sr') {
      const gp = [];
      if (r.gensResources.纠缠之缘) gp.push('纠缠' + r.gensResources.纠缠之缘);
      if (r.gensResources.原石) gp.push('原石' + r.gensResources.原石);
      if (r.gensResources.创世结晶) gp.push('结晶' + r.gensResources.创世结晶);
      if (gp.length) h += '<span class="chip">原神: ' + gp.join(' ') + '</span>';
    }
    if (m !== 'genshin') {
      const sp = [];
      if (r.srResources.星轨专票) sp.push('专票' + r.srResources.星轨专票);
      if (r.srResources.星穹) sp.push('星穹' + r.srResources.星穹);
      if (r.srResources.古老梦华) sp.push('梦华' + r.srResources.古老梦华);
      if (sp.length) h += '<span class="chip">崩铁: ' + sp.join(' ') + '</span>';
    }
    h += '</div></details>';
  }
  return h || '<span style="color:#999">—</span>';
}

function buildReport(rows, sortBy, mode) {
  const m = mode || 'both';
  const byScore = rows.slice().sort((a, b) => b.total - a.total);
  const byRatio = rows.slice().filter(r => r.price > 0).sort((a, b) => b.ratio - a.ratio);
  // 表格列：both=原神分/崩铁分/崩铁资源；genshin=原神分/资源分；sr=崩铁分/崩铁资源
  const ths = m === 'genshin' ? '<th>原神分</th><th>资源分</th>'
    : m === 'sr' ? '<th>崩铁分</th><th>崩铁资源</th>'
    : '<th>原神分</th><th>崩铁分</th><th>崩铁资源</th>';
  const table = (list, title) => {
    const tp = list.reduce((a, r) => a + r.price, 0);
    const ts = list.reduce((a, r) => a + r.total, 0);
    let h = '<h2>' + title + '</h2><p class="meta">共 ' + list.length + ' 个账号 · 总价 ¥' + tp.toLocaleString() + ' · 总价值分 ' + Math.round(ts * 10) / 10 + ' · 整体性价比 ' + Math.round(ts / tp * 100) / 100 + ' 分/元</p><table><thead><tr><th>#</th><th>编号</th><th>价格</th>' + ths + '<th>总分</th><th>分/元</th><th>标题</th><th>明细</th></tr></thead><tbody>';
    list.forEach((r, i) => {
      // 崩铁分 = 详情分 + 标题分；崩铁资源 = 详情资源 + 标题资源
      const srTotal = Math.round(((r.sr || 0) + (r.srFromTitle || 0)) * 10) / 10;
      const srResTotal = Math.round(((r.srRes || 0) + (r.srResFromTitle || 0)) * 10) / 10;
      let scoreTds;
      if (m === 'genshin') scoreTds = '<td class="num">' + r.genshin + '</td><td class="num">' + (r.genshinRes || 0) + '</td>';
      else if (m === 'sr') scoreTds = '<td class="num">' + srTotal + '</td><td class="num">' + srResTotal + '</td>';
      else scoreTds = '<td class="num">' + r.genshin + '</td><td class="num">' + srTotal + '</td><td class="num">' + srResTotal + '</td>';
      h += '<tr><td>' + (i + 1) + '</td><td><a href="https://www.pzds.com/goodsDetails/' + esc(r.no) + '/6" target="_blank">' + esc(r.no) + '</a>' + (r.srLinked ? ' <span class="chip">→' + esc(r.srLinked) + '</span>' : '') + '</td>' +
        '<td class="num">¥' + (r.price || '-').toLocaleString() + '</td>' +
        scoreTds +
        '<td class="num strong">' + r.total + '</td><td class="num">' + r.ratio + '</td>' +
        '<td class="t">' + esc(r.title).slice(0, 60) + '</td><td>' + detailCell(r, m) + '</td></tr>';
    });
    return h + '</tbody></table>';
  };
  const rule = '基础分=评分×' + (10 * P.baseFactor) + ' · 版本衰减×' + P.decay + '分/小版本(原神' + P.genshinVersion + '/崩铁' + P.srVersion + ') · 命座递进' + P.consProgression + '(n(n+1)/2) · 1命×' + P.c1Factor + ' · 0命' + (P.zeroCons ? '不算分' : '减半') + (P.includeResources ? ' · 含资源分' : '') + ' · 常驻池不计分';
  const title = m === 'genshin' ? '原神账号价值分报告' : m === 'sr' ? '崩铁账号价值分报告' : '原神 + 崩铁 连体账号价值分报告';
  const sumDesc = m === 'genshin' ? '总分=原神分+资源分' : m === 'sr' ? '总分=崩铁分+资源分' : '总分=原神分+崩铁分+资源分';
  return '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>' + title + '</title><style>' +
    'body{font-family:"Microsoft YaHei",sans-serif;margin:20px;background:#f7f8fa;color:#222}h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-left:4px solid #4a7;padding-left:8px}' +
    '.meta{color:#666;font-size:13px}table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}' +
    'th{background:#eef3ee;position:sticky;top:0}tr:nth-child(even){background:#fafbfa}.num{text-align:right;white-space:nowrap}.strong{font-weight:bold;color:#c33}' +
    '.t{max-width:340px;font-size:12px;color:#555}.chip{display:inline-block;background:#eef7ee;border:1px solid #cde5cd;border-radius:10px;padding:1px 7px;margin:1px;font-size:11px;white-space:nowrap}' +
    '.srlist{max-height:160px;overflow:auto}details{margin:2px 0}summary{cursor:pointer;font-size:12px;color:#2a6}' +
    '</style></head><body><h1>' + title + '</h1><p class="meta">评分规则：' + rule + ' · ' + sumDesc + '</p>' +
    table(sortBy === 'ratio' ? byRatio : byScore, sortBy === 'ratio' ? '按性价比(分/元)排序' : '按总价值分排序') +
    table(sortBy === 'ratio' ? byScore : byRatio, sortBy === 'ratio' ? '按总价值分排序' : '按性价比(分/元)排序') +
    '</body></html>';
}

// ---------- 星铁列表抓取（CDP 网页筛选 + 标题解析，绕开详情页 WAF） ----------
// 从星铁列表页 goodsList/213 筛选连体原神号，标题含完整崩铁数据 + unionMainGoodsNo 关联原神号
async function fetchSrLinkedList() {
  const linked = [];
  let tabs;
  try {
    tabs = await jsonRequest('GET', 'http://127.0.0.1:' + P.cdpPort + '/json/list');
  } catch (e) {
    throw new Error('CDP 不可用: ' + e.message);
  }
  const tab = tabs.find(t => t.type === 'page' && t.url.includes('goodsList/213')) || tabs.find(t => t.type === 'page' && t.url.includes('goodsList')) || tabs.find(t => t.type === 'page');
  if (!tab) throw new Error('未找到 Chrome 标签页');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;
  const pending = {};
  function send(method, params) {
    return new Promise((resolve) => {
      const msgId = ++id;
      pending[msgId] = resolve;
      ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
    });
  }
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
  });
  await new Promise(res => ws.on('open', res));
  await send('Page.enable');
  await send('Runtime.enable');
  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : null;
  }

  // 导航到星铁列表页
  await send('Page.navigate', { url: 'https://www.pzds.com/goodsList/213?from=' + Date.now() });
  await sleep(9000);
  // 等待加载
  for (let w = 0; w < 6; w++) {
    const cnt = await ev(`(() => { const l = (document.documentElement.outerHTML.match(/goodsDetails\\/([A-Z0-9]{4,6})\\/6/g) || []); return [...new Set(l)].length; })()`);
    if (cnt > 0) break;
    await sleep(3000);
  }
  // 1. 填价格
  progress({ phase: 'sr-filter', message: '星铁列表筛选（价格/未绑定邮箱/连体原神）...' });
  console.log('星铁列表筛选...');
  if (P.minPrice || P.maxPrice) {
    const fr = await ev(`(() => {
      const inputs = [...document.querySelectorAll('input')];
      const min = inputs.find(i => (i.placeholder || '') === '最低值');
      const max = inputs.find(i => (i.placeholder || '') === '最高值');
      if (!min || !max) return '无价格框';
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      if (${P.minPrice}) { setter.call(min, '${P.minPrice}'); min.dispatchEvent(new Event('input', { bubbles: true })); }
      if (${P.maxPrice}) { setter.call(max, '${P.maxPrice}'); max.dispatchEvent(new Event('input', { bubbles: true })); }
      min.dispatchEvent(new Event('change', { bubbles: true }));
      max.dispatchEvent(new Event('change', { bubbles: true }));
      return 'filled';
    })()`);
    console.log('填价格: ' + fr);
    await sleep(2500);
  }
  // 2. 点未绑定邮箱
  if (args.unboundMail !== false) {
    const mr = await ev(`(() => {
      const els = [...document.querySelectorAll('.opt-item-name')].filter(el => (el.innerText || '').trim() === '未绑定邮箱');
      if (!els.length) return '无未绑定邮箱选项';
      els[0].click(); return 'clicked';
    })()`);
    console.log('点未绑定邮箱: ' + mr);
    await sleep(2500);
  }
  // 3. 展开 + 连体游戏 → 原神（仅"连体"模式筛选连体原神号；"仅崩铁"模式抓列表全部崩铁账号）
  if (P.mode !== 'sr' && args.linkedSR !== false) {
    await ev(`(() => { const e=[...document.querySelectorAll('.down')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0}); if(e.length)e[0].click(); return e.length; })()`);
    await sleep(1500);
    const gr = await ev(`(() => {
      const els = [...document.querySelectorAll('.opt-item-name')].filter(el => (el.innerText || '').trim() === '原神');
      if (!els.length) return '无原神选项';
      els[0].click(); return 'clicked';
    })()`);
    console.log('点连体游戏-原神: ' + gr);
    await sleep(3500);
  }

  // 4. 滚动加载
  const targetCount = Math.max(20, P.pages * 10 * 2);
  let lastCount = 0, stable = 0;
  for (let i = 0; i < 30; i++) {
    const html = await ev('document.documentElement.outerHTML') || '';
    const cards = parseSrCards(html);
    cards.forEach(c => { if (!linked.some(x => x.no === c.no)) linked.push(c); });
    if (linked.length === lastCount) stable++; else stable = 0;
    lastCount = linked.length;
    console.log('星铁滚动' + (i + 1) + ': ' + linked.length + ' 个');
    if (linked.length >= targetCount || stable >= 3) break;
    await ev('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(3500);
    await ev('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(2500);
  }
  ws.close();
  // 仅连体模式：只保留连体号（含 unionMainGoodsNo）；仅崩铁模式：返回列表全部崩铁账号
  if (P.mode !== 'sr') {
    const withUnion = linked.filter(c => c.unionNo);
    console.log('星铁连体号总数: ' + linked.length + ', 含原神关联号: ' + withUnion.length);
    return withUnion;
  }
  console.log('崩铁账号总数: ' + linked.length);
  return linked;
}

// 从星铁列表 HTML 提取卡片（含 unionMainGoodsNo 关联原神号）
function parseSrCards(html) {
  const out = [];
  const cardRe = /<a [^>]*href="\/goodsDetails\/([A-Z0-9]{4,6})\/6[^"]*"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = cardRe.exec(html))) {
    const no = m[1];
    if (no === 'BTGKYY') continue; // 活动广告
    const title = m[2];
    const inner = m[3];
    const priceM = inner.match(/newGoodsList_box_pir[^>]*>¥\s*([\d,]+)/);
    const price = priceM ? parseInt(priceM[1].replace(/,/g, '')) : 0;
    if (price >= 999990) continue;
    const unionM = m[0].match(/unionMainGoodsNo=([A-Z0-9]+)/);
    out.push({ no, title, price, unionNo: unionM ? unionM[1] : null });
  }
  return out;
}

// 从星铁标题解析崩铁数据（角色命座 + 资源）
function parseSrTitle(title) {
  const result = { chars: [], resources: { 星轨专票: 0, 星穹: 0, 古老梦华: 0 }, title };
  if (!title) return result;
  // 角色：满命X / N命X / 0命X 格式
  const re = /(\d+)命([\u4e00-\u9fa5A-Za-z·&]+)/g;
  let m;
  while ((m = re.exec(title))) {
    const name = m[2].trim();
    const cons = parseInt(m[1]);
    if (name && name.length <= 10 && cons >= 0 && cons <= 6) result.chars.push({ name, cons });
  }
  const m6 = title.match(/满命([\u4e00-\u9fa5A-Za-z·&]+)/g);
  if (m6) m6.forEach(s => { const name = s.replace('满命', ''); if (name && name.length <= 10) result.chars.push({ name, cons: 6 }); });
  // 资源
  const gM = re2 => { const mm = title.match(re2); return mm ? parseInt(mm[1]) : 0; };
  result.resources.星轨专票 = Math.max(gM(/(\d+)张星轨专票/), gM(/(\d+)个星轨专票/));
  result.resources.星穹 = gM(/(\d+)个星穹/);
  result.resources.古老梦华 = gM(/(\d+)个古老梦华/);
  return result;
}

// 星铁标题角色评分（白名单过滤评分表）
function scoreSrFromTitle(cards) {
  return cards.map(c => {
    const parsed = parseSrTitle(c.title);
    // 白名单过滤
    const best = {};
    parsed.chars.forEach(ch => {
      const key = norm(ch.name);
      const canon = srIndex[key];
      if (!canon) return;
      const k2 = 'R:' + canon;
      if (best[k2] === undefined || ch.cons > best[k2]) best[k2] = ch.cons;
    });
    const rated = Object.entries(best).map(([k, cons]) => ({ name: k.slice(2), cons }));
    let srScore = 0;
    const detail = rated.map(r => {
      const s = roleScore(srRatings[r.name], r.cons, P.srVersion);
      srScore += s;
      return { name: r.name, cons: r.cons, score: Math.round(s * 10) / 10 };
    });
    const srRes = (parsed.resources.星轨专票 || 0) * 1 + (parsed.resources.星穹 || 0) / 160 + (parsed.resources.古老梦华 || 0) / 160;
    const total = srScore + srRes;
    return {
      no: c.no, title: c.title, price: c.price, unionNo: c.unionNo,
      genshin: 0, sr: Math.round(srScore * 10) / 10,
      genshinRes: 0, srRes: Math.round(srRes * 10) / 10,
      gensDetail: [], srDetail: detail,
      gensResources: {}, srResources: parsed.resources,
      total: Math.round(total * 10) / 10,
      ratio: c.price > 0 ? Math.round(total / c.price * 100) / 100 : 0,
    };
  });
}


// ---------- 主流程 ----------
(async () => {
  progress({ phase: 'start', message: '开始' });
  console.log('参数: ' + JSON.stringify(P));
  // 动作: "report"=抓取+分析（默认）| "fetch"=仅抓取 | "analyze"=仅分析已抓数据
  const action = args.action || 'report';
  // 确保 CDP 可用（自动启动调试 Chrome）；仅"分析"模式无需联网/Chrome
  if (action !== 'analyze') {
    const cdp = await ensureCdp(P.cdpPort, 30000);
    if (!cdp.ok) {
      progress({ phase: 'error', message: 'CDP 不可用: ' + cdp.error });
      console.error('CDP 不可用: ' + cdp.error);
      process.exit(1);
    }
    if (cdp.spawned) console.log('已自动启动调试 Chrome (port ' + P.cdpPort + ')');
  }
  // 结果行集合与报告模式（sr 分支 / 常规分支共用报告段）
  let filtered = [];
  let modeLabel = P.mode === 'sr' ? 'sr' : P.mode === 'genshin' ? 'genshin' : 'both';
  // 仅补崩铁模式：复用上次 SSR 结果，只对缺崩铁数据的连体号补抓
  if (args.srOnly) {
    console.log('仅补崩铁模式');
    let details = [];
    try { details = JSON.parse(fs.readFileSync(DETAILS, 'utf8')) || []; } catch (e) { details = []; }
    const needSR = details.filter(d => d.hasSR && !d.srText);
    console.log('待补崩铁: ' + needSR.length + ' 个');
    if (!needSR.length) { console.log('无需补抓'); progress({ phase: 'done', message: '无需补抓' }); process.exit(0); }
    const srResults = await cdpFetchSrOnly(needSR);
    // 合并回 details
    srResults.forEach(sr => {
      const d = details.find(x => x.no === sr.no);
      if (d) { d.srText = sr.srText; d.resources = sr.resources; d.hasSR = sr.hasSR; }
    });
    fs.writeFileSync(DETAILS, JSON.stringify(details, null, 1));
    console.log('崩铁补抓完成');
    progress({ phase: 'done', message: '崩铁补抓完成' });
    process.exit(0);
  }
  // 星铁列表模式：从星铁列表页抓连体号数据（绕开详情页WAF），输出星铁侧数据
  if (args.srListOnly) {
    console.log('星铁列表模式');
    const srCards = await fetchSrLinkedList();
    const srScored = scoreSrFromTitle(srCards);
    const srOut = {
      fetched: new Date().toLocaleString('zh-CN'),
      count: srScored.length,
      items: srScored,
    };
    fs.writeFileSync(path.join(PLUGIN_DIR, 'sr_list_data.json'), JSON.stringify(srOut, null, 2));
    console.log('星铁列表抓取完成: ' + srScored.length + ' 个连体号');
    console.log('含崩铁角色分的: ' + srScored.filter(x => x.sr > 0).length);
    srScored.slice(0, 5).forEach(x => console.log('  ' + x.no + ' -> 原神' + x.unionNo + ' 崩铁分' + x.sr + ' 崩铁资源' + x.srRes + ' ¥' + x.price));
    progress({ phase: 'done', message: '星铁列表抓取完成: ' + srScored.length + ' 个' });
    process.exit(0);
  }
  // ══ 第一步：获取数据（fetch / report 共用；analyze 读取指定数据集）════
  let details = null;
  let dsId = null;             // 当前数据集 id（analyze 必填；report 抓+分析时新建）
  const isAnalyze = action === 'analyze';
  if (isAnalyze) {
    // 读数据集：优先 args.datasetId，缺省取最新
    let dataFile = null;
    if (args.datasetId) {
      dsId = String(args.datasetId);
      dataFile = path.join(DATASETS, dsId, 'data.json');
    } else {
      let idx = [];
      try { idx = JSON.parse(fs.readFileSync(DATASETS_INDEX, 'utf8')) || []; } catch (e) { idx = []; }
      if (idx.length) { dsId = idx[0].id; dataFile = path.join(DATASETS, dsId, 'data.json'); }
      else dataFile = DETAILS; // 兜底：旧 details.json（无数据集时）
    }
    try { details = JSON.parse(fs.readFileSync(dataFile, 'utf8')) || []; } catch (e) { details = []; }
    if (!details.length) {
      progress({ phase: 'error', message: '没有可分析的数据，请先点击"获取数据"' });
      console.error('没有可分析的数据: ' + dataFile);
      process.exit(1);
    }
    console.log('分析模式: 读取数据集 ' + (dsId || '(旧数据)') + ' ' + details.length + ' 个账号（无需重新抓取）');
  } else {
    if (P.mode === 'sr') {
      console.log('获取数据（仅崩铁）: 星铁列表 goodsList/213 → 详情抓取');
      const srCards = await fetchSrLinkedList();
      progress({ phase: 'list-done', done: srCards.length, total: srCards.length, message: '崩铁列表抓取完成: ' + srCards.length + ' 个账号' });
      if (!srCards.length) { progress({ phase: 'error', message: '崩铁列表为空' }); process.exit(1); }
      details = await cdpFetchDetailsParallel(srCards);
      progress({ phase: 'detail-done', done: details.length, total: details.length, message: '崩铁详情抓取完成' });
    } else {
      // 1. 列表（原神列表；"连体"模式筛崩铁连体，"仅原神"模式不筛）
      const goods = await fetchList();
      progress({ phase: 'list-done', done: goods.length, total: goods.length, message: '列表抓取完成: ' + goods.length + ' 个商品' });
      console.log('列表: ' + goods.length + ' 个商品');
      if (!goods.length) { progress({ phase: 'error', message: '列表为空' }); process.exit(1); }
      // 2. 详情（CDP 多 tab 并发：原神 + 崩铁 + 资源一次抓完；仅原神模式跳过崩铁）
      details = await cdpFetchDetailsParallel(goods);
      progress({ phase: 'detail-done', done: details.length, total: details.length, message: '详情抓取完成' });
    }
    // 保存数据 + 创建数据集（每次"获取数据"产生新数据集；报告与数据集 1:1 覆盖）
    dsId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const dsDir = path.join(DATASETS, dsId);
    try {
      fs.mkdirSync(dsDir, { recursive: true });
      fs.writeFileSync(path.join(dsDir, 'data.json'), JSON.stringify(details, null, 1), 'utf8');
    } catch (e) { console.log('保存数据集失败: ' + e.message); }
    let dsIndex = [];
    try { dsIndex = JSON.parse(fs.readFileSync(DATASETS_INDEX, 'utf8')) || []; } catch (e) { dsIndex = []; }
    dsIndex.unshift({ id: dsId, time: new Date().toLocaleString('zh-CN'), mode: P.mode, count: details.length, reportFile: null, updatedAt: Date.now() });
    try { fs.writeFileSync(DATASETS_INDEX, JSON.stringify(dsIndex, null, 2), 'utf8'); } catch (e) { console.log('数据集索引写入失败: ' + e.message); }
    // 兼容旧 details.json（供无数据集时的兜底）
    try { fs.writeFileSync(DETAILS, JSON.stringify(details, null, 1)); } catch (e) {}
    if (action === 'fetch') {
      const fetchResult = { message: '数据已获取', datasetId: dsId, count: details.length, mode: P.mode };
      try { fs.writeFileSync(RESULT, JSON.stringify(fetchResult, null, 2), 'utf8'); } catch (e) {}
      progress({ phase: 'done', message: '数据获取完成: 数据集 ' + dsId + ' ' + details.length + ' 个账号（在下方列表点"分析"生成报告）' });
      console.log('数据获取完成: 数据集 ' + dsId + ' ' + details.length + ' 个账号');
      process.exit(0);
    }
  }

  // ══ 第二步：分析（analyze / report 共用）════
  // 3. 筛选（未绑定邮箱 + 连体崩铁（仅连体模式）+ 价格）
  let filteredDetails = details;
  if (args.unboundMail !== false) {
    filteredDetails = filteredDetails.filter(d => d.mailInfo === true);
    console.log('筛选未绑定邮箱: ' + filteredDetails.length + ' 个');
  }
  if (args.linkedSR !== false && P.mode !== 'genshin') {
    filteredDetails = filteredDetails.filter(d => d.hasSR === true);
    console.log('筛选连体崩铁: ' + filteredDetails.length + ' 个');
  }
  if (P.minPrice) filteredDetails = filteredDetails.filter(d => d.price >= P.minPrice);
  if (P.maxPrice) filteredDetails = filteredDetails.filter(d => d.price <= P.maxPrice);
  // 4. 评分
  const rows = scoreGoods(filteredDetails);
  filtered = P.minScore ? rows.filter(r => r.total >= P.minScore) : rows;
  modeLabel = P.mode === 'sr' ? 'sr' : P.mode === 'genshin' ? 'genshin' : 'both';
  // 4.5 星铁列表合并（可选，仅连体模式默认关闭）：从星铁列表抓连体号补充崩铁资源分
  if (args.srList === true && P.mode === 'both') {
    console.log('抓取星铁列表连体号（补充崩铁资源分）...');
    try {
      const srCards = await fetchSrLinkedList();
      const srScored = scoreSrFromTitle(srCards);
      fs.writeFileSync(path.join(PLUGIN_DIR, 'sr_list_data.json'), JSON.stringify({ fetched: new Date().toLocaleString('zh-CN'), count: srScored.length, items: srScored }, null, 2));
      // 按原神号关联：星铁号.unionNo -> 原神号
      const srByUnion = {};
      srScored.forEach(s => { if (s.unionNo) srByUnion[s.unionNo] = s; });
      let merged = 0;
      filtered = filtered.map(r => {
        const srItem = srByUnion[r.no];
        if (srItem) {
          merged++;
          return { ...r, srLinked: srItem.no, srFromTitle: srItem.sr, srResFromTitle: srItem.srRes, srResourcesTitle: srItem.srResources };
        }
        return r;
      });
      console.log('关联到星铁连体号: ' + merged + ' 个');
    } catch (e) {
      console.log('星铁列表抓取失败（跳过）: ' + (e && e.message));
    }
  }
  // 5. 报告（analyze 写数据集报告覆盖式；report 模式写时间戳报告）
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const REPORT_PATH = dsId
    ? path.join(DATASETS, dsId, 'report.html')          // 数据集 1:1 报告（重复分析覆盖）
    : path.join(PLUGIN_DIR, 'reports', 'pzds_report_' + ts + '.html');
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const html = buildReport(filtered, args.sortBy || 'score', modeLabel);
  fs.writeFileSync(REPORT_PATH, html, 'utf8');
  // 同时更新当前报告（供预览路由）
  try { fs.writeFileSync(REPORT, html, 'utf8'); } catch (e) {}
  const result = {
    reportPath: REPORT_PATH,
    datasetId: dsId || null,
    count: filtered.length,
    totalPrice: filtered.reduce((a, r) => a + r.price, 0),
    totalScore: Math.round(filtered.reduce((a, r) => a + r.total, 0) * 10) / 10,
    filters: { mode: modeLabel, unboundMail: args.unboundMail !== false, linkedSR: args.linkedSR !== false, minPrice: P.minPrice, maxPrice: P.maxPrice },
    top: filtered.slice().sort((a, b) => b.total - a.total).slice(0, 10).map(r => ({
      no: r.no, price: r.price, genshin: r.genshin, sr: r.sr, genshinRes: r.genshinRes, srRes: r.srRes, total: r.total, ratio: r.ratio,
    })),
  };
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2), 'utf8');
  // 6. 更新数据集索引（analyze 时记录报告文件，1 数据集 ↔ 1 报告，重复分析覆盖）
  if (dsId) {
    try {
      let dsIndex = [];
      try { dsIndex = JSON.parse(fs.readFileSync(DATASETS_INDEX, 'utf8')) || []; } catch (e) { dsIndex = []; }
      const it = dsIndex.find(x => x && x.id === dsId);
      if (it) {
        it.reportFile = 'datasets/' + dsId + '/report.html';
        it.updatedAt = Date.now();
        it.lastResult = { count: result.count, totalScore: result.totalScore, totalPrice: result.totalPrice };
      }
      fs.writeFileSync(DATASETS_INDEX, JSON.stringify(dsIndex, null, 2), 'utf8');
    } catch (e) { console.log('数据集索引更新失败: ' + e.message); }
  }
  progress({ phase: 'done', message: '完成: 数据集 ' + (dsId || '') + ' 报告已生成（可改规则重新分析覆盖）', result });
  console.log('完成: ' + filtered.length + ' 个账号, 报告: ' + REPORT_PATH);
  process.exit(0);
})().catch(e => {
  progress({ phase: 'error', message: String(e && e.message || e) });
  console.error('失败: ' + (e && e.stack || e));
  process.exit(1);
});
