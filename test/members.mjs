import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './support/server.mjs';
test('one shared installation exposes its registered community members and gives platform ownership to exactly one account',async()=>{
  const f=await fixture();
  try{
    const firstInfo=await(await fetch(f.origin+'/api/info')).json();
    const people=await Promise.all(Array.from({length:5},(_,i)=>f.register('shared_member_'+i)));
    const owners=people.filter(p=>p.data.platform.owner);assert.equal(owners.length,1);const owner=owners[0],regular=people.find(p=>p!==owner);
    for(const p of people){const state=(await f.call(p,'/state')).data;assert.equal(state.platform.instanceId,firstInfo.instanceId);assert.equal(state.servers.find(s=>s.id==='community').members.length,5);assert.equal(state.users.filter(u=>!u.bot).length,5);if(p!==owner){assert.equal(state.platform.owner,false);assert.deepEqual(state.platform.permissions,[]);assert.equal((await f.call(p,'/platform/overview')).status,403);}}
    const directory=await f.call(regular,'/servers/community/members');assert.equal(directory.status,200);assert.equal(directory.data.total,5);assert.equal(directory.data.members.filter(u=>u.staffRoles.some(r=>r.id==='platform-owner')).length,1);assert.ok(!JSON.stringify(directory.data).includes('password'));
    const s=(await f.call(regular,'/servers','POST',{name:'A member-owned private server'})).data;
    assert.equal((await f.call(owner,'/servers/'+s.id+'/members')).status,404);
    assert.equal((await f.call(regular,'/platform/overview')).status,403);
    await f.call(owner,'/invites/join','POST',{code:s.invite});assert.equal((await f.call(owner,'/servers/'+s.id+'/members')).data.total,2);
    assert.equal((await f.call(regular,'/servers/community/members?q=shared_member_2')).data.total,1);
    await f.stop();await f.start();assert.equal((await(await fetch(f.origin+'/api/info')).json()).instanceId,firstInfo.instanceId);assert.equal((await f.call(owner,'/platform/me')).data.owner,true);
  }finally{await f.cleanup();}
});
test('an initialized platform never promotes a later signup when the owner record is unavailable',async()=>{
  const f=await fixture();
  try{
    await f.register('original_owner');await f.stop();const file=path.join(f.dir,'state.json'),state=JSON.parse(await readFile(file,'utf8'));
    assert.equal(state.platform.ownerInitialized,true);state.platform.ownerId=null;await writeFile(file,JSON.stringify(state));await f.start();
    const later=await f.register('later_account');assert.equal(later.data.platform.owner,false);assert.deepEqual(later.data.platform.permissions,[]);assert.equal((await f.call(later,'/platform/overview')).status,403);
  }finally{await f.cleanup();}
});
test('private desktop workspaces label their own owner and keep a different identity from the shared platform',async()=>{
  const f=await fixture({extraEnv:{VOXORA_PRIVATE_WORKSPACE:'1'}}),shared=await fixture();
  try{const owner=await f.register('private_owner');assert.equal(owner.data.platform.scope,'private');assert.equal(owner.data.me.staffRoles[0].name,'Workspace Owner');const localInfo=await(await fetch(f.origin+'/api/info')).json(),sharedInfo=await(await fetch(shared.origin+'/api/info')).json();assert.equal(localInfo.privateWorkspace,true);assert.notEqual(localInfo.instanceId,sharedInfo.instanceId);const second=await f.register('private_member');assert.equal(second.data.platform.owner,false);}finally{await f.cleanup();await shared.cleanup();}
});
