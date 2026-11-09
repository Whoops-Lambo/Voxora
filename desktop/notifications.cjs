const fs = require('node:fs/promises');
const path = require('node:path');
const APP_ID = 'com.voxora.desktop';
const identifier = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
function notificationPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['id','channel','threadId','recipientId','title','body','silent'].includes(key)) ||
      !identifier(value.id) || !identifier(value.channel) || !identifier(value.recipientId) || value.threadId != null && !identifier(value.threadId) ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 140 || typeof value.body !== 'string' || value.body.length > 220 || typeof value.silent !== 'boolean') throw Error('Invalid desktop notification.');
  return {id:value.id,channel:value.channel,threadId:value.threadId||null,recipientId:value.recipientId,title:value.title,body:value.body,silent:value.silent};
}
async function createDesktopNotifications({Notification,Tray,Menu,nativeImage,getWindow,getOrigin,quit,openExternal,directory,icon,platform=process.platform,now=Date.now}) {
  let settings={keepRunning:false},tray=null,disposed=false;
  const filename=path.join(directory,'desktop-notifications.json'),active=new Map(),seen=new Map(),cancelled=new WeakSet(),recent=[];
  try { const saved=JSON.parse(await fs.readFile(filename,'utf8'));settings.keepRunning=saved.keepRunning===true; } catch {}
  const supported=()=>Notification.isSupported();
  function restore(){const window=getWindow();if(!window||window.isDestroyed())return false;if(window.isMinimized())window.restore();window.show();window.focus();return true;}
  function updateTray(){
    if(settings.keepRunning&&!tray&&!disposed){
      try{tray=new Tray(nativeImage.createFromPath(icon).resize({width:20,height:20}));tray.setToolTip('Voxora · running in the background');tray.on('double-click',restore);tray.on('click',restore);tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Voxora',click:restore},{type:'separator'},{label:'Quit Voxora',click:quit}]));}
      catch{settings.keepRunning=false;throw Error('The system tray is unavailable. Voxora will quit when its window closes.');}
    }else if(!settings.keepRunning&&tray){tray.destroy();tray=null;}
  }
  try{updateTray();}catch{}
  const snapshot=()=>({supported:supported(),platform,keepRunning:!!tray&&settings.keepRunning});
  async function configure(value){
    if(!value||typeof value.keepRunning!=='boolean'||Object.keys(value).some(k=>k!=='keepRunning'))throw Error('Invalid notification settings.');
    const previous=settings.keepRunning;
    try{settings.keepRunning=value.keepRunning;updateTray();await fs.mkdir(directory,{recursive:true});await fs.writeFile(filename+'.tmp',JSON.stringify(settings),{mode:0o600});await fs.rename(filename+'.tmp',filename);return snapshot();}
    catch(error){settings.keepRunning=previous;try{updateTray();}catch{}throw error;}
  }

  function clear(){for(const notification of active.values()){cancelled.add(notification);notification.close();}active.clear();seen.clear();recent.length=0;}
  function present(data,test=false){
    if(disposed||!supported())return {shown:false,reason:'unsupported'};
    const origin=getOrigin(),window=getWindow();if(!origin||!window||window.isDestroyed())return {shown:false,reason:'unavailable'};
    if(!test){const key=data.recipientId+':'+data.id;if(seen.has(key))return {shown:false,reason:'duplicate'};while(recent.length&&recent[0]<=now()-10000)recent.shift();if(recent.length>=10)return {shown:false,reason:'rate-limited'};recent.push(now());seen.set(key,now());if(seen.size>500)seen.delete(seen.keys().next().value);}
    const key=test?'test':data.recipientId+':'+data.id;
    try{
      if(active.size>=30){const oldest=active.keys().next().value;cancelled.add(active.get(oldest));active.get(oldest).close();active.delete(oldest);}
      if(active.has(key)){cancelled.add(active.get(key));active.get(key).close();}const notification=new Notification({title:data.title,body:data.body,icon,silent:data.silent,timeoutType:'default'});active.set(key,notification);
      notification.on('close',()=>{if(active.get(key)===notification)active.delete(key);});
      notification.on('failed',()=>{if(active.get(key)===notification)active.delete(key);});
      notification.on('click',()=>{if(cancelled.has(notification))return;notification.close();if(getOrigin()!==origin||disposed||!restore())return;if(!test)getWindow().webContents.send('voxora:notification-click',{id:data.id,channel:data.channel,threadId:data.threadId,recipientId:data.recipientId});});
      notification.show();return {shown:true};
    }catch{active.delete(key);return {shown:false,reason:'unavailable'};}
  }
  function test(){return present({title:'Voxora notifications are ready',body:'Desktop message and mention alerts can appear here. Click to return to Voxora.',silent:false},true);}
  async function systemSettings(){if(platform==='win32')await openExternal('ms-settings:notifications');else if(platform==='darwin')await openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');else return {opened:false};return {opened:true};}
  return {snapshot,configure,show:value=>present(notificationPayload(value)),test,systemSettings,clear,keepRunning:()=>!!tray&&settings.keepRunning,dispose:()=>{disposed=true;clear();tray?.destroy();tray=null;}};
}
module.exports={APP_ID,notificationPayload,createDesktopNotifications};
