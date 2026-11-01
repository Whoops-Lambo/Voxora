// Isolated CI helper: run with the installed GUI executable in Node mode, so
// PowerShell is launched by a process without a console, as in the real app.
const fs=require('node:fs/promises');
const path=require('node:path');
if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true')throw Error('Isolated Windows CI only.');
(async()=>{
 const request=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 let child;
 try{
  const {launchWindowsInstaller}=require(request.launcher);
  const ready=await launchWindowsInstaller({...request.install,spawnProcess:(exe,args,options)=>{
   const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
   child=require('node:child_process').spawn(exe,args,{...options,env});return child;
  }});
  await fs.writeFile(request.result,JSON.stringify({ready:true,pid:ready.helperPid,nonce:ready.nonce}));
 }catch(error){await fs.writeFile(request.result,JSON.stringify({ready:false,error:error.message}));process.exitCode=1;}
})().catch(error=>{console.error(error);process.exitCode=1;});
