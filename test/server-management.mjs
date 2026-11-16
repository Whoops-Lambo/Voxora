import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {ROLE_TEMPLATES,serverPermissions,channelPermissions,roleRank} from '../public/permissions.js';

test('temporary roles expire at evaluation time, including hierarchy and channel overrides',()=>{
  const s={ownerId:'owner',members:['owner','member'],roles:[{id:'everyone',position:0,permissions:['viewChannel']},{id:'staff',position:5,permissions:['administrator']}],memberRoles:{member:['staff']},roleExpirations:{member:{staff:Date.now()-1}},channels:[{id:'c',overwrites:[{type:'role',id:'staff',allow:['sendMessages'],deny:[]}]}]};
  assert.deepEqual(serverPermissions(s,'member'),['viewChannel']);
  assert.equal(roleRank(s,'member'),0);
  assert.equal(channelPermissions(s,'member','c').includes('sendMessages'),false);
  s.roleExpirations.member.staff=Date.now()+60000;
  assert.ok(serverPermissions(s,'member').includes('manageRoles'));
  assert.equal(ROLE_TEMPLATES.some(t=>t.permissions.includes('administrator')),false);
});

test('role templates, delegated assignments, expiration, new channel controls and restart persistence',{timeout:60000},async()=>{
  const dir=await mkdtemp('/tmp/voxora-management-');
  let child,origin;
  async function start(){
    child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',VOXORA_HOST:'127.0.0.1',VOXORA_DATA_DIR:dir},stdio:['ignore','pipe','inherit']});
    origin=await new Promise((resolve,reject)=>{
      child.once('error',reject);child.once('exit',code=>reject(Error('Server exited '+code)));
      createInterface({input:child.stdout}).on('line',line=>{const m=line.match(/running on port (\d+)/);if(m)resolve('http://127.0.0.1:'+m[1]);});
    });
  }
  async function stop(){if(child?.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}}
  async function api(user,path,method='GET',data){
    const r=await fetch(origin+'/api'+path,{method,headers:{...(user?{Cookie:user.cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    await start();
    const users=[];
    for(const username of ['manager_owner','manager_delegate','manager_member']){
      const r=await api(null,'/auth/register','POST',{username,password:'Fixture-password-482'});
      assert.equal(r.status,200);users.push({cookie:r.cookie,id:r.data.me.id});
    }
    const [owner,delegate,member]=users;
    const state=(await api(owner,'/state')).data;
    const s=state.servers[0],base='/servers/'+s.id;
    let r=await api(owner,base+'/role-templates');
    assert.equal(r.status,200);assert.equal(r.data.length,9);
    const create=async data=>{const r=await api(owner,base+'/roles','POST',data);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
    const guest=await create({templateId:'guest'});
    const staff=await create({name:'Delegated assigner',permissions:['assignRoles','viewChannel','sendMessages','connect','speak']});
    assert.equal((await api(owner,base+'/members/'+delegate.id,'PATCH',{roles:[staff.id]})).status,200);
    assert.equal((await api(delegate,base+'/roles','POST',{name:'Forbidden'})).status,403);
    assert.equal((await api(delegate,base+'/role-templates','POST',{name:'Forbidden',permissions:[]})).status,403);
    assert.equal((await api(delegate,base+'/members/'+member.id,'PATCH',{roles:[staff.id]})).status,403);
    r=await api(owner,base+'/role-templates','POST',{name:'Guest copy',permissions:guest.permissions});
    assert.equal(r.status,201);const template=r.data;
    assert.equal((await api(owner,base+'/roles','POST',{templateId:template.id})).status,201);
    assert.equal((await api(owner,base+'/members/'+member.id,'PATCH',{roles:[guest.id],expiresAt:{[guest.id]:Date.now()-1}})).status,400);
    assert.equal((await api(delegate,base+'/members/'+member.id,'PATCH',{roles:[guest.id],expiresAt:{[guest.id]:Date.now()+3000}})).status,200);
    await stop();await start();
    assert.ok((await api(owner,base+'/role-templates')).data.some(t=>t.id===template.id));
    await new Promise(r=>setTimeout(r,3500));
    const after=(await api(owner,'/state')).data.servers.find(x=>x.id===s.id);
    assert.equal(after.memberRoles[member.id].includes(guest.id),false);
    const bulletin=(await api(owner,base+'/channels','POST',{name:'news',type:'bulletin'})).data;
    const links=(await api(owner,base+'/channels','POST',{name:'resources',type:'links'})).data;
    const post=(user,channel,text)=>api(user,'/messages','POST',{channel:channel.id,text});
    assert.equal((await post(member,bulletin,'No publishing permission')).status,403);
    assert.equal((await post(owner,bulletin,'A bulletin')).status,201);
    assert.equal((await post(owner,links,'Missing resource URL')).status,400);
    assert.equal((await post(owner,links,'Resource https://example.com/guide')).status,201);
    const curator=await create({templateId:'curator'});
    assert.equal((await api(owner,base+'/members/'+member.id,'PATCH',{roles:[curator.id]})).status,200);
    const resource=await post(member,links,'Guide https://example.com');assert.equal(resource.status,201);
    assert.equal((await api(member,'/messages/'+resource.data.id,'PATCH',{text:'Removed the required link'})).status,400);
    assert.equal((await api(member,'/messages/'+resource.data.id,'PATCH',{text:'Updated https://example.com/new'})).status,200);
    assert.equal((await post(member,bulletin,'Still cannot publish')).status,403);
    const snapshot=await api(owner,base+'/templates','POST',{name:'Management layout',description:'Reusable modes'});
    assert.equal(snapshot.status,201);
    const clone=await api(owner,'/server-templates/'+snapshot.data.code+'/create','POST',{name:'Management clone'});
    assert.equal(clone.status,201);
    const cloned=(await api(owner,'/state')).data.servers.find(s=>s.id===clone.data.id);
    assert.ok(cloned.channels.some(c=>c.bulletin));assert.ok(cloned.channels.some(c=>c.links));
    assert.ok(cloned.roleTemplates.some(t=>t.name==='Guest copy'));
    assert.equal(cloned.roles.find(r=>r.name==='Delegated assigner').permissions.includes('manageRoles'),false);
    assert.deepEqual(cloned.roleExpirations,{});
    assert.equal((await api(owner,base+'/role-templates/'+template.id,'DELETE')).status,200);
  }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
