// Preload: exposes a minimal bridge for the injected "检查更新" button.
// Runs in the renderer with contextIsolation; only the updater check is exposed.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshUpdater", {
  check: () => ipcRenderer.invoke("dsh:check-updates"),
});
