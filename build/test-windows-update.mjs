import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {releaseFeed} from './release.mjs';
const require=createRequire(import.meta.url),{DesktopUpdater}=require('../desktop/updater.cjs'),{launchWindowsInstaller}=require('../desktop/install-update.cjs'),{FEED_URL}=require('../desktop/update-feed.cjs');
if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true')throw Error('Run the native update test only on an isolated Windows CI profile.');
const [installer,appExe,version]=process.argv.slice(2),directory=await mkdtemp(path.join(os.tmpdir(),'Voxora Zoë 日本 [update] & test\'s '));
let app,relaunched,updater,helper,helperNonce;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function stop(pid){if(pid)try{execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{stdio:'ignore'});}catch{}}
async function readJSON(file){try{return JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch{return null;}}
const userDirectory=path.join(process.env.APPDATA,'Voxora'),startup=path.join(userDirectory,'updates','desktop-started.json');
try{
 const bytes=await readFile(installer),feed=releaseFeed({version,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,notes:'Isolated native updater test',commit:process.env.GITHUB_SHA});
 const nonce=randomUUID();app=spawn(appExe,['--disable-gpu','--voxora-update='+nonce],{stdio:'ignore'});
 for(let n=0;n<150;n++){const receipt=await readJSON(startup);if(receipt?.nonce===nonce&&receipt.phase==='connected')break;if(app.exitCode!==null)throw Error('Initial desktop exited.');await wait(200);}
 assert.equal((await readJSON(startup))?.nonce,nonce,'The initial installed desktop did not start.');assert.equal((await readJSON(startup))?.phase,'connected');
 // Only network responses are fixtures. The helper, installer and both
 // desktop processes are real production Windows executables.
 updater=new DesktopUpdater({version:'0.0.0',supported:true,directory,
  fetch:async(url)=>url.split('?')[0]===FEED_URL?Response.json(feed):new Response(bytes,{headers:{'Content-Length':String(bytes.length)}}),
  launchInstaller:async value=>{await launchWindowsInstaller({...value,appExe,pid:app.pid,spawnProcess:(...args)=>{helper=spawn(...args);return helper;}});const config=(await readdir(directory)).find(name=>/^install-[a-f0-9-]{36}\.json$/.test(name));helperNonce=(await readJSON(path.join(directory,config))).nonce;},quit:()=>stop(app.pid)});
 await updater.initialize();await updater.check();assert.equal(updater.phase,'ready');await updater.install();
 let result;
 for(let n=0;n<600;n++){if(helper.exitCode!==null||helper.signalCode!==null)break;await wait(200);}
 result=await readJSON(path.join(directory,'install-result.json'));assert.equal(helper.exitCode,0,'The Windows helper failed or did not exit.');
 assert.ok(result,'The real Windows helper did not finish.');
 let receipt=await readJSON(startup);relaunched=receipt?.nonce===helperNonce&&receipt?.pid!==app.pid?receipt?.pid:null;
 for(let n=0;receipt?.phase!=='connected'&&n<100;n++){await wait(100);receipt=await readJSON(startup);}
 assert.equal(result.success,true,result.message);assert.equal(result.version,version);assert.ok(relaunched,'The helper did not relaunch the installed desktop.');assert.equal(receipt.nonce,helperNonce);assert.equal(receipt.version,version);assert.equal(receipt.phase,'connected');
 assert.equal((await readJSON(path.join(path.dirname(appExe),'resources','voxora-release.json')))?.version,version);
 console.log('Real updater handoff, production installer execution and installed desktop relaunch passed.');
}finally{updater?.stop();await updater?.logging;stop(app?.pid);const receipt=await readJSON(startup);if(receipt?.nonce===helperNonce&&receipt.pid!==app?.pid)relaunched=receipt.pid;stop(relaunched);if(helper?.exitCode===null)stop(helper.pid);await rm(directory,{recursive:true,force:true});}
