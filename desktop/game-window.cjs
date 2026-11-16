const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
const GAMES={cs2:'Counter-Strike 2',dota2:'Dota 2','FortniteClient-Win64-Shipping':'Fortnite','VALORANT-Win64-Shipping':'VALORANT',RocketLeague:'Rocket League',RobloxPlayerBeta:'Roblox','League of Legends':'League of Legends',Overwatch:'Overwatch 2',r5apex:'Apex Legends',GenshinImpact:'Genshin Impact',destiny2:'Destiny 2',eldenring:'Elden Ring','Stardew Valley':'Stardew Valley',Terraria:'Terraria',Palworld:'Palworld',helldivers2:'Helldivers 2','Minecraft.Windows':'Minecraft'};
function recognizedGame(names){const found=names.map(n=>path.basename(String(n)).replace(/\.exe$/i,'')).find(n=>Object.keys(GAMES).some(k=>k.toLowerCase()===n.toLowerCase()));return found?GAMES[Object.keys(GAMES).find(k=>k.toLowerCase()===found.toLowerCase())]:null;}
function validShortcut(value){return typeof value==='string'&&value.length<80&&/^(?:(?:CommandOrControl|Control|Ctrl|Alt|Shift|Super|Meta|Command)\+)+(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Enter)$/i.test(value);}
async function createGameWindow({app,BrowserWindow,globalShortcut,ipcMain,shell,mainWindow,getOrigin,trustedIPC,platform=process.platform,execImpl=exec}){
 const file=path.join(app.getPath('userData'),'game-window.json');let settings={enabledByAccount:{},shortcut:'CommandOrControl+Shift+O'},window=null,registered=false,game=null,closed=false,polling=false,accountId=null;
 try{const saved=JSON.parse(await fs.readFile(file,'utf8'));settings={enabledByAccount:saved.enabledByAccount&&typeof saved.enabledByAccount==='object'?saved.enabledByAccount:{},shortcut:validShortcut(saved.shortcut)?saved.shortcut:settings.shortcut};}catch{}
 const snapshot=()=>({enabled:!!(accountId&&settings.enabledByAccount[accountId]),shortcut:settings.shortcut,shortcutRegistered:registered,game,processDetectionSupported:platform==='win32',overlayMode:'windowed-or-borderless'});
 async function toggle(){
  let origin;try{origin=getOrigin();if(!/^https?:\/\//.test(origin))throw Error();}catch{throw Error('Open a Voxora workspace before opening the game window.');}
  if(window&&!window.isDestroyed()){if(window.isVisible()){window.hide();return snapshot();}window.show();window.focus();return snapshot();}
  window=new BrowserWindow({width:480,height:680,minWidth:360,minHeight:400,title:'Voxora Game Chat',alwaysOnTop:true,autoHideMenuBar:true,backgroundColor:'#0c141e',webPreferences:{preload:path.join(__dirname,'game-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.setAlwaysOnTop(true,'screen-saver');window.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  window.webContents.setWindowOpenHandler(({url})=>{try{const u=new URL(url);if(['https:','http:'].includes(u.protocol))shell.openExternal(u.href);}catch{}return{action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==origin)event.preventDefault();}catch{event.preventDefault();}});
  window.on('closed',()=>{window=null;});await window.loadURL(origin+'/app?overlay=1');return snapshot();
 }
 function register(shortcut){if(registered)globalShortcut.unregister(settings.shortcut);registered=false;try{registered=globalShortcut.register(shortcut,()=>toggle().catch(()=>{}));}catch{}return registered;}
 register(settings.shortcut);
 async function poll(){
  if(closed||polling)return;polling=true;let next=null;
  try{
   if(accountId&&settings.enabledByAccount[accountId]&&platform==='win32'){const result=await execImpl('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-Process | Select-Object -ExpandProperty ProcessName | ConvertTo-Json -Compress'],{windowsHide:true,timeout:5000,maxBuffer:256000});const values=JSON.parse(result.stdout||'[]');next=recognizedGame(Array.isArray(values)?values:[values]);}
   game=next;if(!mainWindow.isDestroyed())mainWindow.webContents.send('voxora:game-activity',{name:game,enabled:!!(accountId&&settings.enabledByAccount[accountId]),accountId});
  }catch{game=null;}finally{polling=false;}
 }
 ipcMain.handle('voxora:game-account',async(event,value)=>{trustedIPC(event);if(value!==null&&(typeof value!=='string'||!/^[\w-]{1,80}$/.test(value)))throw Error('Invalid account.');accountId=value;game=null;await poll();return snapshot();});
 ipcMain.handle('voxora:game-state',event=>{trustedIPC(event);return snapshot();});
 ipcMain.handle('voxora:game-settings',async(event,value)=>{
  trustedIPC(event);if(!value||Object.keys(value).some(k=>!['enabled','shortcut'].includes(k))||value.enabled!==undefined&&typeof value.enabled!=='boolean'||value.shortcut!==undefined&&!validShortcut(value.shortcut))throw Error('Choose a valid game-sharing setting and shortcut.');
  if(value.shortcut&&value.shortcut!==settings.shortcut){const old=settings.shortcut;if(!register(value.shortcut)){register(old);throw Error('That shortcut is unavailable. Choose another.');}settings.shortcut=value.shortcut;}
  if(value.enabled!==undefined){if(!accountId)throw Error('Sign in before sharing game activity.');settings.enabledByAccount[accountId]=value.enabled;}await fs.writeFile(file,JSON.stringify(settings));await poll();return snapshot();
 });
 ipcMain.handle('voxora:game-toggle',event=>{trustedIPC(event);return toggle();});
 ipcMain.handle('voxora:game-hide',event=>{if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||new URL(event.senderFrame.url).origin!==getOrigin())throw Error('Untrusted game window request.');window.hide();return{ok:true};});
 const timer=setInterval(poll,30000);timer.unref();await poll();
 return {snapshot,poll,toggle,closeWindow(){if(window&&!window.isDestroyed())window.destroy();window=null;},dispose(){closed=true;clearInterval(timer);if(registered)globalShortcut.unregister(settings.shortcut);if(window&&!window.isDestroyed())window.destroy();for(const name of ['game-account','game-state','game-settings','game-toggle','game-hide'])ipcMain.removeHandler('voxora:'+name);}};
}
module.exports={recognizedGame,validShortcut,createGameWindow};
