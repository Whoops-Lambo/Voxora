import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const {DEFAULT_SERVER,LOCAL_SERVER,startupConnection,trustedURL,verifyServer,readConnection,saveConnection}=createRequire(import.meta.url)('../desktop/connection.cjs');
test('fresh desktops use Public Voxora; saved connections, old local data and explicit setup remain authoritative',()=>{
  assert.equal(DEFAULT_SERVER,'https://voxora-public.onrender.com');
  assert.deepEqual(startupConnection(),{mode:'remote',server:DEFAULT_SERVER});
  for(const savedConnection of [{mode:'host',server:LOCAL_SERVER,instanceId:'local-id'},{mode:'remote',server:'https://private.example',instanceId:'saved-id'}])assert.equal(startupConnection({savedConnection,hasLocalData:true}),savedConnection);
  for(const options of [{hasLocalData:true},{configError:true},{setup:true},{savedConnection:{mode:'remote',server:DEFAULT_SERVER},setup:true}])assert.equal(startupConnection(options),null);
  assert.deepEqual(startupConnection({privateHost:true}),{mode:'host',server:LOCAL_SERVER});
});
test('desktop connections require a verified shared origin and do not turn an unavailable server into a private installation',async()=>{
  assert.equal(trustedURL('https://chat.example.com/'),'https://chat.example.com');
  for(const value of ['javascript:alert(1)','file:///tmp/private','https://user:secret@www.voxora.com','https://www.voxora.com/app','https://www.voxora.com?token=test','http://public.example'])assert.throws(()=>trustedURL(value));
  assert.equal(trustedURL(LOCAL_SERVER),LOCAL_SERVER);
  const id='12345678-1234-1234-1234-123456789012',calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return Response.json({name:'Voxora',appPath:'/app',instanceId:id});};
  assert.deepEqual(await verifyServer('https://chat.example.com',{fetch:fetcher,instanceId:id}),{appPath:'/app',instanceId:id});
  assert.equal(calls[0].url,'https://chat.example.com/api/info');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');
  await assert.rejects(verifyServer('https://chat.example.com',{fetch:fetcher,instanceId:'87654321-4321-4321-4321-210987654321'}),/different Voxora installation/);
  await assert.rejects(verifyServer('https://chat.example.com',{fetch:async()=>{throw Error('offline');}}),/Cannot reach Voxora/);
  for(const data of [{name:'Different app',appPath:'/app'},{name:'Voxora',appPath:'https://other.example'},{name:'Voxora',instanceId:123}])await assert.rejects(verifyServer('https://chat.example.com',{fetch:async()=>Response.json(data)}));
  await assert.rejects(verifyServer('https://chat.example.com',{fetch:async()=>new Response('Not found',{status:404})}),/Cannot reach Voxora/);
});
test('saved shared connections and identity pins survive failure; legacy local data requires an explicitly saved host choice',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'voxora-connection-')),file=path.join(dir,'connection.json');
  try{
    assert.equal(await readConnection(file),null);
    const config={mode:'remote',server:'https://chat.example.com',instanceId:'12345678-1234-1234-1234-123456789012'};
    await saveConnection(file,config);assert.deepEqual(await readConnection(file),config);
    await assert.rejects(verifyServer(config.server,{fetch:async()=>{throw Error('Offline');}}));assert.deepEqual(JSON.parse(await readFile(file,'utf8')),config);
    await writeFile(file,JSON.stringify({server:LOCAL_SERVER}));assert.deepEqual(await readConnection(file),{mode:'host',server:LOCAL_SERVER,instanceId:null});
    await writeFile(file,JSON.stringify({mode:'host',server:'https://chat.example.com'}));await assert.rejects(readConnection(file),/invalid/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
