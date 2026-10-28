import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
const entry=fileURLToPath(new URL('../server.js',import.meta.url));

test('desktop backend serves assets, broadcasts messages and persists in the configured user-data directory', {timeout:30000},async()=>{
 const temporary=await mkdtemp(path.join(tmpdir(),'voxora-'));
 const dataDir=path.join(temporary,'profile','chat-data');
 let child;
 async function start(){
  child=spawn(process.execPath,[entry],{cwd:temporary,env:{...process.env,PORT:'0',VOXORA_HOST:'127.0.0.1',VOXORA_DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
  return await new Promise((resolve,reject)=>{
   let errors='';child.stderr.on('data',chunk=>errors+=chunk);
   child.once('error',reject);
   child.once('exit',code=>reject(new Error(`Server exited (${code}): ${errors}`)));
   const lines=createInterface({input:child.stdout});
   lines.on('line',line=>{const match=line.match(/Voxora running on port (\d+)/);if(match)resolve(`http://127.0.0.1:${match[1]}`);});
  });
 }
 async function stop(){if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}}
 try{
  let origin=await start();
  assert.match(await(await fetch(origin)).text(),/The Creative Club/);
  for(const asset of ['/app.js','/style.css'])assert.equal((await fetch(origin+asset)).status,200);
  const stream=await fetch(origin+'/api/events');const reader=stream.body.getReader();await reader.read();
  try{
   const response=await fetch(origin+'/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:'design',author:'Desktop user',text:'Saved outside the application directory'})});
   assert.equal(response.status,201);
   const created=await response.json();
   assert.match(new TextDecoder().decode((await reader.read()).value),/Saved outside/);
   assert.equal((await(await fetch(origin+'/api/messages?channel=design')).json())[0].id,created.id);
   assert.equal((await(await fetch(origin+'/api/messages?channel=general')).json()).length,4);
   for(const body of ['null','{bad',JSON.stringify({channel:'bad',author:'User',text:'bad'})])assert.equal((await fetch(origin+'/api/messages',{method:'POST',body})).status,400);
   assert.match(await readFile(path.join(dataDir,'messages.json'),'utf8'),/Saved outside/);
  }finally{await reader.cancel();}
  await stop();origin=await start();
  assert.equal((await(await fetch(origin+'/api/messages?channel=design')).json())[0].text,'Saved outside the application directory');
 }finally{await stop();await rm(temporary,{recursive:true,force:true});}
});
