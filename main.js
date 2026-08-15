// DeepSeek Harness Desktop — embedded launcher for the dsh web GUI.
//
// Flow on launch:
//   1. Use the bundled runtime when packaged (resources/dsh-runtime/node.exe
//      + full dependency tree), so machines without node/dsh/npx work out of
//      the box. In dev (unpackaged) fall back to the npx cache.
//   2. If http://127.0.0.1:<port> is already answering, reuse it; otherwise
//      spawn `node <dsh>/lib/bin.js web` (hidden console) and wait until ready.
//   3. Show the UI in an embedded window. Closing the window hides to the
//      tray (the server keeps running); "退出" from the tray stops the server
//      we started and quits.
//   4. Optional auto-start at login (tray toggle) — starts hidden to the tray.
//
// Port override: set DSH_PORT to run the server on another port.

const { app, BrowserWindow, dialog, shell, Tray, Menu, nativeImage } = require("electron");
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

// Auto-update support (packaged builds only). Loaded lazily so dev runs are
// unaffected: electron-updater requires the packaged app-update.yml to know
// the publish provider (here: GitHub Releases on timefeishi/dsh).
let autoUpdater = null;
function getAutoUpdater() {
  if (autoUpdater === null) {
    autoUpdater = require("electron-updater").autoUpdater;
    autoUpdater.autoDownload = false; // ask the user before downloading
    autoUpdater.autoInstallOnAppQuit = true; // install silently on quit
  }
  return autoUpdater;
}

const PORT = Number(process.env.DSH_PORT) || 3080;
const URL = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 120_000; // first boot on a fresh machine may be slow
const POLL_INTERVAL_MS = 500;
const AUTO_START_ARG = "--dsh-autostart";

// Allow relocating user data (logs, single-instance lock scope). Useful for
// testing parallel instances or keeping data off the default location.
if (process.env.DSH_USER_DATA_DIR) {
  app.setPath("userData", process.env.DSH_USER_DATA_DIR);
}

let mainWindow = null;
let tray = null;
let serverChild = null;
let startedByUs = false;
let quitting = false;

// ── locating / preparing the dsh runtime ─────────────────────────────────
// Packaged: the installer ships dsh-runtime.tar.gz + dsh-runtime.sha256
// (single file, fast install). On first launch (or whenever the hash — the
// dependency fingerprint — differs) we extract it to the user data dir, so:
//   * install is fast (one big file, not 33k small ones)
//   * dependency changes (add/remove/upgrade) re-extract automatically
// Dev: newest @deepseek-ai/dsh under the npx cache, else `npx --yes`.

const RUNTIME_DIR = "dsh-runtime";

function runtimeRoot() {
  return path.join(app.getPath("userData"), RUNTIME_DIR);
}

function findBundledNode() {
  const p = path.join(runtimeRoot(), "node.exe");
  return fs.existsSync(p) ? p : null;
}

function findBundledDshBin() {
  const p = path.join(runtimeRoot(), "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  return fs.existsSync(p) ? p : null;
}

// Where the installer placed the packed runtime.
function packedRuntimePaths() {
  if (!app.isPackaged) return null;
  const gz = path.join(process.resourcesPath, "dsh-runtime.tar.gz");
  const sha = path.join(process.resourcesPath, "dsh-runtime.sha256");
  if (!fs.existsSync(gz) || !fs.existsSync(sha)) return null;
  return { gz, sha };
}

// Expected dependency fingerprint (from the installer's sha file).
function expectedRuntimeHash() {
  const packed = packedRuntimePaths();
  if (!packed) return null;
  try {
    return fs.readFileSync(packed.sha, "utf8").trim().toLowerCase();
  } catch {
    return null;
  }
}

// Fingerprint of the currently extracted runtime (stored next to it).
function extractedRuntimeHash() {
  const marker = path.join(runtimeRoot(), ".dsh-runtime.sha256");
  try {
    return fs.readFileSync(marker, "utf8").trim().toLowerCase();
  } catch {
    return null;
  }
}

function writeExtractedHash(hash) {
  try {
    fs.writeFileSync(path.join(runtimeRoot(), ".dsh-runtime.sha256"), hash + "\n");
  } catch {}
}

// Extract dsh-runtime.tar.gz into userData. Uses tar.exe (bundled with
// Windows 10/11); falls back to a Node-side gunzip+untar if tar is missing.
// The archive contains a top-level "dsh-runtime/" entry, so extract into
// userData directly — the prefix lands at userData/dsh-runtime.
// onProgress({phase, percent, text}) is invoked for UI feedback.
function extractRuntime(onProgress) {
  return new Promise((resolve, reject) => {
    const packed = packedRuntimePaths();
    if (!packed) { reject(new Error("packed runtime not found")); return; }

    const userData = app.getPath("userData");
    const dest = runtimeRoot();
    if (fs.existsSync(dest)) {
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
    }
    fs.mkdirSync(userData, { recursive: true });

    const tar = path.join(process.env.WINDIR || "C:\\Windows", "System32", "tar.exe");
    const useTar = fs.existsSync(tar);
    if (useTar) {
      appendLog(`extracting runtime via tar (${packed.gz})`);
      if (onProgress) onProgress({ phase: "extract", percent: 0, text: "正在解压运行环境…" });
      const child = spawn(tar, ["-xzf", packed.gz, "-C", userData], { windowsHide: true });
      // tar has no incremental progress; poll the extracted file count and
      // scale it against the known archive size to drive a progress bar.
      let polled = 0;
      const pollTimer = setInterval(() => {
        const count = countFiles(dest);
        if (count > polled) {
          polled = count;
          const percent = Math.min(95, Math.round((count / 24000) * 100));
          if (onProgress) onProgress({ phase: "extract", percent, text: `正在解压运行环境…（${count} 个文件）` });
        }
      }, 300);
      child.on("error", (err) => { clearInterval(pollTimer); reject(err); });
      child.on("exit", (code) => {
        clearInterval(pollTimer);
        if (code === 0) {
          if (onProgress) onProgress({ phase: "extract", percent: 100, text: "解压完成" });
          resolve();
        } else reject(new Error(`tar exit ${code}`));
      });
      return;
    }

    // Fallback: pure-Node extraction (slower, but no external dependency).
    appendLog("tar.exe not found, extracting with Node zlib fallback");
    if (onProgress) onProgress({ phase: "extract", percent: 0, text: "正在解压运行环境…" });
    const zlib = require("zlib");
    const readStream = fs.createReadStream(packed.gz);
    const gunzip = zlib.createGunzip();
    let pending = Buffer.alloc(0);
    readStream.pipe(gunzip);
    gunzip.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (onProgress) onProgress({ phase: "extract", percent: Math.min(50, Math.round((pending.length / 90000000) * 50)), text: "正在解压运行环境…" });
    });
    gunzip.on("end", () => {
      try {
        untarBuffer(pending, userData, onProgress);
        if (onProgress) onProgress({ phase: "extract", percent: 100, text: "解压完成" });
        resolve();
      } catch (err) { reject(err); }
    });
    gunzip.on("error", reject);
    readStream.on("error", reject);
  });
}

function countFiles(dir) {
  let n = 0;
  try {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name));
        else n++;
      }
    };
    walk(dir);
  } catch {}
  return n;
}

// Minimal POSIX ustar reader for the fallback path.
function untarBuffer(buf, dest, onProgress) {
  const paths = [];
  let off = 0;
  let written = 0;
  while (off + 512 <= buf.length) {
    const header = buf.slice(off, off + 512);
    const name = header.slice(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (name.length === 0) break;
    const sizeStr = header.slice(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeStr, 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const filePath = path.join(dest, name);
    if (type === "5") {
      fs.mkdirSync(filePath, { recursive: true });
    } else if (type === "0" || type === "") {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buf.slice(off + 512, off + 512 + size));
      paths.push(filePath);
      written += size;
      if (onProgress && written % 5000000 < size) {
        onProgress({ phase: "extract", percent: Math.min(95, Math.round(50 + (written / 90000000) * 45)), text: `正在解压运行环境…（${paths.length} 个文件）` });
      }
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return paths;
}

// Ensure the runtime is extracted and current; returns true when ready.
async function ensureRuntime() {
  if (!app.isPackaged) return true; // dev: use npx cache below
  const expected = expectedRuntimeHash();
  const current = extractedRuntimeHash();
  if (expected && current === expected && findBundledDshBin()) {
    return true; // already up to date
  }
  if (expected) {
    appendLog(`runtime hash mismatch (expected ${expected ? expected.slice(0, 8) : "none"}, have ${current ? current.slice(0, 8) : "none"}) — re-extracting`);
    await extractRuntime((p) => {
      sendProgress(p);          // renderer toast + splash bar
      updateSplash(p.percent, p.text);
    });
    writeExtractedHash(expected);
    appendLog("runtime extracted");
    return true;
  }
  return false; // packaged but no packed runtime shipped → caller decides
}

function findCachedDshBin() {
  const npxRoot = path.join(os.homedir(), "AppData", "Local", "npm-cache", "_npx");
  let best = null;
  let bestTime = 0;
  try {
    for (const dir of fs.readdirSync(npxRoot)) {
      const cand = path.join(npxRoot, dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
      try {
        const st = fs.statSync(cand);
        if (st.mtimeMs > bestTime) {
          bestTime = st.mtimeMs;
          best = cand;
        }
      } catch {
        /* not a dsh cache entry */
      }
    }
  } catch {
    /* no npx cache at all */
  }
  return best;
}

function resolveDshInvocation() {
  const bundledNode = findBundledNode();
  const bundledBin = findBundledDshBin();
  if (bundledNode && bundledBin) {
    return { command: bundledNode, args: [bundledBin, "web", "--port", String(PORT)] };
  }
  const cached = findCachedDshBin();
  if (cached) {
    return { command: "node", args: [cached, "web", "--port", String(PORT)] };
  }
  return { command: "npx.cmd", args: ["--yes", "@deepseek-ai/dsh", "web", "--port", String(PORT)] };
}

// ── server health ─────────────────────────────────────────────────────────

function serverIsUp() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverIsUp()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

// ── logging the server output ─────────────────────────────────────────────

function logFile() {
  const base = app.isPackaged
    ? path.join(app.getPath("userData"), "logs")
    : path.join(app.getAppPath(), "logs");
  try {
    fs.mkdirSync(base, { recursive: true });
  } catch {}
  return path.join(base, "dsh-web.log");
}

function appendLog(text) {
  try {
    fs.appendFileSync(logFile(), `[${new Date().toISOString()}] ${text}\n`);
  } catch {}
}

// ── starting the server ───────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    const { command, args } = resolveDshInvocation();
    appendLog(`starting: ${command} ${args.join(" ")}`);
    let child;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err) {
      reject(err);
      return;
    }
    serverChild = child;
    let outBuf = "";
    child.stdout.on("data", (d) => {
      outBuf += d;
      const lines = outBuf.split("\n");
      outBuf = lines.pop();
      for (const l of lines) appendLog(l.trimEnd());
    });
    child.stderr.on("data", (d) => {
      const text = String(d).trim();
      if (text) appendLog(`stderr: ${text}`);
    });
    child.on("error", (err) => {
      appendLog(`spawn error: ${err.message}`);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      appendLog(`server exited code=${code} signal=${signal}`);
      if (!quitting && code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
        dialog.showErrorBox(
          "DeepSeek Harness 服务异常退出",
          `dsh web 服务意外退出（code=${code}）。\n\n请查看日志：${logFile()}`
        );
      }
    });
    resolve(child);
  });
}

function killServer() {
  if (!serverChild || serverChild.exitCode !== null) return;
  appendLog("killing server");
  execFile("taskkill", ["/pid", String(serverChild.pid), "/T", "/F"], { windowsHide: true }, () => {
    /* best effort */
  });
}

// ── window & tray ─────────────────────────────────────────────────────────

function iconPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, "icon.ico");
  return path.join(app.getAppPath(), "assets", "icon.ico");
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const icon = fs.existsSync(iconPath()) ? iconPath() : undefined;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "DeepSeek Harness",
    icon,
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Inject an "更新" entry into the harness settings panel (packaged only).
  // The settings panel has a left nav list (.VOzbGW_navList > .VOzbGW_navCell)
  // and a right content pane (.VOzbGW_content). We add a "更新" nav cell that
  // reuses the native cell class (so it matches the page's styling exactly);
  // selecting it shows a "检查更新" button + progress fed by
  // window.dshUpdater.onProgress. The panel is created/destroyed by React on
  // open/close, so we use a MutationObserver to re-inject whenever it appears.
  // Nothing shows on the first screen or before the panel is opened.
  mainWindow.webContents.on("did-finish-load", () => {
    if (!app.isPackaged) return;
    mainWindow.webContents.executeJavaScript(
      `(() => {
        if (window.__dshUpdateInjected) return;
        window.__dshUpdateInjected = true;

        const style = document.createElement('style');
        style.textContent = \`
          #dsh-update-nav { width: 100%; }
          #dsh-update-nav .VOzbGW_navIcon { flex: 0 0 auto; }
          #dsh-update-check {
            padding: 8px 18px; border-radius: 10px; border: 0; cursor: pointer;
            background: rgb(235,238,242); color: rgb(15,17,21);
            font: 600 14px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            transition: background .15s;
          }
          #dsh-update-check:hover { background: rgb(221,225,231); }
          #dsh-update-check:disabled { opacity: .6; cursor: default; }
          #dsh-update-progress { margin-top: 14px; display: none; max-width: 420px; }
          #dsh-update-progress .text { font: 13px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: rgb(15,17,21); margin-bottom: 6px; }
          #dsh-update-progress .bar { height: 5px; background: rgba(15,17,21,.12); border-radius: 3px; overflow: hidden; }
          #dsh-update-progress .fill { height: 100%; width: 0%; background: rgb(15,17,21); border-radius: 3px; transition: width .25s; }
          #dsh-update-desc { font: 13px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: rgba(15,17,21,.65); margin: 8px 0 12px; }
        \`;
        document.head.appendChild(style);

        // Progress card (created once, moved into the content pane on click).
        // percent === null → text-only (no bar); percent is a number → show bar.
        const progress = document.createElement('div');
        progress.id = 'dsh-update-progress';
        progress.innerHTML = '<div class="text"></div><div class="bar"><div class="fill"></div></div>';
        function showProgress(text, percent, duration) {
          const t = progress.querySelector('.text');
          const f = progress.querySelector('.fill');
          const bar = progress.querySelector('.bar');
          if (text != null) t.textContent = text;
          if (typeof percent === 'number') {
            f.style.width = percent + '%';
            bar.style.display = 'block';
          } else {
            f.style.width = '0%';
            bar.style.display = 'none';
          }
          progress.style.display = 'block';
          clearTimeout(progress._t);
          if (duration) progress._t = setTimeout(() => { progress.style.display = 'none'; }, duration);
        }

        if (window.dshUpdater && window.dshUpdater.onProgress) {
          window.dshUpdater.onProgress((p) => {
            if (!p || p.phase === 'extract') return;
            // Only downloads carry a percent; the check result is text-only.
            showProgress(p.text, typeof p.percent === 'number' ? p.percent : null, 0);
            if (p.phase === 'download' && p.percent >= 100) {
              setTimeout(() => { progress.style.display = 'none'; }, 1500);
            }
          });
        }

        // Build the nav cell once; cloned on each re-injection (the panel's
        // React tree is recreated on open, so the element must be too).
        function buildNavCell() {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'VOzbGW_navCell';
          cell.id = 'dsh-update-nav';
          cell.style.width = '100%';
          // Minimal inline icon (download arrow) matching the native 16x16.
          cell.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="VOzbGW_navIcon" style="flex:0 0 auto">' +
            '<path d="M8 2v8m0 0l-3-3m3 3l3-3M3 12.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '<span>更新</span>';
          cell.onclick = () => {
            document.querySelectorAll('.VOzbGW_navCell').forEach((c) => c.classList.remove('VOzbGW_active'));
            cell.classList.add('VOzbGW_active');
            const content = document.querySelector('.VOzbGW_content');
            if (!content) return;
            content.innerHTML = '';
            const h = document.createElement('div');
            h.style.cssText = 'font:600 14px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: rgb(15,17,21); margin-bottom: 16px;';
            h.textContent = '更新';
            const check = document.createElement('button');
            check.id = 'dsh-update-check';
            check.textContent = '检查更新';
            check.onclick = async () => {
              if (check.disabled) return;
              check.disabled = true; check.textContent = '检查中…';
              // Text-only status while checking — no bar until a download
              // actually starts (progress arrives via onProgress with %).
              showProgress('正在检查更新…', null, 0);
              try {
                const res = await window.dshUpdater.check();
                showProgress(res, null, 4000);
              } catch (e) {
                showProgress('检查更新失败：' + (e && e.message ? e.message : e), null, 6000);
              } finally {
                check.disabled = false; check.textContent = '检查更新';
              }
            };
            const desc = document.createElement('div');
            desc.id = 'dsh-update-desc';
            desc.textContent = '检查 GitHub Releases 是否有新版本，下载完成后重启应用即可完成更新。';
            content.appendChild(h);
            content.appendChild(check);
            content.appendChild(desc);
            content.appendChild(progress);
            progress.style.display = 'none';
          };
          return cell;
        }

        // Re-inject whenever the nav list exists and lacks our cell (the
        // panel is mounted/unmounted by React on every open/close).
        function ensureInjected() {
          const list = document.querySelector('.VOzbGW_navList');
          if (!list) return;
          if (list.querySelector('#dsh-update-nav')) return;
          list.appendChild(buildNavCell());
        }
        const observer = new MutationObserver(ensureInjected);
        observer.observe(document.body, { childList: true, subtree: true });
        ensureInjected();
      })()`
    ).catch((err) => appendLog(`update button injection failed: ${err.message}`));
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(URL) || url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    appendLog(`did-fail-load ${code} ${desc} ${url}`);
  });

  // Closing the window hides to tray instead of quitting (true app behavior);
  // the server keeps running. "退出" in the tray menu really quits.
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.once("ready-to-show", () => {
    if (!quitting) mainWindow.show();
  });

  return mainWindow;
}

function showSplash(win) {
  win.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<!doctype html><html><body style="margin:0;background:#0f1115;color:#8b9cb8;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh">
         <div style="text-align:center;width:340px">
           <div style="font-size:28px;font-weight:600;color:#e8edf5;margin-bottom:10px">DeepSeek Harness</div>
           <div id="dsh-splash-text" style="margin-bottom:14px">正在启动本地服务，请稍候…</div>
           <div id="dsh-splash-bar-wrap" style="display:none;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden">
             <div id="dsh-splash-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#4d9fff,#6ee7ff);border-radius:3px;transition:width .3s"></div>
           </div>
         </div>
         <script>window.__setSplashProgress = function(p, t) { var w = document.getElementById('dsh-splash-bar-wrap'); if (w) w.style.display = (p > 0 ? 'block' : 'none'); var b = document.getElementById('dsh-splash-bar'); if (b) b.style.width = p + '%'; var x = document.getElementById('dsh-splash-text'); if (x && t) x.textContent = t; };</script>
         </body></html>`
      )
  );
}

// Push splash progress into the loading page (no-op when not ready).
function updateSplash(percent, text) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents
    .executeJavaScript(`window.__setSplashProgress(${percent}, ${JSON.stringify(text || "")})`)
    .catch(() => {});
}

// Broadcast progress to the renderer (toast/bar) and the splash.
function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("dsh:progress", payload);
  }
  if (payload.phase === "extract") {
    updateSplash(payload.percent, payload.text);
  }
}

function isAutoStartEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoStart(enabled) {
  const opts = {
    openAtLogin: enabled,
    openAsHidden: true,
    path: process.execPath,
    args: [AUTO_START_ARG],
  };
  app.setLoginItemSettings(opts);
  appendLog(`auto-start ${enabled ? "enabled" : "disabled"}`);
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: "打开 DeepSeek Harness", click: () => showMainWindow() },
    { type: "separator" },
    {
      label: "检查更新…",
      click: () => checkForUpdates(true),
    },
    {
      label: "开机自动启动",
      type: "checkbox",
      checked: isAutoStartEnabled(),
      click: (item) => setAutoStart(item.checked),
    },
    { type: "separator" },
    {
      label: "退出（停止服务）",
      click: () => {
        quitting = true;
        if (startedByUs) killServer();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

// ── auto-update ───────────────────────────────────────────────────────────

// In dev (unpackaged) there is no app-update.yml, so updater checks are no-ops.
function updaterAvailable() {
  return app.isPackaged && fs.existsSync(path.join(process.resourcesPath, "app-update.yml"));
}

function setupAutoUpdater() {
  if (!app.isPackaged || !updaterAvailable()) return;
  try {
    const updater = getAutoUpdater();
    updater.on("update-available", (info) => {
      appendLog(`update available: ${info.version}`);
      showMainWindow();
      dialog
        .showMessageBox(mainWindow, {
          type: "info",
          title: "发现新版本",
          message: `DeepSeek Harness ${info.version} 已发布`,
          detail: "是否现在下载并更新？更新完成后需要重启应用。",
          buttons: ["下载更新", "稍后"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) updater.downloadUpdate();
        });
    });
    // Live download progress → renderer (toast bar) so the user sees the
    // update downloading instead of a silent wait.
    updater.on("download-progress", (p) => {
      const percent = Math.round(p.percent || 0);
      const mb = (p.transferred / 1048576).toFixed(1);
      const total = (p.total / 1048576).toFixed(1);
      sendProgress({
        phase: "download",
        percent,
        text: `正在下载更新… ${percent}%（${mb} / ${total} MB）`,
      });
    });
    updater.on("update-downloaded", (info) => {
      appendLog(`update downloaded: ${info.version}`);
      dialog
        .showMessageBox(mainWindow, {
          type: "info",
          title: "更新已就绪",
          message: `新版本 ${info.version} 已下载完成`,
          detail: "重启应用即可完成更新。",
          buttons: ["立即重启", "稍后"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) updater.quitAndInstall();
        });
    });
    updater.on("error", (err) => {
      appendLog(`updater error: ${err && err.message ? err.message : err}`);
    });
    updater.on("update-not-available", () => {
      appendLog("no update available");
    });
  } catch (err) {
    appendLog(`updater setup failed: ${err.message}`);
  }
}

// Returns a Promise<string> describing the outcome (for the UI toast / IPC).
function checkForUpdates(manual) {
  if (!app.isPackaged || !updaterAvailable()) {
    const msg = "当前为开发模式，不支持自动更新。";
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "检查更新",
        message: msg,
      });
    }
    return Promise.resolve(msg);
  }
  try {
    const updater = getAutoUpdater();
    // Optional override: point the updater at a custom generic feed (e.g. a
    // self-hosted server or a local test server). Defaults to the GitHub
    // provider baked into app-update.yml (timefeishi/dsh).
    if (process.env.DSH_UPDATE_URL) {
      updater.setFeedURL({ provider: "generic", url: process.env.DSH_UPDATE_URL });
    }
    return updater.checkForUpdates().then(
      () => "已是最新版本",
      (err) => {
        appendLog(`checkForUpdates failed: ${err.message}`);
        if (manual) {
          dialog.showMessageBox(mainWindow, {
            type: "error",
            title: "检查更新失败",
            message: `无法连接到更新服务器：\n${err.message}`,
          });
        }
        return `检查更新失败：${err.message}`;
      }
    );
  } catch (err) {
    appendLog(`checkForUpdates threw: ${err.message}`);
    return Promise.resolve(`检查更新失败：${err.message}`);
  }
}

function createTray() {
  const icon = iconPath();
  let image = nativeImage.createEmpty();
  if (fs.existsSync(icon)) {
    image = nativeImage.createFromPath(icon);
  }
  tray = new Tray(image);
  tray.setToolTip("DeepSeek Harness");
  tray.on("click", () => showMainWindow());
  tray.on("double-click", () => showMainWindow());
  rebuildTrayMenu();
}

// ── lifecycle ─────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId("com.deepseek.dsh-desktop");

  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    createTray();
    setupAutoUpdater();

    // IPC for the injected "检查更新" button (renderer → main).
    const { ipcMain } = require("electron");
    ipcMain.handle("dsh:check-updates", () => checkForUpdates(true));

    const autoStart = process.argv.includes(AUTO_START_ARG);
    appendLog(`launch mode: ${app.isPackaged ? "packaged" : "dev"}${autoStart ? " (auto-start)" : ""}`);

    // Ensure the bundled runtime is extracted & current (packaged only).
    // Show the splash while this may take a while on first run / after an
    // update with changed dependencies.
    const win = createWindow();
    showSplash(win);
    try {
      await ensureRuntime((p) => updateSplash(p.percent, p.text));
    } catch (err) {
      appendLog(`ensureRuntime failed: ${err.message}`);
      dialog.showErrorBox(
        "DeepSeek Harness 运行环境准备失败",
        `无法解压内置运行环境：\n${err.message}\n\n日志：${logFile()}`
      );
      quitting = true;
      app.quit();
      return;
    }

    // Kick off a background update check after the UI is up (manual check
    // stays available from the tray). Non-blocking; safe to call before the
    // server is ready.
    if (autoStart) {
      setTimeout(() => checkForUpdates(false), 5000);
    } else {
      setTimeout(() => checkForUpdates(false), 3000);
    }

    // Already up? Just show the window (unless started at login → stay hidden).
    if (await serverIsUp()) {
      startedByUs = false;
      if (autoStart) {
        mainWindow.loadURL(URL);
        return;
      }
      mainWindow.loadURL(URL);
      showMainWindow();
      return;
    }

    // Otherwise boot the server ourselves.
    try {
      await startServer();
      startedByUs = true;
    } catch (err) {
      appendLog(`failed to start server: ${err.message}`);
      dialog.showErrorBox("DeepSeek Harness 启动失败", `无法启动 dsh web 服务：\n${err.message}\n\n日志：${logFile()}`);
      quitting = true;
      app.quit();
      return;
    }

    const ready = await waitForServer(READY_TIMEOUT_MS);
    if (!ready) {
      appendLog("server did not become ready in time");
      dialog.showErrorBox(
        "DeepSeek Harness 启动超时",
        `dsh web 服务在 ${READY_TIMEOUT_MS / 1000} 秒内未就绪。\n\n请查看日志：${logFile()}`
      );
      quitting = true;
      app.quit();
      return;
    }
    appendLog("server ready - loading UI");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(URL);
      if (!autoStart) mainWindow.show();
    }
  });

  app.on("window-all-closed", () => {
    // Keep running in the tray; only tray "退出" quits.
  });

  app.on("before-quit", () => {
    quitting = true;
    if (startedByUs) killServer();
  });

  app.on("will-quit", () => {
    if (startedByUs) killServer();
  });
}
