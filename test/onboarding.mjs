import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fixture } from './support/server.mjs';
import { roleRank, channelPermissions } from '../public/permissions.js';

test('server guides screen new members across writes and voice, version acceptance and persist private progress without changing existing access', async () => {
  const f = await fixture();
  try {
    const owner = await f.register('guide_owner'), existing = await f.register('guide_existing'), newcomer = await f.register('guide_new'), outside = await f.register('guide_outside');
    const O = (p,m,d) => f.call(owner,p,m,d), N = (p,m,d) => f.call(newcomer,p,m,d);
    const s = (await O('/servers','POST',{name:'Guide Lab'})).data, base='/servers/'+s.id+'/onboarding', channel=s.channels[0].id;
    await f.call(existing,'/invites/join','POST',{code:s.invite});
    const privateRoom = (await O('/servers/'+s.id+'/channels','POST',{name:'staff-only',private:true,type:'text'})).data;
    assert.equal((await O(base+'/settings','PATCH',{enabled:true,title:'Start here',description:'Meet your people',rules:['Be kind','No spam'],requireRules:true,channels:[channel,privateRoom.id]})).status,200);
    assert.equal((await f.call(existing,'/messages','POST',{channel,text:'Existing access stays'})).status,201);
    assert.equal((await f.call(outside,base)).status,404);
    await N('/invites/join','POST',{code:s.invite});
    await O('/channels/'+channel,'PATCH',{overwrites:[{type:'role',id:'everyone',deny:[],allow:['sendMessages','attachFiles','addReactions']}]});
    const guide=(await N(base)).data;assert.equal(guide.pendingRules,true);assert.equal(guide.channels.length,1);assert.ok(!JSON.stringify(guide).includes('staff-only'));
    const view=(await N('/state')).data.servers.find(x=>x.id===s.id);assert.equal(view.onboarding.pendingRules,true);assert.ok(!JSON.stringify(view).includes('onboardingMembers'));assert.ok(!JSON.stringify(view).includes('acceptedAt'));
    assert.deepEqual(channelPermissions(view,newcomer.id,channel),['viewChannel']);
    assert.equal((await N('/messages','POST',{channel,text:'Before rules'})).status,403);
    const parent=(await O('/messages','POST',{channel,text:'A discussion'})).data;
    const thread=(await O('/threads','POST',{messageId:parent.id,name:'Rules discussion'})).data;
    assert.equal((await N('/messages/'+parent.id+'/reactions','POST',{emoji:'✅'})).status,403);
    const upload=await fetch(f.origin+'/api/files?channel='+channel,{method:'POST',headers:{Cookie:newcomer.cookie,'Content-Type':'text/plain','X-File-Name':'screening.txt'},body:'Not accepted yet'});assert.equal(upload.status,403);
    assert.equal((await N('/threads/'+thread.id+'/messages','POST',{text:'Bypass'})).status,403);
    assert.equal((await N('/voice/join','POST',{channel:s.channels[1].id,clientId:'screening-voice-client'})).status,403);
    assert.equal((await N(base+'/dismiss','POST',{})).status,403);
    await O(base+'/settings','PATCH',{rules:['Updated rules']});
    assert.equal((await N(base+'/complete','POST',{acceptRules:true,rulesVersion:guide.rulesVersion,roleIds:[]})).status,409);
    const latest=(await N(base)).data;
    assert.equal((await N(base+'/complete','POST',{acceptRules:true,rulesVersion:latest.rulesVersion,roleIds:['everyone']})).status,403);
    assert.equal((await N(base)).data.pendingRules,true);
    assert.equal((await N(base+'/complete','POST',{acceptRules:true,rulesVersion:latest.rulesVersion,roleIds:[]})).status,200);
    assert.equal((await N('/messages','POST',{channel,text:'After acceptance'})).status,201);
    await f.stop();await f.start();assert.equal((await N(base)).data.pendingRules,false);assert.ok((await N(base)).data.acceptedAt);
    await N('/servers/'+s.id+'/leave','POST',{});await N('/invites/join','POST',{code:s.invite});assert.equal((await N(base)).data.pendingRules,true);
    await O(base+'/settings','PATCH',{requireRules:false});assert.equal((await N('/messages','POST',{channel,text:'Screening disabled'})).status,201);
    await O('/servers/'+s.id+'/discovery','PATCH',{enabled:true,summary:'Join here',category:'Community'});
    await O(base+'/settings','PATCH',{requireRules:true});await f.call(outside,'/discovery/'+s.id+'/join','POST',{});assert.equal((await f.call(outside,base)).data.pendingRules,true);
  } finally { await f.cleanup(); }
});

test('optional roles unlock channels without escalating moderation hierarchy; unsafe changes withdraw self-grants and preserve explicit staff assignments', async () => {
  const f=await fixture();
  try {
    const owner=await f.register('roles_owner'), member=await f.register('roles_member'), manager=await f.register('roles_manager'), target=await f.register('roles_target'), manual=await f.register('roles_manual');
    const O=(p,m,d)=>f.call(owner,p,m,d), M=(p,m,d)=>f.call(member,p,m,d), A=(p,m,d)=>f.call(manager,p,m,d);
    const s=(await O('/servers','POST',{name:'Role Menus'})).data, base='/servers/'+s.id, guide=base+'/onboarding', channel=s.channels[0].id;
    for(const u of [member,manager,target,manual])await f.call(u,'/invites/join','POST',{code:s.invite});
    const create=async(name,permissions=[]) => (await O(base+'/roles','POST',{name,permissions})).data;
    const low=await create('Junior Moderator',['kickMembers']), staff=await create('Role Manager',['manageRoles']), senior=await create('Senior Member'), interest=await create('Gaming');
    await O(base+'/members/'+member.id,'PATCH',{roles:[low.id]});await O(base+'/members/'+manager.id,'PATCH',{roles:[staff.id]});await O(base+'/members/'+target.id,'PATCH',{roles:[senior.id]});await O(base+'/members/'+manual.id,'PATCH',{roles:[interest.id]});
    assert.equal((await O(guide+'/settings','PATCH',{roleIds:[low.id]})).status,403);
    assert.equal((await A(guide+'/settings','PATCH',{roleIds:[interest.id]})).status,403);
    const room=(await O(base+'/channels','POST',{name:'gaming-club',type:'text',private:true})).data;
    await O('/channels/'+room.id,'PATCH',{overwrites:[{type:'role',id:'everyone',deny:['viewChannel'],allow:[]},{type:'role',id:interest.id,deny:[],allow:['viewChannel']}]});
    await O(guide+'/settings','PATCH',{roleIds:[interest.id],channels:[channel,room.id]});
    assert.equal((await M('/messages?channel='+room.id)).status,403);
    assert.equal((await M(guide+'/complete','POST',{roleIds:[interest.id]})).status,200);
    assert.equal((await M('/messages?channel='+room.id)).status,200);
    const view=(await M('/state')).data.servers.find(x=>x.id===s.id);assert.ok(view.memberRoles[member.id].includes(interest.id));assert.equal(roleRank(view,member.id),low.position);
    assert.equal((await M(base+'/members/'+target.id,'DELETE',{})).status,403);
    assert.equal((await A(base+'/members/'+member.id,'PATCH',{roles:[low.id,interest.id]})).status,403);
    await f.call(manual,guide+'/complete','POST',{roleIds:[]});assert.ok((await f.call(manual,guide)).data.roles[0].locked);
    await O('/channels/'+channel,'PATCH',{overwrites:[{type:'role',id:interest.id,deny:[],allow:['manageMessages']}]});
    assert.equal((await M(guide)).data.roles.length,0);assert.ok(!(await M('/state')).data.servers.find(x=>x.id===s.id).memberRoles[member.id].includes(interest.id));
    assert.ok((await O('/state')).data.servers.find(x=>x.id===s.id).memberRoles[manual.id].includes(interest.id));
    await O('/channels/'+channel,'PATCH',{overwrites:[]});await O(guide+'/settings','PATCH',{roleIds:[interest.id]});await M(guide+'/complete','POST',{roleIds:[interest.id]});
    await O(base+'/roles/'+interest.id,'PATCH',{permissions:['administrator']});
    assert.ok(!(await M('/state')).data.servers.find(x=>x.id===s.id).permissions.includes('administrator'));
    assert.ok((await f.call(manual,'/state')).data.servers.find(x=>x.id===s.id).permissions.includes('administrator'));
    assert.equal((await M(guide+'/complete','POST',{roleIds:[interest.id]})).status,403);
    await O(base+'/roles/'+interest.id,'PATCH',{permissions:[]});await O(guide+'/settings','PATCH',{roleIds:[interest.id]});await M(guide+'/complete','POST',{roleIds:[interest.id]});
    await O(base+'/members/'+member.id,'PATCH',{timeoutUntil:Date.now()+60000});
    assert.equal((await M(guide+'/complete','POST',{roleIds:[]})).status,403);
    await O(base+'/roles/'+interest.id,'DELETE');assert.equal((await M(guide)).data.roles.length,0);
    await f.stop();await f.start();assert.ok(!(await M('/state')).data.servers.find(x=>x.id===s.id).memberRoles[member.id].includes(interest.id));
  } finally { await f.cleanup(); }
});

test('onboarding configuration and acceptance recheck permissions after delayed request bodies and expose only the caller progress', async () => {
  const f=await fixture();
  try {
    const owner=await f.register('delay_owner'), editor=await f.register('delay_editor');const O=(p,m,d)=>f.call(owner,p,m,d), E=(p,m,d)=>f.call(editor,p,m,d);
    const s=(await O('/servers','POST',{name:'Delayed Guide'})).data,base='/servers/'+s.id;
    await E('/invites/join','POST',{code:s.invite});const role=(await O(base+'/roles','POST',{name:'Guide Editor',permissions:['manageServer']})).data;
    await O(base+'/members/'+editor.id,'PATCH',{roles:[role.id]});
    const payload=JSON.stringify({title:'A delayed change'});let finish;
    const response=new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api'+base+'/onboarding/settings',{method:'PATCH',headers:{Cookie:editor.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});req.on('error',reject);req.write(payload.slice(0,5));finish=()=>req.end(payload.slice(5));});
    await O(base+'/members/'+editor.id,'PATCH',{roles:[]});finish();assert.equal((await response).status,403);
    assert.notEqual((await E(base+'/onboarding')).data.title,'A delayed change');
    assert.equal((await E(base+'/onboarding/settings')).status,403);
    const boot=(await O('/state')).data;assert.ok(!JSON.stringify(boot).includes('onboardingMembers'));assert.equal(boot.servers.find(x=>x.id===s.id).onboarding.viewerId,owner.id);
  } finally { await f.cleanup(); }
});
