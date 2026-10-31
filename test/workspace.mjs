import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, until } from './support/server.mjs';
const base='/me/workspace', appearance={theme:'light',compact:true,fontSize:18,reducedMotion:true};
const folder=(name,serverIds=[])=>({kind:'folder',id:randomUUID(),name,color:'#57f287',serverIds});
const exported=layout=>({format:'voxora-settings',schema:1,exportedAt:new Date().toISOString(),appearance,layout});

test('personal server organization and appearance migrate, stay private, reject foreign placement, resolve concurrent writes and persist across restart',async()=>{
 const f=await fixture();try{
  const owner=await f.register('workspace_owner'),member=await f.register('workspace_member'),O=(p,m,d)=>f.call(owner,p,m,d),M=(p,m,d)=>f.call(member,p,m,d);
  const first=(await O(base)).data;assert.equal(first.version,0);assert.equal(first.appearance,null);assert.deepEqual(first.layout,[{kind:'server',id:'community'}]);
  const a=(await O('/servers','POST',{name:'A'})).data,b=(await O('/servers','POST',{name:'B'})).data,group=folder('My private grouping',[a.id,b.id]);
  assert.equal((await O(base,'PATCH',{version:0,appearance,layout:[group]})).status,200);
  const own=(await O('/state')).data,other=(await M('/state')).data;assert.deepEqual(own.workspace.appearance,appearance);assert.ok(!JSON.stringify(other).includes(group.id));assert.ok(other.users.every(u=>!Object.hasOwn(u,'workspace')));assert.ok(!JSON.stringify(other).includes('My private grouping'));
  assert.equal((await M(base,'PATCH',{version:0,layout:[group]})).status,403);assert.equal((await f.call(null,base)).status,401);
  assert.equal((await O(base,'PATCH',{version:1,userId:member.id,appearance})).status,400);
  const changes=await Promise.all([O(base,'PATCH',{version:1,appearance:{...appearance,fontSize:16}}),O(base,'PATCH',{version:1,appearance:{...appearance,fontSize:19}})]);assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
  await f.stop();await f.start();let restored=(await O(base)).data;assert.equal(restored.version,2);assert.equal(restored.layout[0].name,'My private grouping');
  await M('/invites/join','POST',{code:a.invite});let mine=(await M(base)).data;assert.equal(mine.layout.length,2);assert.equal(mine.appearance,null);
  const memberFolder=folder('My rooms',[a.id]);await M(base,'PATCH',{version:0,layout:[memberFolder]});await M('/servers/'+a.id+'/leave','POST',{});mine=(await M(base)).data;assert.deepEqual(mine.layout[0].serverIds,[]);assert.ok(!JSON.stringify((await M(base+'/export')).data).includes(a.id));
  const current=(await M(base)).data;assert.equal((await M(base,'PATCH',{version:current.version,layout:[memberFolder]})).status,403);assert.equal((await M(base)).data.version,current.version);
 }finally{await f.cleanup();}
});

test('settings import previews are pure, merge preserves explicit placement, replace appends missing memberships and exports omit credentials and device data',async()=>{
 const f=await fixture();try{
  const me=await f.register('portable_owner'),O=(p,m,d)=>f.call(me,p,m,d),a=(await O('/servers','POST',{name:'A'})).data,b=(await O('/servers','POST',{name:'B'})).data,c=(await O('/servers','POST',{name:'C'})).data;
  const keep=folder('Keep mine',[a.id]);await O(base,'PATCH',{version:0,appearance:{...appearance,theme:'dark'},layout:[keep]});
  const incoming=folder('Imported group',[a.id,b.id,'foreign-server']),settings=exported([incoming,{kind:'server',id:'community'}]);
  const before=await readFile(f.dir+'/state.json','utf8'),preview=await O(base+'/import-preview','POST',{settings,mode:'merge'});assert.equal(preview.status,200);assert.equal(preview.data.ignoredServers,1);assert.equal(await readFile(f.dir+'/state.json','utf8'),before);assert.deepEqual(preview.data.layout.find(e=>e.id===keep.id).serverIds,[a.id]);assert.deepEqual(preview.data.layout.find(e=>e.id===incoming.id).serverIds,[b.id]);
  const merged=await O(base+'/import','POST',{version:preview.data.version,settings,mode:'merge'});assert.equal(merged.status,200);assert.deepEqual(merged.data.layout,preview.data.layout);assert.deepEqual(merged.data.appearance,appearance);
  const replace=await O(base+'/import-preview','POST',{settings,mode:'replace'});assert.deepEqual(replace.data.layout[0].serverIds,[a.id,b.id]);assert.ok(replace.data.layout.some(e=>e.id===c.id));
  await O(base,'PATCH',{version:merged.data.version,appearance:{...appearance,fontSize:14}});assert.equal((await O(base+'/import','POST',{version:replace.data.version,settings,mode:'replace'})).status,409);
  const latest=(await O(base)).data;assert.equal((await O(base+'/import','POST',{version:latest.version,settings,mode:'replace'})).status,200);
  const out=(await O(base+'/export')).data;assert.equal(out.format,'voxora-settings');assert.deepEqual(Object.keys(out).sort(),['appearance','exportedAt','format','layout','schema']);assert.ok(!JSON.stringify(out).includes('foreign-server'));assert.ok(!JSON.stringify(out).includes(me.id));assert.ok(!JSON.stringify(out).includes('password'));assert.ok(!JSON.stringify(out).includes('inputDevice'));assert.ok(!JSON.stringify(out).includes('cookie'));
  assert.equal((await O(base+'/import','POST',{version:(await O(base)).data.version,settings:out,mode:'replace'})).status,200,'own export round-trips');
 }finally{await f.cleanup();}
});

test('malformed imports, duplicate IDs, excessive folders, unsafe fields and invalid appearance are rejected atomically',async()=>{
 const f=await fixture();try{
  const me=await f.register('validation_owner'),O=(p,m,d)=>f.call(me,p,m,d),group=folder('Safe',['community']);
  const cases=[exported([group,{kind:'server',id:'community'}]),exported([group,{...group,serverIds:[]}]),exported([{...group,id:'../bad'}]),exported([{...group,color:'red;display:none'}]),exported([{...group,name:'\u200b'}]),exported(Array.from({length:21},(_,i)=>folder('Folder '+i))),{...exported([]),schema:99},{...exported([]),token:'must not store'}, {...exported([]),appearance:{...appearance,fontSize:100}}, {...exported([]),appearance:{...appearance,volume:0}}, {...exported([]),layout:[null]}, {...exported([]),appearance:null}];
  const before=(await O(base)).data;
  for(const settings of cases){const r=await O(base+'/import','POST',{version:0,settings,mode:'replace'});assert.equal(r.status,400,JSON.stringify(settings));assert.deepEqual((await O(base)).data,before);}
  assert.equal((await O(base,'PATCH',{version:0,layout:[{kind:'folder',id:'community',name:'Bad',color:'#5865f2',serverIds:[]}]})).status,400);
  assert.equal((await O(base,'PATCH',{version:0,appearance:{...appearance,compact:'true'}})).status,400);
  assert.equal((await O(base+'/import-preview','POST',{settings:exported([]),mode:'overwrite-everything'})).status,400);
  const twenty=Array.from({length:20},(_,i)=>folder('Saved '+i));await O(base,'PATCH',{version:0,layout:twenty});const full=(await O(base)).data;assert.equal((await O(base+'/import','POST',{version:full.version,settings:exported([folder('Extra')]),mode:'merge'})).status,400);assert.deepEqual((await O(base)).data,full);
 }finally{await f.cleanup();}
});

test('delayed settings bodies recheck membership and account suspension before mutation',async()=>{
 const f=await fixture();try{
  const owner=await f.register('delay_workspace_owner'),member=await f.register('delay_workspace_member'),O=(p,m,d)=>f.call(owner,p,m,d),M=(p,m,d)=>f.call(member,p,m,d),s=(await O('/servers','POST',{name:'Leave during save'})).data;await M('/invites/join','POST',{code:s.invite});
  function delayed(payload){let finish;const response=new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api'+base,{method:'PATCH',headers:{Cookie:member.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(payload.slice(0,5));finish=()=>req.end(payload.slice(5));});return{response,finish};}
  let request=delayed(JSON.stringify({version:0,layout:[{kind:'server',id:s.id}]}));await O('/servers/'+s.id+'/members/'+member.id,'DELETE',{reason:'Removed during body'});request.finish();assert.equal(await request.response,403);assert.equal((await M(base)).data.version,0);
  request=delayed(JSON.stringify({version:0,appearance}));const r=await O('/platform/users/'+member.id,'PATCH',{suspendFor:-1,reason:'Account review'});request.finish();assert.equal(r.status,200);assert.equal(await request.response,403);
  await O('/platform/users/'+member.id,'PATCH',{suspendFor:0,reason:'Review complete'});const login=await f.call(null,'/auth/login','POST',{username:'delay_workspace_member',password:'Fixture-password-987'});member.cookie=login.cookie;assert.equal((await M(base)).data.version,0);
 }finally{await f.cleanup();}
});

test('workspace changes notify the account’s other sessions without sending private layout events to other users',async()=>{
 const f=await fixture(),controllers=[];let tasks=[];try{
  const one=await f.register('events_workspace_one'),two=await f.register('events_workspace_two');
  async function listen(who,label){const controller=new AbortController();controllers.push(controller);const r=await fetch(f.origin+'/api/events?client=workspace-session-'+label,{headers:{Cookie:who.cookie},signal:controller.signal}),reader=r.body.getReader(),decoder=new TextDecoder(),events=[];const task=(async()=>{let buffer='';while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n\n'))>=0){for(const line of buffer.slice(0,i).split('\n'))if(line.startsWith('data: '))events.push(JSON.parse(line.slice(6)));buffer=buffer.slice(i+2);}}})().catch(e=>{if(!controller.signal.aborted)throw e;});tasks.push(task);await until(()=>events.some(e=>e.type==='connected'));return events;}
  const a=await listen(one,'a'),b=await listen(one,'b'),other=await listen(two,'c');
  await f.call(one,base,'PATCH',{version:0,appearance,layout:[folder('Private grouping',['community'])]});await until(()=>a.some(e=>e.type==='workspace-update')&&b.some(e=>e.type==='workspace-update'));
  await f.call(one,'/messages','POST',{channel:'general',text:'Transport barrier'});await until(()=>other.some(e=>e.type==='message'&&e.message.text==='Transport barrier'));assert.ok(!other.some(e=>e.type==='workspace-update'));assert.ok(!JSON.stringify(other).includes('Private grouping'));assert.deepEqual(a.find(e=>e.type==='workspace-update'),{type:'workspace-update'});
 }finally{for(const c of controllers)c.abort();await Promise.all(tasks);await f.cleanup();}
});
