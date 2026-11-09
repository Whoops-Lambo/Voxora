import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const entry=fileURLToPath(import.meta.url);

async function storedOwner(dataDir){
 let state;
 try{state=JSON.parse(await readFile(path.join(dataDir,'state.json'),'utf8'));}
 catch(error){if(error.code==='ENOENT')return false;throw Error('The saved workspace could not be read. Public startup stopped; restore its data before retrying.');}
 if(state.platform?.ownerId){
  if(!state.users?.some(u=>u.id===state.platform.ownerId&&!u.bot))throw Error('The saved owner account is missing. Restore the existing owner; public startup will not assign a replacement.');
  return true;
 }
 if(state.platform?.ownerInitialized)throw Error('The platform owner record needs recovery. Public startup will not assign a replacement owner.');
 return false;
}

function launch(env,{visible=false}={}){
 const child=spawn(process.execPath,[entry,'--voxora-public-worker'],{env,stdio:['ignore','pipe','pipe','ipc']});
 const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('The backend did not become ready within 30 seconds.')),30000);
  const lines=createInterface({input:child.stdout});
  const failed=()=>{clearTimeout(timer);reject(Error('The backend stopped before becoming ready. Check the persistent disk and deployment settings.'));};
  child.once('error',failed);child.once('exit',failed);
  lines.on('line',line=>{
   if(visible)process.stdout.write(line+'\n');
   const port=line.match(/^Voxora running on port (\d+)$/)?.[1];
   if(port){clearTimeout(timer);child.removeListener('error',failed);child.removeListener('exit',failed);resolve(Number(port));}
  });
 });
 if(visible)child.stderr.pipe(process.stderr);else child.stderr.resume();
 return {child,ready};
}

async function stop(child){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 const exited=once(child,'exit');
 if(child.connected)child.send({type:'voxora-public-shutdown'},error=>{if(error)child.kill('SIGTERM');});
 else child.kill('SIGTERM');
 const timer=setTimeout(()=>child.kill('SIGKILL'),10000);timer.unref();
 try{await exited;}finally{clearTimeout(timer);}
}

function createOwner(port,config){
 // Use a direct loopback socket, including when the host has an HTTP proxy.
 const payload=JSON.stringify(config);
 return new Promise((resolve,reject)=>{
  const request=httpRequest({hostname:'127.0.0.1',port,path:'/api/auth/register',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},response=>{
   const chunks=[];let size=0;
   response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024)response.destroy(Error('Owner response exceeded its limit.'));else chunks.push(chunk);});
   response.on('error',reject);response.on('end',()=>{try{resolve({ok:response.statusCode===200,data:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(Error('Invalid owner response.'));}});
  });
  request.setTimeout(20000,()=>request.destroy(Error('Owner setup timed out.')));request.on('error',reject);request.end(payload);
 });
}

export async function runPublicService(env=process.env){
 const dataDir=path.resolve(env.VOXORA_DATA_DIR||'.data');
 const childEnv={...env,VOXORA_DATA_DIR:dataDir,VOXORA_PRIVATE_WORKSPACE:'0'};
 if(env.RENDER==='true'&&!childEnv.VOXORA_TRUST_PROXY_HOPS)childEnv.VOXORA_TRUST_PROXY_HOPS='1';
 delete childEnv.VOXORA_OWNER_USERNAME;delete childEnv.VOXORA_OWNER_PASSWORD;delete childEnv.VOXORA_OWNER_DISPLAY_NAME;
 if(!childEnv.VOXORA_PUBLIC_URL&&env.RENDER_EXTERNAL_URL)childEnv.VOXORA_PUBLIC_URL=env.RENDER_EXTERNAL_URL;
 const username=env.VOXORA_OWNER_USERNAME||'',password=env.VOXORA_OWNER_PASSWORD||'';
 const ownerConfigured=/^[a-z0-9_.]{3,24}$/.test(username)&&password.length>=16&&password.length<=128;
 let active=null,stopping=false;
 const terminate=()=>{stopping=true;stop(active).catch(()=>{});};
 process.on('SIGTERM',terminate);process.on('SIGINT',terminate);
 try{
  if(!await storedOwner(dataDir)){
   if(!ownerConfigured)throw Error('Configure VOXORA_OWNER_USERNAME and a VOXORA_OWNER_PASSWORD of 16–128 characters before the first public deployment. No public registration endpoint was opened.');
   const bootstrap=launch({...childEnv,PORT:'0',VOXORA_HOST:'127.0.0.1'});active=bootstrap.child;
   const port=await bootstrap.ready;if(stopping)return;
   // Initialize a new owner over loopback only. The public port is still closed.
   if(!await storedOwner(dataDir)){
    let response;
    try{
     response=await createOwner(port,{username,displayName:env.VOXORA_OWNER_DISPLAY_NAME||username,password});
    }catch{throw Error('The owner account could not be initialized. Public registration remains closed.');}
    if(!response.ok||response.data?.platform?.owner!==true||response.data?.me?.username!==username||!await storedOwner(dataDir))throw Error('Owner initialization did not complete. Public registration remains closed; check the owner configuration.');
    console.log('Public workspace owner initialized.');
   }
   await stop(active);active=null;
  }
  if(stopping)return;
  const serving=launch({...childEnv,PORT:env.PORT||'3000',VOXORA_HOST:env.VOXORA_HOST||'0.0.0.0'},{visible:true});active=serving.child;
  const exited=once(active,'exit');await serving.ready;await exited;
  if(!stopping)throw Error('The public backend stopped unexpectedly. The deployment should be restarted.');
 }finally{
  await stop(active);process.removeListener('SIGTERM',terminate);process.removeListener('SIGINT',terminate);
 }
}

async function runWorker(){
 const backend=await import('./server.js');let closing=false;
 const terminate=async()=>{if(closing)return;closing=true;try{await backend.shutdown();process.exit(0);}catch{process.exit(1);}};
 process.on('SIGTERM',terminate);process.on('SIGINT',terminate);process.on('disconnect',terminate);
 process.on('message',message=>{if(message?.type==='voxora-public-shutdown')terminate();});
 if(process.send&&!process.connected){await terminate();return;}await backend.ready;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const worker=process.argv[2]==='--voxora-public-worker';
 (worker?runWorker():runPublicService()).catch(error=>{console.error('Public Voxora startup failed: '+error.message);process.exitCode=1;});
}
