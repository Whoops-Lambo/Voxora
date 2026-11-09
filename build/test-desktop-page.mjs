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
