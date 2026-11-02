import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {releaseFeed} from './release.mjs';
const require=createRequire(import.meta.url);
if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true')throw Error('Run the native update test only on an isolated Windows CI profile.');
const [installer,appExe,version,moduleDirectory,clientVersion='0.0.0']=process.argv.slice(2),directory=path.join(process.env.APPDATA,'Voxora','updates');
const modules=moduleDirectory||fileURLToPath(new URL('../desktop/',import.meta.url));
const {DesktopUpdater}=require(path.join(modules,'updater.cjs')),{FEED_URL}=require(path.join(modules,'update-feed.cjs'));
let app,relaunched,updater,parent,helperPid,helperNonce;
const requestPath=path.join(directory,'native-parent-'+randomUUID()+'.json'),resultPath=requestPath+'.result';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function stop(pid){if(pid)try{execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{stdio:'ignore'});}catch{}}
async function readJSON(file){try{return JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch{return null;}}
const userDirectory=path.join(process.env.APPDATA,'Voxora'),startup=path.join(userDirectory,'updates','desktop-started.json');
try{
 await mkdir(directory,{recursive:true});
 // The real desktop stays on its installed preference while the isolated
 // updater exercises automatic discovery against the candidate feed.
 await writeFile(path.join(directory,'settings.json'),JSON.stringify({autoDownload:false}));
 await unlink(path.join(directory,'pending.json')).catch(()=>{});
 const logOffset=(await readFile(path.join(directory,'install-update.log'),'utf8').catch(()=>'')).length;
 const bytes=await readFile(installer),feed=releaseFeed({version,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,notes:'Isolated native updater test',commit:process.env.GITHUB_SHA});
 const nonce=randomUUID();app=spawn(appExe,['--disable-gpu','--voxora-update='+nonce],{stdio:'ignore'});
 for(let n=0;n<150;n++){const receipt=await readJSON(startup);if(receipt?.nonce===nonce&&receipt.phase==='connected')break;if(app.exitCode!==null)throw Error('Initial desktop exited.');await wait(200);}
 assert.equal((await readJSON(startup))?.nonce,nonce,'The initial installed desktop did not start.');assert.equal((await readJSON(startup))?.phase,'connected');
 // Only network responses are fixtures. The helper, installer and both
 // desktop processes are real production Windows executables.
 const phases=[];
 updater=new DesktopUpdater({version:clientVersion,supported:true,directory,
  fetch:async(url)=>url.split('?')[0]===FEED_URL?Response.json(feed):new Response(bytes,{headers:{'Content-Length':String(bytes.length)}}),
  launchInstaller:async value=>{
   await writeFile(requestPath,JSON.stringify({launcher:path.join(modules,'install-update.cjs'),result:resultPath,install:{...value,appExe,pid:app.pid}}));
   parent=spawn(appExe,[fileURLToPath(new URL('./test-windows-parent.cjs',import.meta.url)),requestPath],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},detached:true,windowsHide:true,stdio:'ignore'});
   const [code]=await once(parent,'exit'),ready=await readJSON(resultPath);
   assert.equal(code,0,ready?.error||'The GUI helper parent failed.');assert.equal(ready?.ready,true);helperNonce=ready.nonce;helperPid=ready.pid;
  },quit:()=>execFileSync('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{stdio:'pipe'})});
 updater.on('change',snapshot=>phases.push(snapshot.phase));
 await updater.initialize();await updater.settings({autoDownload:true});updater.start();
 for(let n=0;n<300&&updater.phase!=='ready';n++){assert.notEqual(updater.phase,'error',updater.error);await wait(100);}
 assert.equal(updater.phase,'ready',updater.error);for(const phase of ['checking','downloading','ready'])assert.ok(phases.includes(phase),'Automatic update never reached '+phase);
 assert.equal(app.exitCode,null,'Downloading must not close the desktop.');
 if(typeof updater.confirmInstall==='function'){
  await updater.checking;await updater.downloading;
  // Exercise the production consent method while a feed refresh is pending
  // and the window wakes/focuses, rather than installing directly from ready.
  const fetcher=updater.fetcher;let finishCheck,answer;
  updater.fetcher=url=>url.split('?')[0]===FEED_URL?new Promise(resolve=>{finishCheck=resolve;}):fetcher(url);
  const refresh=updater.check({force:true});
  const consent=updater.confirmInstall(()=>new Promise(resolve=>{answer=resolve;}));
  for(let n=0;n<100&&!answer;n++)await wait(20);
  assert.ok(answer,'The production confirmation did not open.');
  await updater.wake();await updater.check({force:true});
  finishCheck(Response.json(feed));await refresh;
  assert.equal(updater.phase,'ready');assert.equal(app.exitCode,null,'Voxora closed before consent.');
  answer(true);await consent;
  console.log('Pending background refresh and focus events did not invalidate install confirmation.');
 }else await updater.install();
 let result;
 for(let n=0;n<600;n++){const receipt=await readJSON(startup),log=(await readFile(path.join(directory,'install-update.log'),'utf8').catch(()=>'')).slice(logOffset);if(receipt?.nonce===helperNonce&&receipt.phase==='connected'&&log.includes('Voxora startup confirmed:'))break;await wait(200);}
 result=await readJSON(path.join(directory,'install-result.json'));
 const log=(await readFile(path.join(directory,'install-update.log'),'utf8')).slice(logOffset);
 assert.match(log,/Installation finished; reopening Voxora\./);assert.match(log,/Voxora startup confirmed:/);assert.doesNotMatch(log,/Update failed:|Recovery needs attention:/);
 let receipt=await readJSON(startup);relaunched=receipt?.nonce===helperNonce&&receipt?.pid!==app.pid?receipt?.pid:null;
 for(let n=0;receipt?.phase!=='connected'&&n<100;n++){await wait(100);receipt=await readJSON(startup);}
 if(result){assert.equal(result.success,true,result.message);assert.equal(result.version,version);}assert.ok(relaunched,'The helper did not relaunch the installed desktop.');assert.equal(receipt.nonce,helperNonce);assert.equal(receipt.version,version);assert.equal(receipt.phase,'connected');
 assert.equal((await readJSON(path.join(path.dirname(appExe),'resources','voxora-release.json')))?.version,version);
 console.log('Automatic '+clientVersion+' → '+version+' discovery/download, independent PowerShell helper, real installation and desktop relaunch passed.');
}catch(error){
 for(const name of ['install-helper-output.log','install-update.log']){
  const output=await readFile(path.join(directory,name),'utf8').catch(()=>'No helper log was created.');
  console.error(name+'\n'+output.trim().split('\n').slice(-12).join('\n'));
 }
 throw error;
}finally{updater?.stop();await updater?.logging;stop(app?.pid);const receipt=await readJSON(startup);if(receipt?.nonce===helperNonce&&receipt.pid!==app?.pid)relaunched=receipt.pid;stop(relaunched);stop(parent?.pid);stop(helperPid);await unlink(requestPath).catch(()=>{});await unlink(resultPath).catch(()=>{});}
