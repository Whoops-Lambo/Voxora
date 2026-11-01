import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {launchWindowsInstaller}=createRequire(import.meta.url)('../desktop/install-update.cjs');
test('native Windows PowerShell starts the production helper, confirms preflight and cancels without closing its parent',{skip:process.platform!=='win32',timeout:30000},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'voxora-native-handoff-')),powershell=path.win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 let helper,exit,config,helperPid;try{
  const probe=path.join(directory,'probe.ps1');await writeFile(probe,'\uFEFFparam([string]$ResultPath)\n[IO.File]::WriteAllText($ResultPath, "started")\nWrite-Output "probe ran"\n');
  const results=[];
  for(const detached of [true,false])for(const input of ['ignore','pipe']){
   const result=path.join(directory,'probe-'+detached+'-'+input),output=await open(result+'.log','w');
   const child=spawn(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',probe,'-ResultPath',result],{detached,windowsHide:true,stdio:[input,output.fd,output.fd]});
   const timer=setTimeout(()=>child.kill(),3000),[code,signal]=await once(child,'exit');clearTimeout(timer);child.stdin?.destroy();await output.close();
   results.push({detached,input,code,signal,started:await readFile(result,'utf8').then(x=>x==='started',()=>false),output:(await readFile(result+'.log','utf8')).slice(-500)});
  }
  console.log('::notice title=Windows PowerShell launch variants::'+JSON.stringify(results));
  const installer=path.join(directory,'Voxora-Setup-2.14.0.exe'),binary=Buffer.from('MZ preflight fixture; never executed');await writeFile(installer,binary);
  try{
   const ready=await launchWindowsInstaller({installer,directory,appExe:installer,pid:process.pid,version:'2.14.0',sha256:createHash('sha256').update(binary).digest('hex'),size:binary.length,readyTimeout:5000,
    spawnProcess:(exe,args,options)=>{helper=spawn(exe,args,options);exit=once(helper,'exit');config=args.at(-1);return helper;}});
   helperPid=ready.helperPid;const value=JSON.parse(await readFile(config,'utf8'));await writeFile(value.cancelPath,'cancel');
   for(let n=0;n<100;n++){try{process.kill(helperPid,0);}catch{helperPid=null;break;}await new Promise(r=>setTimeout(r,50));}await exit;
  }catch(error){
   for(const name of ['install-helper-output.log','install-update.log'])console.error(name+' '+(await readFile(path.join(directory,name),'utf8').catch(()=>'')));
   throw Error(error.message+'; PowerShell launch cases: '+JSON.stringify(results));
  }
  assert.ok(helper.exitCode===0);
 }finally{if(helper?.exitCode===null)helper.kill();if(helperPid)try{process.kill(helperPid);}catch{}await exit?.catch(()=>{});await rm(directory,{recursive:true,force:true});}
});
