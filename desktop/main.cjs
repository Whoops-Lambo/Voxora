const {app,BrowserWindow,dialog,session}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
let mainWindow,backend,quitting=false;
if(!app.requestSingleInstanceLock()){
 app.quit();
}else{
 app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
 app.whenReady().then(async()=>{
  try{
   // A stable origin preserves the display name across desktop restarts.
   process.env.PORT='43127';
   process.env.VOXORA_HOST='127.0.0.1';
   process.env.VOXORA_DATA_DIR=path.join(app.getPath('userData'),'chat-data');
   backend=await import(pathToFileURL(path.join(__dirname,'..','server.js')).href);
   const address=await backend.ready;
   const origin=`http://127.0.0.1:${address.port}`;
   session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
   session.defaultSession.setPermissionCheckHandler(()=>false);
   mainWindow=new BrowserWindow({width:1440,height:920,minWidth:700,minHeight:550,title:'Voxora',backgroundColor:'#272830',autoHideMenuBar:true,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
   mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   mainWindow.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
   mainWindow.once('ready-to-show',()=>mainWindow.show());
   await mainWindow.loadURL(origin);
  }catch(error){dialog.showErrorBox('Voxora could not start',`${error.message}\n\nIf port 43127 is in use, close the other program and try again.`);app.quit();}
 });
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',event=>{
  if(backend&&!quitting){event.preventDefault();quitting=true;backend.shutdown().catch(console.error).finally(()=>app.quit());}
 });
}
