import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const {DEFAULT_SERVER}=createRequire(import.meta.url)('../desktop/connection.cjs');
export async function evaluateDesktop(port,expression){
 let target;
 for(let n=0;n<100;n++){
  try{const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();target=pages.find(p=>p.type==='page'&&p.webSocketDebuggerUrl);if(target)break;}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(target,'The isolated installed desktop did not expose its test debugger.');
 const socket=new WebSocket(target.webSocketDebuggerUrl);
 try{
  return await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('The installed desktop did not answer the UI check.')),15000);
   socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}})),{once:true});
   socket.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('Installed desktop debugger connection failed.'));},{once:true});
   socket.addEventListener('message',event=>{const result=JSON.parse(event.data);if(result.id!==1)return;clearTimeout(timeout);if(result.error||result.result?.exceptionDetails)reject(Error(JSON.stringify(result.error||result.result.exceptionDetails)));else resolve(result.result?.result?.value);});
  });
 }finally{socket.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true')throw Error('Use this helper only with the isolated Windows test app.');
 const port=Number(process.argv[2]);assert.ok(Number.isSafeInteger(port)&&port>=1024&&port<=65535);
 if(process.argv[3]==='community-v4'){
  const result=await evaluateDesktop(port,`(async()=>{
   const api=async(path,method='GET',data)=>{const r=await fetch('/api'+path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});if(!r.ok)throw Error(path+': '+r.status+' '+await r.text());return r.json();};
   const boot=await api('/auth/register','POST',{username:'installed_v4_owner',password:'Isolated-CI-fixture-password-847'}),s=boot.servers[0];
   await api('/platform/server-boosts/'+s.id,'PATCH',{version:0,level:2,expiresAt:null,reason:'Isolated Windows native image verification'});
   const role=await api('/servers/'+s.id+'/roles','POST',{name:'Native Icon Test',permissions:[]}),canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);const blob=await new Promise(r=>canvas.toBlob(r));
   const upload=await fetch('/api/servers/'+s.id+'/roles/'+role.id+'/icon',{method:'POST',body:blob});if(upload.status!==201)throw Error('Installed native Sharp normalization failed: '+upload.status+' '+await upload.text());const icon=await upload.json(),asset=await fetch(icon.url);if(!asset.ok||asset.headers.get('content-type')!=='image/webp')throw Error('Installed role icon unavailable.');
   const bridge=window.voxoraDesktop;if(!bridge?.setGameAccount)throw Error('Game window bridge missing.');await bridge.setGameAccount(boot.me.id);const game=await bridge.getGameState();if(game.enabled!==false)throw Error('Game detection must start disabled.');return{mime:asset.headers.get('content-type'),gameMode:game.overlayMode};
  })()`);
  assert.equal(result.mime,'image/webp');assert.equal(result.gameMode,'windowed-or-borderless');console.log('Installed Windows native image conversion, boost-gated role icon API and opt-in game IPC passed.');process.exit(0);
 }
 if(process.argv[3]==='notifications'){
  const state=await evaluateDesktop(port,`(async()=>{const bridge=window.voxoraDesktop;if(!bridge?.getNotificationState||!bridge?.onNotificationClick)throw Error('Native notification bridge missing.');const initial=await bridge.getNotificationState();const result=await bridge.testNotification();await bridge.setNotificationSettings({keepRunning:true});const enabled=await bridge.getNotificationState();await bridge.setNotificationSettings({keepRunning:false});await bridge.clearNotifications();return {initial,result,enabled};})()`);
  assert.equal(typeof state.initial.supported,'boolean');assert.equal(state.initial.keepRunning,false);assert.equal(state.enabled.keepRunning,true);if(state.initial.supported)assert.equal(state.result.shown,true);
  console.log('Installed native notification bridge, test request and opt-in background tray settings passed.');process.exit(0);
 }
 if(process.argv[3]==='public'){
  const publicPage=await evaluateDesktop(port,`(async()=>{for(let n=0;n<100;n++){if(document.querySelector('#auth:not([hidden])'))return {origin:location.origin,form:!!document.querySelector('#auth-form')};await new Promise(r=>setTimeout(r,100));}throw Error('The public sign-in page did not initialize.');})()`);
  assert.equal(publicPage.origin,DEFAULT_SERVER);assert.equal(publicPage.form,true);
  console.log('A fresh installed desktop automatically connected to Public Voxora and loaded its sign-in form. No account was created.');
  process.exit(0);
 }
 const ready=await evaluateDesktop(port,`(async()=>{for(let n=0;n<100;n++){if(document.querySelector('#setup-updates .connection-tag'))return {server:document.getElementById('server').value,local:document.getElementById('private-host').textContent};await new Promise(r=>setTimeout(r,100));}throw Error('Connection setup scripts did not initialize.');})()`);
 assert.equal(ready.server,DEFAULT_SERVER);assert.equal(ready.local,'Open Local Workspace');
 assert.equal(await evaluateDesktop(port,"document.getElementById('public-address').textContent"),DEFAULT_SERVER);
 await evaluateDesktop(port,"document.getElementById('private-host').click(); true");
 console.log('Installed setup initialized its update controls and opened a local workspace without a domain.');
}
