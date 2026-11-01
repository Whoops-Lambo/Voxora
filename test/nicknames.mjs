import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture} from './support/server.mjs';

test('server nicknames are scoped, searchable and durable, with versioned edits and explicit reset',async()=>{
 const f=await fixture();try{
  const owner=await f.register('nickname_owner'),member=await f.register('nickname_member'),other=(await f.call(owner,'/servers','POST',{name:'Another server'})).data;
  await f.call(member,'/invites/join','POST',{code:other.invite});
  const route='/servers/community/nicknames/'+member.id;
  assert.equal((await f.call(member,route,'PATCH',{nickname:'Space Pilot',version:0})).status,200);
  assert.equal((await f.call(member,route,'PATCH',{nickname:'Stale',version:0})).status,409);
  const state=(await f.call(member,'/state')).data;assert.equal(state.me.displayName,'nickname_member');assert.equal(state.servers.find(s=>s.id==='community').nicknames[member.id],'Space Pilot');assert.equal(state.servers.find(s=>s.id===other.id).nicknames[member.id],undefined);
  const channel=state.servers.find(s=>s.id==='community').channels.find(c=>c.type==='text');
  assert.equal((await f.call(member,'/messages','POST',{channel:channel.id,text:'Hello from my server nickname'})).data.author,'Space Pilot');
  const search=(await f.call(owner,'/servers/community/members?q=space')).data;assert.equal(search.total,1);assert.equal(search.members[0].username,'nickname_member');assert.equal(search.members[0].serverNickname,'Space Pilot');
  await f.stop();await f.start();assert.equal((await f.call(member,'/state')).data.servers.find(s=>s.id==='community').nicknames[member.id],'Space Pilot');
  assert.equal((await f.call(member,route,'PATCH',{nickname:'',version:1})).status,200);assert.equal((await f.call(member,'/state')).data.servers.find(s=>s.id==='community').nicknames[member.id],undefined);
 }finally{await f.cleanup();}
});
test('nickname moderation enforces hierarchy, self-change permissions, input limits and server-only administration',async()=>{
 const f=await fixture();try{
  const owner=await f.register('nick_staff_owner'),mod=await f.register('nick_staff_mod'),member=await f.register('nick_staff_member'),outsider=await f.register('nick_outsider');
  const s=(await f.call(owner,'/servers','POST',{name:'Nickname permissions'})).data;
  for(const u of [mod,member])await f.call(u,'/invites/join','POST',{code:s.invite});
  const role=(await f.call(owner,'/servers/'+s.id+'/roles','POST',{name:'Nickname staff',permissions:['manageNicknames']})).data;
  await f.call(owner,'/servers/'+s.id+'/members/'+mod.id,'PATCH',{roles:[role.id]});
  const route=id=>'/servers/'+s.id+'/nicknames/'+id;
  assert.equal((await f.call(member,route(mod.id),'PATCH',{nickname:'Nope',version:0})).status,403);
  assert.equal((await f.call(mod,route(owner.id),'PATCH',{nickname:'Nope',version:0})).status,403);
  assert.equal((await f.call(outsider,route(member.id),'PATCH',{nickname:'Nope',version:0})).status,404);
  for(const nickname of ['x'.repeat(33),'bad\nname','bad\u202ename',1])assert.equal((await f.call(mod,route(member.id),'PATCH',{nickname,version:0})).status,400);
  assert.equal((await f.call(mod,route(member.id),'PATCH',{nickname:'A helpful name',version:0,reason:'Member request'})).status,200);
  const everyone=s.roles.find(r=>r.id==='everyone');await f.call(owner,'/servers/'+s.id+'/roles/everyone','PATCH',{permissions:everyone.permissions.filter(p=>p!=='changeNickname')});
  assert.equal((await f.call(member,route(member.id),'PATCH',{nickname:'Denied',version:1})).status,403);
  assert.equal((await f.call(mod,'/platform/overview')).status,403);
  const audit=(await f.call(owner,'/servers/'+s.id+'/audit')).data;assert.ok(audit.some(e=>e.action==='Server nickname changed'&&e.reason==='Member request'));
 }finally{await f.cleanup();}
});
test('nickname edits recheck membership after delayed request bodies and a rejoin starts without the old nickname',async()=>{
 const f=await fixture();let req;try{
  const owner=await f.register('nick_race_owner'),member=await f.register('nick_race_member'),s=(await f.call(owner,'/servers','POST',{name:'Nickname race'})).data;
  await f.call(member,'/invites/join','POST',{code:s.invite});const route='/servers/'+s.id+'/nicknames/'+member.id;
  await f.call(member,route,'PATCH',{nickname:'Old name',version:0});
  const data=JSON.stringify({nickname:'Delayed name',version:1});
  const result=new Promise((resolve,reject)=>{req=http.request(new URL(f.origin+'/api'+route),{method:'PATCH',headers:{Cookie:member.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(data.slice(0,-1));});
  await f.call(owner,'/servers/'+s.id+'/members/'+member.id,'DELETE',{});req.end(data.slice(-1));assert.equal(await result,404);
  await f.call(member,'/invites/join','POST',{code:s.invite});const current=(await f.call(member,'/state')).data.servers.find(x=>x.id===s.id);assert.equal(current.nicknames[member.id],undefined);assert.equal(current.nicknameVersions[member.id],2);
  assert.equal((await f.call(member,route,'PATCH',{nickname:'Old stale edit',version:1})).status,409);
 }finally{req?.destroy();await f.cleanup();}
});
