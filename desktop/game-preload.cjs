const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('voxoraOverlay',{hide:()=>ipcRenderer.invoke('voxora:game-hide')});
