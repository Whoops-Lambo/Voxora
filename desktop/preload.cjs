const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("voxoraDesktop", {
  connect: (url) => ipcRenderer.invoke("voxora:connect", url),
  getUpdateState: () => ipcRenderer.invoke("voxora:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("voxora:update-check"),
  downloadUpdate: () => ipcRenderer.invoke("voxora:update-download"),
  installUpdate: () => ipcRenderer.invoke("voxora:update-install"),
  setUpdateSettings: (settings) => ipcRenderer.invoke("voxora:update-settings", settings),
  onUpdate: (callback) => {
    if (typeof callback !== "function") throw Error("Expected an update callback.");
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("voxora:update-state", listener);
    return () => ipcRenderer.removeListener("voxora:update-state", listener);
  },
});
