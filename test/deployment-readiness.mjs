import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDeployment,REQUIRED_COMMUNITY_CAPABILITIES,findPublicProof,PUBLIC_APP_ASSETS,publicAssetPath} from '../build/deployment-readiness.mjs';
import {triggerPublicDeploy} from '../build/deploy-public.mjs';
import {fixture} from './support/server.mjs';
import {readFileSync} from 'node:fs';
const sha='a'.repeat(40),artifact='b'.repeat(40),expected={version:'4.0.1',commit:sha};
const metadata=()=>({name:'Voxora',version:'4.0.1',buildCommit:sha,instanceId:'fixture',privateWorkspace:false,realtimeSync:true,capabilities:Object.fromEntries(REQUIRED_COMMUNITY_CAPABILITIES.map(k=>[k,true])),maxBoostLevel:5,membershipPlans:['free','plus','max']});
test('channel-only and stale public deployments cannot satisfy the community release requirement',()=>{
 const full=metadata();assert.equal(assertDeployment(full,expected),full);
 for(const patch of [{version:'3.3.1'},{buildCommit:'c'.repeat(40)},{privateWorkspace:true},{capabilities:{stageChannels:true,forums:true,rulesChannels:true,mediaChannels:true}},{membershipPlans:['free','plus']},{maxBoostLevel:3}])assert.throws(()=>assertDeployment({...full,...patch},expected));
});
test('the running backend reports all community features and serves every verified public asset at its actual route',async()=>{
 const f=await fixture({extraEnv:{VOXORA_BUILD_COMMIT:sha}});try{const r=await f.call(null,'/info');assert.equal(r.status,200);assertDeployment(r.data,{...expected,version:JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version});
  for(const name of PUBLIC_APP_ASSETS){const response=await fetch(f.origin+publicAssetPath(name));assert.equal(response.status,200,name);assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync(new URL('../public/'+name,import.meta.url)),name);}
 }finally{await f.cleanup();}
});
test('deployment proofs cannot be reused after hosted runtime changes or across unrelated histories',()=>{
 const git=({files='',ancestor=true,line=sha+'\trefs/tags/deployment-verified/v4.0.1-'+sha}={})=>(...args)=>{if(args[0]==='ls-remote')return line;if(args[0]==='merge-base'){if(!ancestor)throw Error('unrelated');return'';}if(args[0]==='diff')return files;throw Error('Unexpected git operation');};
 const input={version:'4.0.1',artifactCommit:artifact,runtimeFiles:['server.js','package.json','shop.js','public/**/*','desktop/**/*']};
 assert.equal(findPublicProof({...input,git:git({files:'installers/Voxora-Setup-4.0.1.exe\ninstallers/SHA256SUMS.txt\nVoxora.zip\npublic/bot-starter.zip'})}).commit,sha);
 for(const files of ['server.js','shop.js','package-lock.json','public/platform-web.js','desktop/platform.json'])assert.throws(()=>findPublicProof({...input,git:git({files})}),/not passed deployment verification/);
 assert.throws(()=>findPublicProof({...input,git:git({ancestor:false})}));assert.throws(()=>findPublicProof({...input,git:git({line:''})}));
});
test('Render deployment keeps the hook private, pins the tested commit and refuses redirects or other destinations',async()=>{
 let calls=0;const hook='https://api.render.com/deploy/srv-fixture?key=PRIVATE_FIXTURE';
 const result=await triggerPublicDeploy({hook,commit:sha,fetchImpl:async(url,options)=>{calls++;const u=new URL(url);assert.equal(u.searchParams.get('ref'),sha);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');return new Response('',{status:202});}});assert.equal(result.triggered,true);assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes('PRIVATE_FIXTURE'));
 for(const hook of ['http://api.render.com/deploy/srv-fixture?key=PRIVATE_FIXTURE','https://evil.example/deploy/srv-fixture?key=PRIVATE_FIXTURE','https://api.render.com/accounts?key=PRIVATE_FIXTURE'])await assert.rejects(triggerPublicDeploy({hook,commit:sha,fetchImpl:()=>{throw Error('Must not request');}}));
 await assert.rejects(triggerPublicDeploy({hook,commit:sha,fetchImpl:async()=>new Response('',{status:403})}),e=>!e.message.includes('PRIVATE_FIXTURE'));
 await assert.rejects(triggerPublicDeploy({hook,commit:sha,fetchImpl:async()=>{throw Error(hook);}}),e=>!e.message.includes('PRIVATE_FIXTURE'));
 assert.equal((await triggerPublicDeploy({hook:'',commit:sha})).triggered,false);
});
