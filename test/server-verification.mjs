import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture} from './support/server.mjs';
import {verificationView,invalidateChangedVerifications} from '../server-verification.js';

test('server verification is staff controlled, separate from boosts, private in review detail, durable and publicly displayed',async()=>{
 const f=await fixture();try{
  const owner=await f.register('verification_owner'),member=await f.register('verification_member'),staff=await f.register('verification_staff'),O=(p,m,d)=>f.call(owner,p,m,d),M=(p,m,d)=>f.call(member,p,m,d),S=(p,m,d)=>f.call(staff,p,m,d);
  const server=(await M('/servers','POST',{name:'Identity Community'})).data,path='/platform/server-verifications/'+server.id,decision={version:0,verified:true,reviewed:true,name:server.name,ownerId:member.id,reason:'Private identity review marker'};
  assert.equal((await M(path,'PATCH',decision)).status,403);assert.equal((await S('/platform/server-verifications')).status,403);
  await M('/servers/'+server.id,'PATCH',{verification:{verified:true}});assert.equal((await M('/state')).data.servers.find(s=>s.id===server.id).verification.verified,false);
  assert.equal((await O(path,'PATCH',decision)).status,200);let snapshot=(await M('/state')).data.servers.find(s=>s.id===server.id);assert.equal(snapshot.verification.verified,true);assert.equal(snapshot.boosts.level,0);assert.ok(!JSON.stringify(snapshot).includes('Private identity review marker'));assert.ok(!Object.hasOwn(snapshot.verification,'reviewedBy'));
  const preview=(await f.call(null,'/invite-preview/'+server.invite)).data;assert.equal(preview.verification.verified,true);assert.ok(!JSON.stringify(preview).includes('Private identity review marker'));
  await M('/servers/'+server.id+'/discovery','PATCH',{enabled:true,summary:'A verified community for discovery',category:'Community',tags:[]});assert.equal((await O('/discovery?q=Identity')).data.items[0].verification.verified,true);
  const role=(await O('/platform/staff-roles','POST',{name:'Server Identity Review',permissions:['verifyServers']})).data;await O('/platform/users/'+staff.id,'PATCH',{staffRoleIds:[role.id]});assert.equal((await S('/platform/server-verifications?q=Identity')).data.total,1);assert.equal((await S('/platform/servers')).status,403);
  assert.equal((await S(path,'PATCH',{version:0,verified:false,reason:'Stale revision'})).status,409);
  assert.equal((await S(path,'PATCH',{version:1,verified:false,reason:'Verification revoked for review'})).status,200);assert.equal((await f.call(null,'/invite-preview/'+server.invite)).data.verification.verified,false);
  assert.equal((await S(path,'PATCH',{...decision,version:2})).status,200);await f.stop();await f.start();assert.equal((await M('/state')).data.servers.find(s=>s.id===server.id).verification.verified,true);
  await M('/servers/'+server.id,'PATCH',{name:'Changed Identity'});snapshot=(await M('/state')).data.servers.find(s=>s.id===server.id);assert.equal(snapshot.verification.verified,false);const current=(await S(path)).data;assert.equal(current.version,4);assert.equal((await S(path,'PATCH',{...decision,version:4})).status,409,'a stale identity cannot be verified after renaming');assert.ok((await O('/platform/audit')).data.items.some(item=>item.action==='Server verification invalidated'));
 }finally{await f.cleanup();}
});
test('ownership changes invalidate verification and delayed grants recheck staff permission',async()=>{
 const s={id:'s',name:'Identity',ownerId:'a',verification:{verified:true,version:1,name:'Identity',ownerId:'a',reviewedAt:100}},state={servers:[s]};assert.equal(verificationView(s).verified,true);s.ownerId='b';assert.equal(verificationView(s).verified,false);assert.equal(invalidateChangedVerifications(state),true);assert.equal(s.verification.version,2);
 const f=await fixture();try{
  const owner=await f.register('verification_race_owner'),staff=await f.register('verification_race_staff'),O=(p,m,d)=>f.call(owner,p,m,d),role=(await O('/platform/staff-roles','POST',{name:'Identity Review',permissions:['verifyServers']})).data;await O('/platform/users/'+staff.id,'PATCH',{staffRoleIds:[role.id]});
  const s=(await O('/platform/server-verifications/community')).data,data=JSON.stringify({version:0,verified:true,reviewed:true,name:s.name,ownerId:s.ownerId,reason:'Delayed grant test'});let finish;
  const response=new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api/platform/server-verifications/community',{method:'PATCH',headers:{Cookie:staff.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(data.slice(0,10));finish=()=>req.end(data.slice(10));});await O('/platform/users/'+staff.id,'PATCH',{staffRoleIds:[]});finish();assert.equal(await response,403);assert.equal((await O('/platform/server-verifications/community')).data.verification.verified,false);
 }finally{await f.cleanup();}
});
