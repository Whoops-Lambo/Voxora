import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './support/server.mjs';
import {mentionTokens} from '../public/mentions.js';
import {shouldNotify} from '../public/activity.js';

test('mention parsing ignores code, escaped text, emails, links and overlong usernames',()=>{
  const text='@alice @{Launch Team} `@bob` ```\n@carol\n``` \\@dave name@ed https://test.invalid/@frank @'+'x'.repeat(25);
  assert.deepEqual(mentionTokens(text).map(x=>x.token),['@alice','@{Launch Team}']);
});
async function setup(){
 const f=await fixture(),a=await f.register('ping_owner'),b=await f.register('ping_member'),c=await f.register('ping_other');
 const s=(await f.call(a,'/servers','POST',{name:'Ping Studio'})).data;for(const u of[b,c])await f.call(u,'/invites/join','POST',{code:s.invite});
 return {f,a,b,c,s,channel:s.channels.find(c=>c.type==='text').id};
}
test('personal and role pings reach only resolved recipients, persist, respect blocks and cannot be forged',async()=>{
 const {f,a,b,c,s,channel}=await setup();try{
  const O=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d);
  const first=await O('/messages','POST',{channel,text:'Hello @PING_MEMBER.',mentions:{recipients:[c.id]}});assert.equal(first.status,201);assert.deepEqual(first.data.mentions.recipients,[b.id]);
  assert.equal((await B('/activity')).data.channels[channel].mentions,1);assert.equal((await f.call(c,'/activity')).data.channels[channel].mentions,0);
  let role=(await O('/servers/'+s.id+'/roles','POST',{name:'Launch Team',mentionable:true})).data;await O('/servers/'+s.id+'/members/'+b.id,'PATCH',{roles:[role.id]});
  const ping=await f.call(c,'/messages','POST',{channel,text:'Ready @{Launch Team}?'});assert.equal(ping.status,201);assert.deepEqual(ping.data.mentions.recipients,[b.id]);
  await O('/servers/'+s.id+'/members/'+b.id,'PATCH',{roles:[]});await O('/servers/'+s.id+'/members/'+c.id,'PATCH',{roles:[role.id]});
  assert.equal((await B('/activity')).data.channels[channel].mentions,2,'Later role changes cannot redirect old pings');
  await f.stop();await f.start();assert.equal((await B('/inbox')).data.items.length,2);
  await B('/blocks/'+a.id,'POST',{});assert.equal((await B('/activity')).data.channels[channel].mentions,1);
  const event={...ping.data,authorId:c.id};const user={id:b.id,username:'ping_member'},policy={mode:'mentions',muted:false};assert.equal(shouldNotify(event,user,policy),true);assert.equal(shouldNotify(event,user,policy,{dnd:true}),false);assert.equal(shouldNotify(event,user,{...policy,muted:true}),false);
 }finally{await f.cleanup();}
});
test('server-wide pings and restricted roles require current channel permission and exclude inaccessible members',async()=>{
 const {f,a,b,c,s,channel}=await setup();try{
  const O=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d);
  assert.equal((await B('/messages','POST',{channel,text:'@everyone'})).status,403);
  const role=(await O('/servers/'+s.id+'/roles','POST',{name:'Private role'})).data;
  assert.equal((await B('/messages','POST',{channel,text:'@{Private role}'})).status,403);
  await O('/channels/'+channel,'PATCH',{overwrites:[{type:'member',id:c.id,allow:[],deny:['viewChannel']},{type:'member',id:b.id,allow:['mentionEveryone'],deny:[]}]});
  const r=await B('/messages','POST',{channel,text:'@everyone'});assert.equal(r.status,201);assert.deepEqual(new Set(r.data.mentions.recipients),new Set([a.id,b.id]));
  await O('/channels/'+channel,'PATCH',{overwrites:[]});assert.equal((await B('/messages','POST',{channel,text:'@here'})).status,403);
  const here=await O('/messages','POST',{channel,text:'@here'});assert.equal(here.status,201);assert.deepEqual(here.data.mentions.recipients,[],'Offline accounts are not @here recipients');
  const literal=await B('/messages','POST',{channel,text:'`@everyone` and \\@here'});assert.equal(literal.status,201);assert.deepEqual(literal.data.mentions.recipients,[]);
 }finally{await f.cleanup();}
});
test('edits never create new pings and thread pings appear in Inbox until read or marked all read',async()=>{
 const {f,a,b,c,channel}=await setup();try{
  const O=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d);
  let root=(await O('/messages','POST',{channel,text:'Draft'})).data;
  let edited=await O('/messages/'+root.id,'PATCH',{text:'Added @ping_member'});assert.equal(edited.status,200);assert.deepEqual(edited.data.mentions.recipients,[]);
  const t=(await O('/threads','POST',{messageId:root.id,name:'Thread pings'})).data;
  const ping=(await O('/threads/'+t.id+'/messages','POST',{text:'Thread hello @ping_member'})).data;
  assert.equal((await B('/activity')).data.channels[channel].mentions,1);assert.ok((await B('/inbox')).data.items.some(m=>m.id===ping.id&&m.threadId===t.id));
  await B('/threads/'+t.id+'/read','POST',{through:ping.sequence});assert.equal((await B('/activity')).data.channels[channel].mentions,0);
  await O('/threads/'+t.id+'/messages','POST',{text:'Second @ping_member'});
  const activity=(await B('/activity')).data;assert.equal(activity.channels[channel].mentions,1);
  assert.equal((await B('/read-state','POST',{all:true,through:activity.through,threadThrough:activity.threadThrough,revision:activity.revision})).status,200);assert.equal((await B('/inbox')).data.items.length,0);
 }finally{await f.cleanup();}
});

test('@here captures connected visible members at send time and does not ping invisible or later-online accounts',async()=>{
 const {f,a,b,c,channel}=await setup(),controller=new AbortController();let reader,draining;
 try{
  const stream=await fetch(f.origin+'/api/events?client=here-fixture',{headers:{Cookie:b.cookie},signal:controller.signal});reader=stream.body.getReader();await reader.read();draining=(async()=>{while(!(await reader.read()).done){}})().catch(()=>{});
  const ping=await f.call(a,'/messages','POST',{channel,text:'@here'});assert.equal(ping.status,201);assert.deepEqual(ping.data.mentions.recipients,[b.id]);
  await f.call(b,'/profile','PATCH',{status:'invisible'});
  const hidden=await f.call(a,'/messages','POST',{channel,text:'@here'});assert.deepEqual(hidden.data.mentions.recipients,[]);
  assert.equal((await f.call(b,'/activity')).data.channels[channel].mentions,1,'Changing presence must not erase the earlier ping');
 }finally{controller.abort();await draining;reader?.releaseLock();await f.cleanup();}
});
