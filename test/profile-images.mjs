import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import http from 'node:http';
import {PNG} from 'pngjs';
import {fixture} from './support/server.mjs';
function image(width=8,height=8,color=[40,190,150,255]){const p=new PNG({width,height});for(let i=0;i<p.data.length;i+=4)for(let k=0;k<4;k++)p.data[i+k]=color[k];return PNG.sync.write(p);}
async function upload(f,who,route,version=0,content=image()){const r=await fetch(f.origin+'/api'+route+'?version='+version,{method:'POST',headers:{Cookie:who.cookie,'Content-Type':'image/png'},body:content});return{status:r.status,data:await r.json()};}
async function asset(f,who,url){return fetch(f.origin+url,{headers:who?{Cookie:who.cookie}:{}});}
test('avatars upload, replace, remove, synchronize metadata and survive restart without exposing unrelated profiles',async()=>{
 const f=await fixture();try{
  const a=await f.register('photo_owner'),b=await f.register('photo_member'),O=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d);let uploaded=await upload(f,a,'/profile/avatar');assert.equal(uploaded.status,200);let original=uploaded.data.url;
  const user=(await O('/state')).data.me;assert.equal(user.avatarUrl,original);assert.equal(user.avatarVersion,1);
  const fetched=await asset(f,b,original);assert.equal(fetched.status,200);assert.equal(fetched.headers.get('content-type'),'image/png');assert.deepEqual([...PNG.sync.read(Buffer.from(await fetched.arrayBuffer())).data.subarray(0,4)],[40,190,150,255]);assert.equal((await asset(f,null,original)).status,401);
  assert.equal((await upload(f,a,'/profile/avatar',0)).status,409);
  uploaded=await upload(f,a,'/profile/avatar',1,image(8,8,[200,80,40,255]));assert.equal(uploaded.status,200);assert.notEqual(uploaded.data.url,original);assert.equal((await asset(f,b,original)).status,404);assert.equal((await readdir(f.dir+'/profile-images')).length,1);
  await f.stop();await f.start();assert.equal((await O('/state')).data.me.avatarUrl,uploaded.data.url);assert.equal((await asset(f,b,uploaded.data.url)).status,200);
  await B('/servers/community/leave','POST',{});assert.equal((await asset(f,b,uploaded.data.url)).status,404);
  const removed=await O('/profile/avatar?version=2','DELETE');assert.equal(removed.status,200);assert.equal((await O('/state')).data.me.avatarUrl,null);assert.equal((await readdir(f.dir+'/profile-images')).length,0);
 }finally{await f.cleanup();}
});
test('server icons and banners require Manage Server and follow membership and Discovery visibility',async()=>{
 const f=await fixture();try{
  const a=await f.register('brand_owner'),b=await f.register('brand_member'),c=await f.register('brand_outsider'),O=(p,m,d)=>f.call(a,p,m,d),s=(await O('/servers','POST',{name:'Branded community'})).data;await f.call(b,'/invites/join','POST',{code:s.invite});
  assert.equal((await upload(f,b,'/servers/'+s.id+'/icon')).status,403);
  const icon=await upload(f,a,'/servers/'+s.id+'/icon');assert.equal(icon.status,200);const banner=await upload(f,a,'/servers/'+s.id+'/banner',0,image(32,18));assert.equal(banner.status,200);
  const server=(await O('/state')).data.servers.find(x=>x.id===s.id);assert.equal(server.iconUrl,icon.data.url);assert.equal(server.bannerUrl,banner.data.url);assert.ok(!Object.hasOwn(server,'iconImage'));
  assert.equal((await asset(f,b,icon.data.url)).status,200);assert.equal((await asset(f,c,icon.data.url)).status,404);
  assert.equal((await O('/servers/'+s.id+'/discovery','PATCH',{enabled:true,category:'Community',summary:'A public community',tags:[]})).status,200);const listings=(await f.call(c,'/discovery')).data;assert.equal(listings.items.find(x=>x.id===s.id).iconUrl,icon.data.url);assert.equal((await asset(f,c,icon.data.url)).status,200);
  await O('/servers/'+s.id+'/discovery','PATCH',{enabled:false});assert.equal((await asset(f,c,banner.data.url)).status,404);
  await f.stop();await f.start();const after=(await O('/state')).data.servers.find(x=>x.id===s.id);assert.equal(after.bannerVersion,1);assert.equal((await asset(f,b,banner.data.url)).status,200);
  assert.equal((await O('/servers/'+s.id+'/icon?version=1','DELETE')).status,200);assert.equal((await asset(f,b,icon.data.url)).status,404);
 }finally{await f.cleanup();}
});
test('invalid, oversized, malformed and stale picture uploads preserve the previous image',async()=>{
 const f=await fixture();try{const a=await f.register('photo_validation'),original=await upload(f,a,'/profile/avatar');for(const bad of[Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),image(513,513),image(8,4),Buffer.alloc(3*1024*1024+1),Buffer.from('not an image')]){
  const result=await upload(f,a,'/profile/avatar',1,bad);assert.ok([400,413].includes(result.status),result.status);
 }const corrupt=image();corrupt[corrupt.length-1]^=255;assert.equal((await upload(f,a,'/profile/avatar',1,corrupt)).status,400);assert.equal((await f.call(a,'/state')).data.me.avatarUrl,original.data.url);assert.equal((await readdir(f.dir+'/profile-images')).length,1);
 }finally{await f.cleanup();}
});
test('upload completion rechecks server membership and permissions after a delayed request body',async()=>{
 const f=await fixture();try{const a=await f.register('photo_delay_owner'),b=await f.register('photo_delay_member'),O=(p,m,d)=>f.call(a,p,m,d),role=(await O('/servers/community/roles','POST',{name:'Brand manager',permissions:['manageServer']})).data;await O('/servers/community/members/'+b.id,'PATCH',{roles:[role.id]});
 const content=image();let finish;const response=new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api/servers/community/icon?version=0',{method:'POST',headers:{Cookie:b.cookie,'Content-Type':'image/png','Content-Length':content.length}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(content.subarray(0,16));finish=()=>req.end(content.subarray(16));});await O('/servers/community/members/'+b.id,'PATCH',{roles:[]});finish();assert.equal(await response,403);assert.equal((await O('/state')).data.servers[0].iconUrl,null);
 }finally{await f.cleanup();}
});
test('pronouns and profile links validate atomically and persist without changing avatar metadata',async()=>{
 const f=await fixture();try{const a=await f.register('profile_fields'),A=(p,m,d)=>f.call(a,p,m,d);assert.equal((await A('/profile','PATCH',{pronouns:'they/them',profileLinks:[{label:'My site',url:'https://example.com/profile'}]})).status,200);
  for(const profileLinks of[[{url:'javascript:alert(1)'}],[{url:'data:text/html,bad'}],[{url:'https://user:secret@example.com/'}],Array(4).fill({url:'https://example.com'})])assert.equal((await A('/profile','PATCH',{displayName:'Do not apply',profileLinks})).status,400);
  await f.stop();await f.start();const user=(await A('/state')).data.me;assert.equal(user.displayName,'profile_fields');assert.equal(user.pronouns,'they/them');assert.equal(user.profileLinks[0].label,'My site');assert.equal(user.avatarVersion,0);
 }finally{await f.cleanup();}
});
