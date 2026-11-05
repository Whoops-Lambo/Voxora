import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {fixture} from './support/server.mjs';

const secret='Synthetic-public-owner-password-467';
test('public startup creates its configured owner before accepting public registration',async()=>{
 const f=await fixture({entry:'public-server.js',extraEnv:{VOXORA_OWNER_USERNAME:'public_owner',VOXORA_OWNER_PASSWORD:secret,VOXORA_OWNER_DISPLAY_NAME:'Public Owner'}});
 try{
  const info=(await f.call(null,'/info')).data;assert.equal(info.privateWorkspace,false);assert.equal(info.name,'Voxora');
  const member=await f.register('public_regular');assert.equal(member.data.platform.owner,false);assert.deepEqual(member.data.platform.permissions,[]);assert.ok(member.data.users.some(u=>u.username==='public_owner'));assert.ok(member.data.servers[0].members.includes(member.id));
  const login=await f.call(null,'/auth/login','POST',{username:'public_owner',password:secret});assert.equal(login.status,200);assert.equal(login.data.platform.owner,true);assert.equal(login.data.me.displayName,'Public Owner');assert.equal((await f.call(member,'/platform/overview')).status,403);
  const state=await readFile(path.join(f.dir,'state.json'),'utf8');assert.ok(!state.includes(secret));
 }finally{await f.cleanup();}
});
test('redeployment preserves accounts, identity and owner without requiring or applying bootstrap credentials again',async()=>{
 const extraEnv={VOXORA_OWNER_USERNAME:'retained_owner',VOXORA_OWNER_PASSWORD:secret},f=await fixture({entry:'public-server.js',extraEnv});
 try{
  const login=await f.call(null,'/auth/login','POST',{username:'retained_owner',password:secret}),owner={id:login.data.me.id,cookie:login.cookie},member=await f.register('retained_member'),id=(await f.call(null,'/info')).data.instanceId;
  assert.equal((await f.call(member,'/messages','POST',{channel:'general',text:'This message survives a redeployment.'})).status,201);
  await f.stop();extraEnv.VOXORA_OWNER_USERNAME='replacement_owner';delete extraEnv.VOXORA_OWNER_PASSWORD;await f.start();
  assert.equal((await f.call(null,'/info')).data.instanceId,id);assert.equal((await f.call(owner,'/platform/me')).data.owner,true);assert.equal((await f.call(member,'/platform/me')).data.owner,false);assert.ok((await f.call(member,'/messages?channel=general')).data.some(m=>m.text==='This message survives a redeployment.'));
  const state=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));assert.equal(state.platform.ownerId,owner.id);assert.ok(!state.users.some(u=>u.username==='replacement_owner'));
 }finally{await f.cleanup();}
});
test('a missing or weak initial owner secret stops startup before any public port is opened',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'voxora-public-fail-'));
 try{for(const password of['','short']){
  let output='';const child=spawn(process.execPath,[fileURLToPath(new URL('../public-server.js',import.meta.url))],{env:{...process.env,PORT:'0',VOXORA_HOST:'127.0.0.1',VOXORA_DATA_DIR:dir,VOXORA_OWNER_USERNAME:'safe_owner',VOXORA_OWNER_PASSWORD:password},stdio:['ignore','pipe','pipe']});for(const stream of[child.stdout,child.stderr])stream.on('data',data=>output+=data);const [code]=await once(child,'exit');assert.equal(code,1);assert.ok(!output.includes('Voxora running on port'));assert.match(output,/No public registration endpoint was opened/);if(password)assert.ok(!output.includes(password));
 }}finally{await rm(dir,{recursive:true,force:true});}
});
test('a missing persisted owner is not reassigned to a new signup or environment-configured account',async()=>{
 const f=await fixture({entry:'public-server.js',extraEnv:{VOXORA_OWNER_USERNAME:'lost_owner',VOXORA_OWNER_PASSWORD:secret}});
 try{
  await f.stop();const file=path.join(f.dir,'state.json'),state=JSON.parse(await readFile(file,'utf8'));state.users=state.users.filter(u=>u.id!==state.platform.ownerId);await writeFile(file,JSON.stringify(state));await assert.rejects(f.start(),/Server exited 1/);const after=JSON.parse(await readFile(file,'utf8'));assert.equal(after.platform.ownerId,state.platform.ownerId);assert.ok(!after.users.some(u=>u.username==='lost_owner'));
 }finally{await f.cleanup();}
});
