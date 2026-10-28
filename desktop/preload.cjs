const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("voxoraDesktop", {
  connect: (url) => ipcRenderer.invoke("voxora:connect", url),
});
