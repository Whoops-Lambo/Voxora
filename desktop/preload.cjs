const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("voxoraDesktop", {
  getNotificationState:()=>ipcRenderer.invoke('voxora:notification-state'),
  setNotificationSettings:value=>ipcRenderer.invoke('voxora:notification-settings',value),
  showNotification:value=>ipcRenderer.invoke('voxora:notification-show',value),
  testNotification:()=>ipcRenderer.invoke('voxora:notification-test'),
  clearNotifications:()=>ipcRenderer.invoke('voxora:notifications-clear'),
  openNotificationSettings:()=>ipcRenderer.invoke('voxora:notification-system-settings'),
  onNotificationClick:callback=>{if(typeof callback!=='function')throw Error('Expected a notification callback.');const listener=(_event,value)=>callback(value);ipcRenderer.on('voxora:notification-click',listener);return ()=>ipcRenderer.removeListener('voxora:notification-click',listener);},
  connect: (url) => ipcRenderer.invoke("voxora:connect", url),
  getConnectionInfo: () => ipcRenderer.invoke('voxora:connection-info'),
  hostPrivateWorkspace: () => ipcRenderer.invoke('voxora:private-workspace'),
  getUpdateState: () => ipcRenderer.invoke("voxora:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("voxora:update-check"),
  downloadUpdate: () => ipcRenderer.invoke("voxora:update-download"),
  installUpdate: () => ipcRenderer.invoke("voxora:update-install"),
  setUpdateSettings: (settings) => ipcRenderer.invoke("voxora:update-settings", settings),
  copyUpdateDiagnostics: () => ipcRenderer.invoke('voxora:update-diagnostics'),
  onUpdate: (callback) => {
    if (typeof callback !== "function") throw Error("Expected an update callback.");
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("voxora:update-state", listener);
    return () => ipcRenderer.removeListener("voxora:update-state", listener);
  },
});
