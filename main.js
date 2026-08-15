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

// ── locating the dsh CLI ──────────────────────────────────────────────────
// Packaged: resources/dsh-runtime/node.exe + node_modules (full closure).
// Dev: newest @deepseek-ai/dsh under the npx cache, else `npx --yes`.

function runtimeRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, "dsh-runtime");
  return path.join(app.getAppPath(), "resources", "dsh-runtime");
}

function findBundledNode() {
  const p = path.join(runtimeRoot(), "node.exe");
  return fs.existsSync(p) ? p : null;
}

function findBundledDshBin() {
  const p = path.join(runtimeRoot(), "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  return fs.existsSync(p) ? p : null;
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
    },
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
         <div style="text-align:center"><div style="font-size:28px;font-weight:600;color:#e8edf5;margin-bottom:10px">DeepSeek Harness</div>
         <div>正在启动本地服务，请稍候…</div></div></body></html>`
      )
  );
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

function checkForUpdates(manual) {
  if (!app.isPackaged || !updaterAvailable()) {
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "检查更新",
        message: "当前为开发模式，不支持自动更新。",
      });
    }
    return;
  }
  try {
    const updater = getAutoUpdater();
    // Optional override: point the updater at a custom generic feed (e.g. a
    // self-hosted server or a local test server). Defaults to the GitHub
    // provider baked into app-update.yml (timefeishi/dsh).
    if (process.env.DSH_UPDATE_URL) {
      updater.setFeedURL({ provider: "generic", url: process.env.DSH_UPDATE_URL });
    }
    updater.checkForUpdates().catch((err) => {
      appendLog(`checkForUpdates failed: ${err.message}`);
      if (manual) {
        dialog.showMessageBox(mainWindow, {
          type: "error",
          title: "检查更新失败",
          message: `无法连接到更新服务器：\n${err.message}`,
        });
      }
    });
  } catch (err) {
    appendLog(`checkForUpdates threw: ${err.message}`);
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
    const autoStart = process.argv.includes(AUTO_START_ARG);
    appendLog(`launch mode: ${app.isPackaged ? "packaged" : "dev"}${autoStart ? " (auto-start)" : ""}`);

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
        createWindow();
        mainWindow.loadURL(URL);
        return;
      }
      showMainWindow();
      mainWindow.loadURL(URL);
      return;
    }

    // Otherwise boot the server ourselves.
    const win = createWindow();
    showSplash(win);
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
