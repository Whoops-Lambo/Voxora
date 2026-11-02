import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import http from 'node:http';
import {fixture,until} from './support/server.mjs';
const route='/me/scheduled-messages',later=()=>Date.now()+3600000;
const payload=(channel='general',text='A scheduled hello')=>({channel,text,sendAt:later(),nonce:randomUUID()});

test('the private outbox validates, deduplicates requests, protects revisions and permits cancellation and history cleanup',async()=>{
 const f=await fixture();try{
  const a=await f.register('schedule_owner'),b=await f.register('schedule_member'),A=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d),d=payload();
  assert.equal((await f.call(null,route)).status,401);
  for(const patch of [{text:''},{text:'/ban someone'},{channel:'unavailable'},{sendAt:null},{sendAt:Date.now()-1000},{files:[]},{userId:b.id},{nonce:'short'},{replyTo:'missing'}])assert.ok([400,403].includes((await A(route,'POST',{...d,...patch})).status),JSON.stringify(patch));
  let r=(await A(route,'POST',d)).data;assert.equal(r.status,'queued');assert.equal(r.revision,0);const duplicate=await A(route,'POST',d);assert.equal(duplicate.status,200);assert.equal(duplicate.data.id,r.id);assert.equal((await A(route,'POST',{...d,text:'Different'})).status,409);
  assert.equal((await B(route+'/'+r.id)).status,404);assert.equal((await B(route+'/'+r.id,'PATCH',{revision:0,action:'cancel'})).status,404);assert.ok(!JSON.stringify((await B('/state')).data).includes('A scheduled hello'));
  const memberJob=(await B(route,'POST',payload('general','Member private draft'))).data;assert.equal((await A(route+'/'+memberJob.id)).status,404,'Platform ownership cannot read private outboxes');
  const edits=await Promise.all([A(route+'/'+r.id,'PATCH',{revision:0,text:'First edit'}),A(route+'/'+r.id,'PATCH',{revision:0,text:'Second edit'})]);assert.deepEqual(edits.map(x=>x.status).sort(),[200,409]);
  assert.equal((await A(route+'/'+r.id,'DELETE')).status,409);assert.equal((await A(route+'/'+r.id,'PATCH',{revision:1,sendAt:null})).status,400);
  r=(await A(route+'/'+r.id,'PATCH',{revision:1,action:'cancel'})).data;assert.equal(r.status,'cancelled');await f.stop();await f.start();assert.equal((await A(route+'?status=cancelled')).data.total,1);assert.equal((await A(route+'/'+r.id,'PATCH',{revision:2,action:'send-now'})).status,409);assert.equal((await A(route+'/'+r.id,'DELETE')).status,200);
 }finally{await f.cleanup();}
});

test('delivery uses the normal message pipeline and stores its receipt atomically across restarts',async()=>{
 const f=await fixture();try{
  const a=await f.register('schedule_delivery'),A=(p,m,d)=>f.call(a,p,m,d),original=(await A('/messages','POST',{channel:'general',text:'Original plan'})).data;
  const r=(await A(route,'POST',{...payload('general','Follow-up later'),replyTo:original.id})).data;
  await A(route+'/'+r.id,'PATCH',{revision:0,action:'send-now'});
  const sent=await until(async()=>{const q=(await A(route+'/'+r.id)).data;return q.status==='sent'&&q;});assert.equal(sent.replyTo,original.id);assert.ok(sent.messageId);assert.equal(sent.error,null);
  let messages=(await A('/messages?channel=general')).data;assert.equal(messages.filter(m=>m.id===sent.messageId).length,1);assert.equal(messages.find(m=>m.id===sent.messageId).authorId,a.id);
  const disk=JSON.parse(await readFile(f.dir+'/state.json','utf8')),saved=disk.users.find(u=>u.id===a.id).scheduledMessages.find(q=>q.id===r.id);assert.equal(saved.status,'sent');assert.ok(disk.messages.some(m=>m.id===saved.messageId));
  await f.stop();await f.start();await A('/messages','POST',{channel:'general',text:'Restart barrier'});messages=(await A('/messages?channel=general')).data;assert.equal(messages.filter(m=>m.text==='Follow-up later').length,1);assert.equal((await A(route+'/'+r.id,'PATCH',{revision:sent.revision,action:'send-now'})).status,409);
  const overdue=(await A(route,'POST',payload('general','Offline delivery'))).data;await f.stop();const state=JSON.parse(await readFile(f.dir+'/state.json','utf8'));state.users.find(u=>u.id===a.id).scheduledMessages.find(q=>q.id===overdue.id).sendAt=Date.now()-1000;await writeFile(f.dir+'/state.json',JSON.stringify(state));await f.start();await until(async()=>(await A(route+'/'+overdue.id)).data.status==='sent');
 }finally{await f.cleanup();}
});

test('queued sends recheck blocks, removed channels/memberships, suspension and deleted reply targets',async()=>{
 const f=await fixture();try{
  const a=await f.register('schedule_guard_owner'),b=await f.register('schedule_guard_member'),A=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d),s=(await A('/servers','POST',{name:'Delivery permissions'})).data,channel=s.channels.find(c=>c.type==='text').id;await B('/invites/join','POST',{code:s.invite});
  const r=(await B(route,'POST',payload(channel,'Do not deliver after removal'))).data;await B(route+'/'+r.id,'PATCH',{revision:0,action:'send-now'});await A('/servers/'+s.id+'/members/'+b.id,'DELETE',{reason:'Removed before delivery'});
  const failed=await until(async()=>{const q=(await B(route+'/'+r.id)).data;return q.status==='failed'&&q;});assert.equal(failed.destination,null);assert.ok(!JSON.stringify((await A('/messages?channel='+channel)).data).includes('Do not deliver'));
  const dm=(await B('/conversations','POST',{userId:a.id})).data,direct=(await B(route,'POST',payload(dm.id,'Do not deliver blocked DM'))).data;await B(route+'/'+direct.id,'PATCH',{revision:0,action:'send-now'});await A('/blocks/'+b.id,'POST',{});await until(async()=>(await B(route+'/'+direct.id)).data.status==='failed');assert.equal((await B(route+'/'+direct.id)).data.destination,null);
  const m=(await B('/messages','POST',{channel:'general',text:'Reply target'})).data,reply=(await B(route,'POST',{...payload(),replyTo:m.id})).data;await B(route+'/'+reply.id,'PATCH',{revision:0,action:'send-now'});await B('/messages/'+m.id,'DELETE');await until(async()=>(await B(route+'/'+reply.id)).data.status==='failed');
  const suspended=(await B(route,'POST',payload())).data;await B(route+'/'+suspended.id,'PATCH',{revision:0,action:'send-now'});await A('/platform/users/'+b.id,'PATCH',{suspendFor:-1,reason:'Review'});
  await until(async()=>{const disk=JSON.parse(await readFile(f.dir+'/state.json','utf8'));return disk.users.find(u=>u.id===b.id).scheduledMessages.find(q=>q.id===suspended.id).status==='failed';});
 }finally{await f.cleanup();}
});

test('slowmode and AutoMod are enforced at delivery and failed items require an explicit reschedule',async()=>{
 const f=await fixture();try{
  const a=await f.register('schedule_rules_owner'),b=await f.register('schedule_rules_member'),A=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d);
  await A('/channels/general','PATCH',{slowmode:60});await B('/messages','POST',{channel:'general',text:'Establish cooldown'});const r=(await B(route,'POST',payload())).data;await B(route+'/'+r.id,'PATCH',{revision:0,action:'send-now'});await until(async()=>(await B(route+'/'+r.id)).data.status==='failed');assert.match((await B(route+'/'+r.id)).data.error,/Slowmode/);
  await A('/channels/general','PATCH',{slowmode:0});assert.equal((await B(route+'/'+r.id)).data.status,'failed');await B(route+'/'+r.id,'PATCH',{revision:2,action:'send-now'});await until(async()=>(await B(route+'/'+r.id)).data.status==='sent');
  const moderated=(await B(route,'POST',payload('general','Forbidden launch words'))).data;
  assert.equal((await A('/servers/community/automod/rules','POST',{name:'Scheduled content rule',kind:'keywords',terms:['Forbidden launch words'],action:'block'})).status,201);await A('/servers/community/automod','PATCH',{enabled:true});
  await B(route+'/'+moderated.id,'PATCH',{revision:0,action:'send-now'});await until(async()=>(await B(route+'/'+moderated.id)).data.status==='failed');assert.ok(!(await B('/messages?channel=general')).data.some(m=>m.text==='Forbidden launch words'));
 }finally{await f.cleanup();}
});

test('scheduling after a delayed request body rechecks membership and suspension',async()=>{
 const f=await fixture();try{
  const a=await f.register('schedule_delay_owner'),b=await f.register('schedule_delay_member'),A=(p,m,d)=>f.call(a,p,m,d),s=(await A('/servers','POST',{name:'Delayed scheduling'})).data;await f.call(b,'/invites/join','POST',{code:s.invite});
  function delayed(data){const payload=JSON.stringify(data);let finish;const response=new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api'+route,{method:'POST',headers:{Cookie:b.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(payload.slice(0,5));finish=()=>req.end(payload.slice(5));});return{response,finish};}
  let request=delayed(payload(s.channels.find(c=>c.type==='text').id));await A('/servers/'+s.id+'/members/'+b.id,'DELETE',{reason:'Access removed'});request.finish();assert.equal(await request.response,403);
  request=delayed(payload());await A('/platform/users/'+b.id,'PATCH',{suspendFor:-1,reason:'Review'});request.finish();assert.equal(await request.response,403);
 }finally{await f.cleanup();}
});

test('outbox events stay private and delivery rechecks expired Plus limits and channel send permissions',async()=>{
 const f=await fixture(),controllers=[],tasks=[];try{
  const a=await f.register('schedule_privacy_owner'),b=await f.register('schedule_privacy_member'),A=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d);
  async function listen(who,label){const controller=new AbortController();controllers.push(controller);const response=await fetch(f.origin+'/api/events?client=scheduled-events-'+label,{headers:{Cookie:who.cookie},signal:controller.signal}),events=[];tasks.push((async()=>{let buffer='';for await(const chunk of response.body){buffer+=Buffer.from(chunk).toString();let i;while((i=buffer.indexOf('\n\n'))>=0){for(const line of buffer.slice(0,i).split('\n'))if(line.startsWith('data: '))events.push(JSON.parse(line.slice(6)));buffer=buffer.slice(i+2);}}})().catch(e=>{if(!controller.signal.aborted)throw e;}));await until(()=>events.some(e=>e.type==='connected'));return events;}
  const ownerEvents=await listen(a,'owner'),memberEvents=await listen(b,'member');
  const grant=await A('/platform/premium/members/'+b.id,'PATCH',{version:0,days:30,reason:'Synthetic scheduled-message grant'});assert.equal(grant.status,200);
  let r=(await B(route,'POST',{...payload('general','x'.repeat(3000)),sendAt:Date.now()+1800})).data;assert.equal(r.status,'queued');await until(()=>memberEvents.some(e=>e.type==='scheduled-update'));
  assert.ok(!ownerEvents.some(e=>e.type==='scheduled-update'));assert.deepEqual(memberEvents.find(e=>e.type==='scheduled-update'),{type:'scheduled-update'});assert.ok(!JSON.stringify(memberEvents).includes('x'.repeat(100)));
  await A('/platform/premium/members/'+b.id,'PATCH',{version:grant.data.version,revoke:true,reason:'Revoke before delivery'});await until(async()=>(await B(route+'/'+r.id)).data.status==='failed');assert.match((await B(route+'/'+r.id)).data.error,/character limit/);
  r=(await B(route,'POST',{...payload(),sendAt:Date.now()+1800})).data;await A('/channels/general','PATCH',{overwrites:[{type:'role',id:'everyone',allow:[],deny:['sendMessages']}]});await until(async()=>(await B(route+'/'+r.id)).data.status==='failed');assert.ok(!(await A('/messages?channel=general')).data.some(m=>m.text==='A scheduled hello'));
 }finally{for(const c of controllers)c.abort();await Promise.all(tasks);await f.cleanup();}
});
