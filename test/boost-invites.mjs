import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {PNG} from 'pngjs';
import {fixture,until} from './support/server.mjs';
import {boostSummary,initializePremiumUser} from '../premium.js';
const grantPath=id=>'/platform/server-boosts/'+id;
async function grant(f,owner,id,version=0,expiresAt=null,level=3){const r=await f.call(owner,grantPath(id),'PATCH',{version,level,expiresAt,reason:'Community promotion'});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
test('boost thresholds count active members; timed grants set a minimum and expire back to earned levels',()=>{
 const users=Array.from({length:7},(_,i)=>{const u={id:String(i)};initializePremiumUser(u);u.premium.grant={expiresAt:null};u.premium.boosts.forEach(b=>b.serverId='s');return u;}),state={users},server={id:'s',members:users.map(u=>u.id)};
 for(const [count,level,slots]of[[0,0,30],[1,0,30],[2,1,60],[6,1,60],[7,2,90],[13,2,90],[14,3,200]]){users.forEach((u,i)=>u.premium.boosts.forEach((b,k)=>b.serverId=i*2+k<count?'s':null));const view=boostSummary(state,server,1000);assert.equal(view.level,level);assert.equal(view.emojiSlots,slots);}
 users.slice(1).forEach(u=>u.premium.grant=null);server.boostGrant={level:3,expiresAt:2000};assert.equal(boostSummary(state,server,1999).level,3);assert.equal(boostSummary(state,server,2000).level,1);server.boostGrant={level:1,expiresAt:null};assert.equal(boostSummary(state,server).count,2);users.forEach(u=>u.premium.grant={expiresAt:null});assert.equal(boostSummary(state,server).level,3);
});
test('owner and delegated boost staff can grant timed or unlimited levels, with versions, audit and persistence',async()=>{
 const f=await fixture();try{const owner=await f.register('grant_owner'),staff=await f.register('grant_staff'),member=await f.register('grant_member'),O=(p,m,d)=>f.call(owner,p,m,d),S=(p,m,d)=>f.call(staff,p,m,d),server=(await f.call(member,'/servers','POST',{name:'Member community'})).data;
  assert.equal((await S('/platform/server-boosts')).status,403);assert.equal((await f.call(member,grantPath(server.id),'PATCH',{version:0,level:3,expiresAt:null,reason:'Self'})).status,403);
  const role=(await O('/platform/staff-roles','POST',{name:'Boost managers',permissions:['manageBoosts']})).data;assert.equal((await O('/platform/users/'+staff.id,'PATCH',{staffRoleIds:[role.id]})).status,200);
  const granted=await grant(f,staff,server.id);assert.equal(granted.boosts.level,3);assert.equal(granted.boosts.count,0);assert.equal(granted.grant.expiresAt,null);assert.equal((await S('/platform/users')).status,403);
  assert.equal((await S(grantPath(server.id),'PATCH',{version:0,level:2,expiresAt:null,reason:'Stale'})).status,409);
  const publicState=(await f.call(member,'/state')).data.servers.find(s=>s.id===server.id);assert.ok(!JSON.stringify(publicState).includes('Community promotion'));assert.ok(!Object.hasOwn(publicState,'boostGrant'));
  await f.stop();await f.start();assert.equal((await S('/platform/server-boosts?q=Member')).data.items[0].boosts.level,3);
  const timed=await grant(f,staff,server.id,1,Date.now()+1400,2);assert.equal(timed.boosts.level,2);await until(async()=>(await f.call(member,'/state')).data.servers.find(s=>s.id===server.id).boosts.level===0,4000);
  await grant(f,owner,server.id,2);await grant(f,owner,server.id,3,null,0);assert.equal((await S('/platform/server-boosts?q=Member')).data.items[0].boosts.level,0);
  assert.ok((await O('/platform/audit')).data.items.some(a=>a.action==='Server boost grant revoked'));
 }finally{await f.cleanup();}
});
test('custom links require level 3, reserve names, preserve bans and stop joining when grants expire',async()=>{
 const f=await fixture();try{const owner=await f.register('vanity_owner'),member=await f.register('vanity_member'),other=await f.register('vanity_other'),O=(p,m,d)=>f.call(owner,p,m,d),server=(await O('/servers','POST',{name:'Mint community'})).data,second=(await O('/servers','POST',{name:'Second community'})).data,path='/servers/'+server.id+'/custom-invite';
  assert.equal((await O(path,'PATCH',{version:0,code:'mint-place'})).status,403);await grant(f,owner,server.id);await grant(f,owner,second.id);
  for(const code of['ab','-mint','mint-','hello/world','a'.repeat(33)])assert.equal((await O(path,'PATCH',{version:0,code})).status,400);
  assert.equal((await O(path,'PATCH',{version:0,code:'Mint-Place'})).data.code,'mint-place');assert.equal((await O(path,'PATCH',{version:0,code:'stale-name'})).status,409);
  assert.equal((await O('/servers/'+second.id+'/custom-invite','PATCH',{version:0,code:'mint-place'})).status,409);
  assert.equal((await f.call(member,path,'PATCH',{version:1,code:'hijack'})).status,404);assert.equal((await f.call(member,'/invites/join','POST',{code:f.origin+'/invite/mint-place'})).status,200);
  assert.equal((await f.call(member,path,'PATCH',{version:1,code:'hijack'})).status,403);
  assert.equal((await O('/servers/'+server.id+'/bans/'+member.id,'POST',{reason:'Test ban'})).status,200);assert.equal((await f.call(member,'/invites/join','POST',{code:'mint-place'})).status,403);
  await grant(f,owner,server.id,1,Date.now()+1300);await until(async()=>!(await O(path)).data.active,4000);
  assert.equal((await f.call(other,'/invites/join','POST',{code:'mint-place'})).status,404);assert.equal((await O('/servers/'+second.id+'/custom-invite','PATCH',{version:0,code:'mint-place'})).status,409);
  assert.equal((await f.call(other,'/invites/join','POST',{code:server.invite})).status,200);await grant(f,owner,server.id,2);assert.equal((await O(path)).data.active,true);
  assert.equal((await O(path,'PATCH',{version:1,code:null})).status,200);assert.equal((await O('/servers/'+second.id+'/custom-invite','PATCH',{version:0,code:'mint-place'})).status,200);
  await f.stop();await f.start();assert.equal((await f.call(member,'/invite-preview/mint-place')).data.id,second.id);
 }finally{await f.cleanup();}
});
test('invite previews expose only code-scoped branding; removing banners or revoking codes removes public image access',async()=>{
 const f=await fixture();try{const owner=await f.register('preview_owner'),O=(p,m,d)=>f.call(owner,p,m,d),server=(await O('/servers','POST',{name:'Preview community'})).data;const p=new PNG({width:32,height:18});p.data.fill(150);const upload=async(kind,version=0)=>{const r=await fetch(f.origin+'/api/servers/'+server.id+'/'+kind+'?version='+version,{method:'POST',headers:{Cookie:owner.cookie,'Content-Type':'image/png'},body:PNG.sync.write(p)});assert.equal(r.status,200);return r.json();};
  const banner=await upload('invite-banner'),preview=(await f.call(null,'/invite-preview/'+server.invite)).data;assert.ok(preview.bannerUrl.includes('/api/invite-images/'));assert.equal((await fetch(f.origin+preview.bannerUrl)).status,200);assert.equal((await fetch(f.origin+banner.url)).status,401);assert.ok(!JSON.stringify(preview).includes('ownerId'));assert.ok(!Object.hasOwn(preview,'channels'));
  await grant(f,owner,server.id);await O('/servers/'+server.id+'/custom-invite','PATCH',{version:0,code:'public-mint'});const custom=(await f.call(null,'/invite-preview/public-mint')).data;await O('/servers/'+server.id+'/custom-invite','PATCH',{version:1,code:null});assert.equal((await fetch(f.origin+custom.bannerUrl)).status,404);
  await O('/servers/'+server.id+'/invite-banner?version=1','DELETE');assert.equal((await fetch(f.origin+preview.bannerUrl)).status,404);assert.equal((await f.call(null,'/invite-preview/missing-name')).status,404);
 }finally{await f.cleanup();}
});
test('delayed boost requests recheck delegated platform permissions before writing',async()=>{
 const f=await fixture();try{const owner=await f.register('delayed_grant_owner'),staff=await f.register('delayed_grant_staff'),O=(p,m,d)=>f.call(owner,p,m,d),role=(await O('/platform/staff-roles','POST',{name:'Boost staff',permissions:['manageBoosts']})).data;await O('/platform/users/'+staff.id,'PATCH',{staffRoleIds:[role.id]});const data=JSON.stringify({version:0,level:3,expiresAt:null,reason:'Delayed'});let finish;const response=new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api'+grantPath('community'),{method:'PATCH',headers:{Cookie:staff.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(data.slice(0,10));finish=()=>req.end(data.slice(10));});await O('/platform/users/'+staff.id,'PATCH',{staffRoleIds:[]});finish();assert.equal(await response,403);assert.equal((await O('/state')).data.servers[0].boosts.level,0);
 }finally{await f.cleanup();}
});
