import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture,until} from './support/server.mjs';
const later=()=>Date.now()+3600000;

test('Home stars and reminders are private, versioned, validated and durable',async()=>{
 const f=await fixture();try{
  const a=await f.register('hub_owner'),b=await f.register('hub_other'),A=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d);
  assert.equal((await f.call(null,'/me/hub')).status,401);
  assert.equal((await A('/me/hub','PATCH',{version:0,stars:['general','general']})).status,400);
  assert.equal((await A('/me/hub','PATCH',{version:0,stars:['nonexistent']})).status,400);
  assert.equal((await A('/me/hub','PATCH',{version:0,stars:['general']})).data.version,1);
  const race=await Promise.all([A('/me/hub','PATCH',{version:1,stars:[]}),A('/me/hub','PATCH',{version:1,stars:['general']})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const invalid=[{title:'',dueAt:later()},{title:'Bad\u202e',dueAt:later()},{title:'x',dueAt:null},{title:'x',dueAt:later(),note:null},{title:'x',dueAt:later(),userId:b.id},{title:'x',dueAt:later(),source:{kind:'message',id:'foreign'}}];
  for(const d of invalid)assert.ok([400,404].includes((await A('/me/reminders','POST',d)).status));
  let r=(await A('/me/reminders','POST',{title:'Secret personal task',note:'Private note',dueAt:later()})).data;assert.equal(r.revision,0);
  assert.equal((await B('/me/reminders/'+r.id)).status,404);assert.equal((await B('/me/reminders/'+r.id,'PATCH',{revision:0,completed:true})).status,404);assert.equal((await B('/me/reminders/'+r.id,'DELETE')).status,404);
  const others=(await B('/state')).data;assert.ok(!JSON.stringify(others).includes('Secret personal task'));assert.ok(others.users.every(u=>!Object.hasOwn(u,'hub')));assert.equal(others.hub.activeCount,0);
  const memberReminder=(await B('/me/reminders','POST',{title:'Member-only note',dueAt:later()})).data;assert.equal((await A('/me/reminders/'+memberReminder.id)).status,404,'Platform ownership cannot read another account’s reminder');assert.equal((await A('/me/reminders/'+memberReminder.id,'PATCH',{revision:0,completed:true})).status,404);assert.equal((await A('/me/reminders/'+memberReminder.id,'DELETE')).status,404);
  r=(await A('/me/reminders/'+r.id,'PATCH',{revision:0,completed:true})).data;assert.ok(r.completedAt);assert.equal((await A('/me/reminders/'+r.id,'PATCH',{revision:0,title:'Stale'})).status,409);
  assert.equal((await A('/me/reminders?status=active')).data.total,0);assert.equal((await A('/me/reminders?status=completed')).data.total,1);
  r=(await A('/me/reminders/'+r.id,'PATCH',{revision:1,completed:false,note:'Revised note'})).data;assert.equal(r.revision,2);assert.equal(r.completedAt,null);
  await f.stop();await f.start();assert.equal((await A('/me/reminders/'+r.id)).data.note,'Revised note');assert.equal((await A('/me/hub')).data.version,2);
  assert.equal((await A('/me/reminders/'+r.id,'DELETE')).status,200);assert.equal((await A('/me/reminders/'+r.id)).status,404);
 }finally{await f.cleanup();}
});

test('reminder message and thread references recheck current access, edits, deletion and blocked DMs',async()=>{
 const f=await fixture();try{
  const a=await f.register('hub_source_owner'),b=await f.register('hub_source_member'),A=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d),s=(await A('/servers','POST',{name:'Private planning'})).data;
  await B('/invites/join','POST',{code:s.invite});const channel=s.channels.find(c=>c.type==='text').id;
  const m=(await A('/messages','POST',{channel,text:'Restricted original'})).data;
  const create=async(source,call=B)=>(await call('/me/reminders','POST',{title:'Follow up',dueAt:later(),source})).data;
  const r=await create({kind:'message',id:m.id});assert.equal(r.source.preview.text,'Restricted original');
  await A('/messages/'+m.id,'PATCH',{text:'Edited live content'});assert.equal((await B('/me/reminders/'+r.id)).data.source.preview.text,'Edited live content');
  const t=(await A('/threads','POST',{messageId:m.id,name:'Plan'})).data,reply=(await A('/threads/'+t.id+'/messages','POST',{text:'Thread source'})).data,rt=await create({kind:'thread',id:reply.id});assert.equal(rt.source.preview.threadId,t.id);
  await B('/me/hub','PATCH',{version:0,stars:[channel]});await B('/servers/'+s.id+'/leave','POST',{});
  const hidden=(await B('/me/hub')).data;assert.equal(hidden.stars.length,0);assert.ok(!JSON.stringify(hidden).includes('Restricted original'));assert.ok(!JSON.stringify(hidden).includes('Private planning'));assert.equal((await B('/me/reminders/'+rt.id)).data.source.available,false);
  await B('/invites/join','POST',{code:s.invite});await A('/messages/'+m.id,'DELETE');assert.equal((await B('/me/reminders/'+r.id)).data.source.available,false);
  const dm=(await B('/conversations','POST',{userId:a.id})).data,direct=(await A('/messages','POST',{channel:dm.id,text:'Direct private content'})).data,rd=await create({kind:'message',id:direct.id});assert.equal(rd.source.available,true);
  let h=(await B('/me/hub')).data;await B('/me/hub','PATCH',{version:h.version,stars:[dm.id]});await B('/blocks/'+a.id,'POST',{});h=(await B('/me/hub')).data;assert.equal(h.stars.length,0);assert.equal(h.reminders.find(x=>x.id===rd.id).source.available,false);assert.ok(!JSON.stringify(h).includes('Direct private content'));
 }finally{await f.cleanup();}
});

test('due events reach only the account, contain no private text and do not repeat without snoozing',async()=>{
 const f=await fixture(),controllers=[],tasks=[];try{
  const a=await f.register('hub_due_owner'),b=await f.register('hub_due_other');
  async function listen(who,label){const controller=new AbortController();controllers.push(controller);const response=await fetch(f.origin+'/api/events?client=hub-session-'+label,{headers:{Cookie:who.cookie},signal:controller.signal}),reader=response.body.getReader(),events=[];tasks.push((async()=>{let buffer='';while(true){const {value,done}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value);let i;while((i=buffer.indexOf('\n\n'))>=0){for(const line of buffer.slice(0,i).split('\n'))if(line.startsWith('data: '))events.push(JSON.parse(line.slice(6)));buffer=buffer.slice(i+2);}}})().catch(e=>{if(!controller.signal.aborted)throw e;}));await until(()=>events.some(e=>e.type==='connected'));return events;}
  const one=await listen(a,'one'),two=await listen(a,'two'),other=await listen(b,'other');let r=(await f.call(a,'/me/reminders','POST',{title:'Private due title',note:'Never broadcast this note',dueAt:Date.now()})).data;
  await until(()=>one.some(e=>e.type==='reminder-due')&&two.some(e=>e.type==='reminder-due'));
  assert.deepEqual(one.find(e=>e.type==='reminder-due'),{type:'reminder-due',id:r.id});assert.ok(!other.some(e=>['reminder-due','hub-update'].includes(e.type)));assert.ok(!JSON.stringify(one).includes('Private due title'));
  await new Promise(resolve=>setTimeout(resolve,1150));assert.equal(one.filter(e=>e.type==='reminder-due').length,1);
  r=(await f.call(a,'/me/reminders/'+r.id,'PATCH',{revision:r.revision,title:'Edited after due'})).data;assert.equal(r.due,true);
  r=(await f.call(a,'/me/reminders/'+r.id,'PATCH',{revision:r.revision,completed:true})).data;assert.ok(r.completedAt);
  r=(await f.call(a,'/me/reminders/'+r.id,'PATCH',{revision:r.revision,completed:false,dueAt:Date.now()})).data;await until(()=>one.filter(e=>e.type==='reminder-due').length===2);
  r=(await f.call(a,'/me/reminders/'+r.id,'PATCH',{revision:r.revision,dueAt:later()})).data;assert.equal(r.due,false);assert.equal((await f.call(a,'/me/hub')).data.dueCount,0);
 }finally{for(const c of controllers)c.abort();await Promise.all(tasks);await f.cleanup();}
});

test('delayed reminder and star mutations recheck membership and account suspension',async()=>{
 const f=await fixture();try{
  const owner=await f.register('hub_delay_owner'),member=await f.register('hub_delay_member'),O=(p,m,d)=>f.call(owner,p,m,d),M=(p,m,d)=>f.call(member,p,m,d),s=(await O('/servers','POST',{name:'Removed during request'})).data;await M('/invites/join','POST',{code:s.invite});const channel=s.channels.find(c=>c.type==='text').id;
  function delayed(route,payload){let finish;const response=new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api'+route,{method:route.endsWith('hub')?'PATCH':'POST',headers:{Cookie:member.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(payload.slice(0,5));finish=()=>req.end(payload.slice(5));});return{response,finish};}
  let request=delayed('/me/hub',JSON.stringify({version:0,stars:[channel]}));await O('/servers/'+s.id+'/members/'+member.id,'DELETE',{reason:'Removed'});request.finish();assert.equal(await request.response,400);
  request=delayed('/me/reminders',JSON.stringify({title:'Suspended mutation',dueAt:later()}));await O('/platform/users/'+member.id,'PATCH',{suspendFor:-1,reason:'Review'});request.finish();assert.equal(await request.response,403);
 }finally{await f.cleanup();}
});

test('accent preferences validate, sync and round trip without changing old appearance snapshots',async()=>{
 const f=await fixture();try{
  const a=await f.register('accent_owner'),A=(p,m,d)=>f.call(a,p,m,d),base={theme:'dark',compact:false,fontSize:15,reducedMotion:false};
  assert.equal((await A('/me/workspace','PATCH',{version:0,appearance:{...base,accent:'arbitrary-css'}})).status,400);
  let r=await A('/me/workspace','PATCH',{version:0,appearance:{...base,accent:'iris'}});assert.equal(r.data.appearance.accent,'iris');assert.equal((await A('/state')).data.workspace.appearance.accent,'iris');
  const exported=(await A('/me/workspace/export')).data;assert.equal(exported.appearance.accent,'iris');assert.ok(!JSON.stringify(exported).includes('reminders'));
  r=await A('/me/workspace','PATCH',{version:1,appearance:base});assert.deepEqual(r.data.appearance,base);
  assert.equal((await A('/me/workspace/import','POST',{version:2,settings:exported,mode:'replace'})).data.appearance.accent,'iris');
 }finally{await f.cleanup();}
});
