// Preload: exposes a minimal bridge for the injected "检查更新" button and
// progress updates. Runs in the renderer with contextIsolation.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshUpdater", {
  check: () => ipcRenderer.invoke("dsh:check-updates"),
  // Subscribe to progress events pushed from main (runtime extraction /
  // update download). Returns an unsubscribe function.
  onProgress: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on("dsh:progress", listener);
    return () => ipcRenderer.removeListener("dsh:progress", listener);
  },
});
