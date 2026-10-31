import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixture } from './support/server.mjs';
import { activePremium,premiumPerks,initializePremiumUser } from '../premium.js';
const endpoint=id=>'/platform/premium/members/'+id;
async function grant(f,owner,user,days=30){const current=(await f.call(user,'/premium/me')).data;const r=await f.call(owner,endpoint(user.id),'PATCH',{version:current.version,days,reason:'Synthetic access grant'});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
async function revoke(f,owner,user){const current=(await f.call(user,'/premium/me')).data;return f.call(owner,endpoint(user.id),'PATCH',{version:current.version,revoke:true,reason:'Synthetic grant revoked'});}

test('Plus grants are owner-only, versioned, durable and private; free capabilities remain unchanged and profile styles are optional',async()=>{
 const f=await fixture();try{
  const owner=await f.register('plus_owner'),user=await f.register('plus_member'),other=await f.register('plus_other');
  assert.equal((await f.call(user,'/premium/me')).data.plan,'free');assert.deepEqual((await f.call(user,'/premium/me')).data.perks,{messageCharacters:2000,uploadBytes:8*1048576,bioCharacters:190,boostSlots:0});
  assert.equal((await f.call(user,endpoint(user.id),'PATCH',{version:0,days:30,reason:'Self grant'})).status,403);
  assert.equal((await f.call(user,'/platform/premium/members')).status,403);assert.equal((await f.call(user,'/premium/profile','PATCH',{version:0,bannerStart:'#123456'})).status,403);
  let plus=await grant(f,owner,user);assert.equal(plus.plan,'plus');assert.equal((await f.call(owner,endpoint(user.id),'PATCH',{version:0,revoke:true,reason:'Stale'})).status,409);
  const styled=await f.call(user,'/premium/profile','PATCH',{version:plus.version,bannerStart:'#123456',bannerEnd:'#abcdef',accent:'#b197fc',showBadge:false});assert.equal(styled.status,200);
  const boot=(await f.call(other,'/state')).data,card=boot.users.find(u=>u.id===user.id);assert.equal(card.premium.badge,false);assert.equal(card.premium.profile.bannerStart,'#123456');assert.ok(!JSON.stringify(boot).includes('Synthetic access grant'));assert.ok(!Object.hasOwn(card,'billing'));assert.ok(!Object.hasOwn(card.premium,'grant'));
  await f.stop();await f.start();assert.equal((await f.call(user,'/premium/me')).data.active,true);assert.equal((await f.call(user,'/profile','PATCH',{premium:{active:false}})).status,200);assert.equal((await f.call(user,'/premium/me')).data.active,true);
  assert.equal((await revoke(f,owner,user)).status,200);assert.equal((await f.call(user,'/premium/me')).data.active,false);assert.equal((await f.call(other,'/state')).data.users.find(u=>u.id===user.id).premium.profile,null);
  const audit=(await f.call(owner,'/platform/audit')).data;assert.ok(audit.items.some(e=>e.action==='Plus access granted'));assert.ok(audit.items.some(e=>e.action==='Plus grant revoked'));
 }finally{await f.cleanup();}
});

test('Plus message, thread, bio and upload limits are enforced on the backend without granting channel permissions',async()=>{
 const f=await fixture();try{
  const owner=await f.register('limits_owner'),user=await f.register('limits_member');const O=(p,m,d)=>f.call(owner,p,m,d),U=(p,m,d)=>f.call(user,p,m,d),s=(await O('/servers','POST',{name:'Plan Limits'})).data,channel=s.channels[0].id;
  await U('/invites/join','POST',{code:s.invite});const long='L'.repeat(3000);
  assert.equal((await U('/messages','POST',{channel,text:long})).status,400);await grant(f,owner,user);
  const m=await U('/messages','POST',{channel,text:long});assert.equal(m.status,201);assert.equal((await U('/messages/'+m.data.id,'PATCH',{text:long+' edited'})).status,200);assert.equal((await U('/messages','POST',{channel,text:'x'.repeat(4001)})).status,400);
  const t=(await O('/threads','POST',{messageId:m.data.id,name:'Plus thread'})).data,reply=await U('/threads/'+t.id+'/messages','POST',{text:long});assert.equal(reply.status,201);assert.equal((await U('/thread-messages/'+reply.data.id,'PATCH',{text:long+' edit'})).status,200);
  assert.equal((await U('/profile','PATCH',{bio:'B'.repeat(500)})).status,200);assert.equal((await U('/profile','PATCH',{displayName:'Do not save',bio:'B'.repeat(501)})).status,400);assert.equal((await U('/state')).data.me.displayName,'limits_member');
  const payload=Buffer.alloc(9*1048576,65),upload=await fetch(f.origin+'/api/files?channel='+channel,{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'text/plain','X-File-Name':'plus-upload.txt'},body:payload});assert.equal(upload.status,201);const file=await upload.json();
  const hidden=(await O('/servers/'+s.id+'/channels','POST',{name:'hidden',type:'text',private:true})).data;assert.equal((await U('/messages','POST',{channel:hidden.id,text:'Still denied'})).status,403);
  await revoke(f,owner,user);assert.equal((await U('/messages/'+m.data.id,'PATCH',{text:long})).status,400);assert.equal((await U('/threads/'+t.id+'/messages','POST',{text:long})).status,400);assert.equal((await U('/state')).data.me.bio.length,190);
  const blocked=await fetch(f.origin+'/api/files?channel='+channel,{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'text/plain','X-File-Name':'too-large.txt'},body:payload});assert.equal(blocked.status,413);assert.equal((await fetch(f.origin+'/api/files/'+file.id,{headers:{Cookie:user.cookie}})).status,200,'already-uploaded files remain available');
  assert.equal((await U('/messages?channel='+channel)).data.find(x=>x.id===m.data.id).text.length,3007);
 }finally{await f.cleanup();}
});

test('two boosts unlock real emoji capacity, transfer cooldowns persist, and revocation preserves existing emoji without new over-cap uploads',async()=>{
 const f=await fixture();try{
  const owner=await f.register('boost_owner'),user=await f.register('boost_member'),O=(p,m,d)=>f.call(owner,p,m,d),U=(p,m,d)=>f.call(user,p,m,d),s=(await O('/servers','POST',{name:'Boost Lab'})).data,second=(await O('/servers','POST',{name:'Other Lab'})).data;
  await U('/invites/join','POST',{code:s.invite});await grant(f,owner,user);let info=(await U('/premium/me')).data;
  assert.equal((await U('/premium/boosts/1','PATCH',{version:info.version,serverId:second.id})).status,403);for(const slot of [1,2]){info=(await U('/premium/me')).data;assert.equal((await U('/premium/boosts/'+slot,'PATCH',{version:info.version,serverId:s.id})).status,200);}
  let view=(await O('/state')).data.servers.find(x=>x.id===s.id);assert.deepEqual(view.boosts,{count:2,level:1,emojiSlots:100});assert.ok(!JSON.stringify(view).includes('Synthetic access grant'));
  await U('/invites/join','POST',{code:second.invite});info=(await U('/premium/me')).data;assert.equal((await U('/premium/boosts/1','PATCH',{version:info.version,serverId:second.id})).status,429);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const upload=async name=>{const r=await fetch(f.origin+'/api/servers/'+s.id+'/emojis?name='+name,{method:'POST',headers:{Cookie:owner.cookie,'Content-Type':'image/png'},body:png});return{status:r.status,data:await r.json()};};const original=await upload('first');assert.equal(original.status,201);
  await f.stop();const state=JSON.parse(await readFile(f.dir+'/state.json','utf8')),sample=state.serverEmojis[0];for(let i=1;i<50;i++){const id=randomUUID();state.serverEmojis.push({...sample,id,name:'seed_'+i});await writeFile(f.dir+'/emojis/'+id,png);}await writeFile(f.dir+'/state.json',JSON.stringify(state));await f.start();
  assert.equal((await upload('extra')).status,201);await revoke(f,owner,user);view=(await O('/state')).data.servers.find(x=>x.id===s.id);assert.equal(view.boosts.emojiSlots,50);assert.equal((await upload('no_more')).status,400);assert.equal((await fetch(f.origin+'/api/emojis/'+original.data.id,{headers:{Cookie:user.cookie}})).status,200);
  await grant(f,owner,user);info=(await U('/premium/me')).data;await U('/premium/boosts/1','PATCH',{version:info.version,serverId:null});info=(await U('/premium/me')).data;assert.equal((await U('/premium/boosts/1','PATCH',{version:info.version,serverId:s.id})).status,200,'restoring the same server is allowed');
  await U('/servers/'+s.id+'/leave','POST',{});assert.equal((await O('/state')).data.servers.find(x=>x.id===s.id).boosts.count,0);assert.ok(!(await U('/premium/me')).data.boosts.some(b=>b.serverName==='Boost Lab'));
 }finally{await f.cleanup();}
});

test('revoking Plus during delayed message and upload bodies prevents premium writes; moderation inspects all premium poll content',async()=>{
 const f=await fixture();try{
  const owner=await f.register('delayed_plus_owner'),user=await f.register('delayed_plus_member'),O=(p,m,d)=>f.call(owner,p,m,d),U=(p,m,d)=>f.call(user,p,m,d),s=(await O('/servers','POST',{name:'Delayed Plus'})).data,channel=s.channels[0].id;await U('/invites/join','POST',{code:s.invite});await grant(f,owner,user);
  function delayed(path,content,headers={}){let finish;const response=new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api'+path,{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'application/json','Content-Length':content.length,...headers}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(content.subarray(0,12));finish=()=>req.end(content.subarray(12));});return{response,finish};}
  let request=delayed('/messages',Buffer.from(JSON.stringify({channel,text:'x'.repeat(3000)})));await revoke(f,owner,user);request.finish();assert.equal(await request.response,400);
  await grant(f,owner,user);request=delayed('/files?channel='+channel,Buffer.alloc(9*1048576),{'Content-Type':'application/octet-stream','X-File-Name':'delayed.bin'});await revoke(f,owner,user);request.finish();assert.equal(await request.response,413);
  await grant(f,owner,user);await O('/servers/'+s.id+'/automod/rules','POST',{name:'No forbidden',kind:'keywords',terms:['forbidden'],action:'block'});await O('/servers/'+s.id+'/automod','PATCH',{enabled:true});
  assert.equal((await U('/messages','POST',{channel,text:'x'.repeat(4000),poll:{question:'Choose one',answers:['safe','forbidden']}})).status,422,'poll answers after a long premium text cannot bypass AutoMod');
 }finally{await f.cleanup();}
});

test('expiry, suspension and bot identities cannot retain premium capabilities and current pricing is publicly available without checkout credentials',async()=>{
 const now=Date.now(),u={id:'member',bot:false};initializePremiumUser(u);u.premium.grant={expiresAt:now+100};assert.equal(activePremium(u,now),true);assert.equal(activePremium(u,now+100),false);u.premium.grant={expiresAt:null};u.suspendedUntil=-1;assert.equal(activePremium(u),false);u.suspendedUntil=0;u.bot=true;assert.equal(premiumPerks(u).messageCharacters,2000);assert.equal(premiumPerks(u).bioCharacters,500,'existing bot application descriptions keep their original limit');
 const f=await fixture();try{const owner=await f.register('catalog_owner'),catalog=await f.call(null,'/premium/catalog');assert.equal(catalog.status,200);assert.deepEqual(catalog.data.prices.map(p=>p.amount),[999,8999]);assert.equal(catalog.data.checkoutAvailable,false);assert.equal((await f.call(owner,'/premium/checkout','POST',{interval:'month'})).status,503);assert.equal((await f.call(owner,'/platform/premium/configuration')).status,200);
 }finally{await f.cleanup();}
});
