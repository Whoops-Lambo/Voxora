import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {fixture,until} from './support/server.mjs';
import {VoxoraBot} from '../sdk/voxora.mjs';
async function setup(){const f=await fixture(),a=await f.register('studio_owner'),b=await f.register('studio_member'),c=await f.register('studio_other');const s=(await f.call(a,'/servers','POST',{name:'Studio test'})).data;for(const u of[b,c])await f.call(u,'/invites/join','POST',{code:s.invite});const channel=s.channels.find(c=>c.type==='text').id;return{f,a,b,c,s,channel,base:'/servers/'+s.id+'/studio'};}
test('project tasks support assignments, comments, source links, concurrency, history and current channel access',async()=>{
 const {f,a,b,c,s,channel,base}=await setup();try{
 const O=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d),message=(await O('/messages','POST',{channel,text:'An idea to build'})).data;
 let t=(await O(base+'/tasks','POST',{title:'Ship the idea',channelId:channel,assigneeId:b.id,sourceId:message.id,priority:'high',labels:['launch']})).data;assert.ok(t.id);assert.equal(t.source.text,'An idea to build');assert.equal((await B('/state')).data.studio.assignedCount,1);
 assert.equal((await f.call(c,base+'/tasks/'+t.id,'PATCH',{revision:0,title:'Unauthorized'})).status,403);
 assert.equal((await B(base+'/tasks/'+t.id,'PATCH',{revision:0,title:'Not the creator'})).status,403);
 t=(await B(base+'/tasks/'+t.id,'PATCH',{revision:0,status:'doing'})).data;assert.equal(t.status,'doing');assert.equal((await O(base+'/tasks/'+t.id,'PATCH',{revision:0,status:'done'})).status,409);
 t=(await f.call(c,base+'/tasks/'+t.id,'PATCH',{revision:1,comment:'I can help.'})).data;assert.equal(t.comments[0].author,'studio_other');
 await O('/messages/'+message.id,'DELETE');assert.equal((await B(base+'/tasks/'+t.id)).data.source.available,false);
 await f.stop();await f.start();assert.equal((await B(base+'/tasks/'+t.id)).data.comments.length,1);
 await O('/channels/'+channel,'PATCH',{overwrites:[{type:'member',id:b.id,allow:[],deny:['viewChannel']}]});assert.equal((await B(base+'/tasks/'+t.id)).status,404);assert.equal((await B('/state')).data.studio.assignedCount,0);
 assert.equal((await O(base+'/tasks/'+t.id,'DELETE')).status,409);assert.equal((await O(base+'/tasks/'+t.id+'?revision=2','DELETE')).status,200);
 }finally{await f.cleanup();}
});
test('giveaways persist entries, draw unique eligible winners automatically and cannot be redrawn',async()=>{
 const {f,a,b,c,s,channel,base}=await setup();try{
 const O=(p,m,d)=>f.call(a,p,m,d);const role=(await O('/servers/'+s.id+'/roles','POST',{name:'Entrants'})).data;
 for(const u of[b,c])await O('/servers/'+s.id+'/members/'+u.id,'PATCH',{roles:[role.id]});
 const data={channelId:channel,title:'Community celebration',winnerCount:2,requiredRoleId:role.id,endsAt:Date.now()+3000,nonce:randomUUID()};
 let g=(await O(base+'/giveaways','POST',data)).data;assert.equal((await O(base+'/giveaways','POST',data)).status,200);assert.equal((await O(base+'/giveaways','POST',{...data,title:'Different'})).status,409);
 for(const u of[b,c,b])assert.equal((await f.call(u,base+'/giveaways/'+g.id+'/enter','POST',{})).status,200);assert.equal((await O(base+'/giveaways/'+g.id)).data.entryCount,2);
 await O('/servers/'+s.id+'/members/'+c.id,'PATCH',{roles:[]});
 await f.stop();await f.start();g=await until(async()=>{const r=await O(base+'/giveaways/'+g.id);return r.data.status==='ended'&&r.data;},7000);
 assert.equal(g.winners.length,1);assert.equal(g.winners[0].id,b.id);assert.equal((await O(base+'/giveaways/'+g.id+'/end','POST',{revision:g.revision})).status,409);
 assert.equal((await f.call(b,base+'/giveaways/'+g.id+'/enter','POST',{})).status,409);await f.stop();await f.start();assert.deepEqual((await O(base+'/giveaways/'+g.id)).data.winners,g.winners);
 }finally{await f.cleanup();}
});
test('giveaway management and analytics honor roles, overrides, channel privacy and single finalization',async()=>{
 const {f,a,b,s,channel,base}=await setup();try{
 const O=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d);
 assert.equal((await B(base+'/giveaways','POST',{channelId:channel,title:'No access',endsAt:Date.now()+60000})).status,403);assert.equal((await B(base+'/insights')).status,403);
 const role=(await O('/servers/'+s.id+'/roles','POST',{name:'Analysts',permissions:['viewInsights']})).data;await O('/servers/'+s.id+'/members/'+b.id,'PATCH',{roles:[role.id]});
 const secret=(await O('/servers/'+s.id+'/channels','POST',{name:'hidden-plans',type:'text',overwrites:[{type:'role',id:'everyone',allow:[],deny:['viewChannel']}]})).data;
 await O('/channels/'+secret.id,'PATCH',{overwrites:[{type:'role',id:'everyone',allow:[],deny:['viewChannel']}]});assert.equal((await B('/messages?channel='+secret.id)).status,403);
 await O('/messages','POST',{channel,text:'Visible activity'});await O('/messages','POST',{channel:secret.id,text:'Never expose this channel'});
 const insights=(await B(base+'/insights')).data;assert.equal(insights.totals.messages,1);assert.ok(!JSON.stringify(insights).includes('hidden-plans'));assert.equal(insights.daily.length,7);
 let g=(await O(base+'/giveaways','POST',{channelId:channel,title:'One final result',endsAt:Date.now()+60000})).data;
 const results=await Promise.all(['end','cancel'].map(action=>O(base+'/giveaways/'+g.id+'/'+action,'POST',{revision:g.revision})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 }finally{await f.cleanup();}
});
test('delayed community requests lose privileges immediately after membership or role revocation',async()=>{
 const {f,a,b,s,channel,base}=await setup();try{
 const payload=JSON.stringify({channelId:channel,title:'Do not create after removal'});let finish;
 const pending=new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api'+base+'/tasks',{method:'POST',headers:{Cookie:b.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(payload.slice(0,5));finish=()=>req.end(payload.slice(5));});
 await f.call(a,'/servers/'+s.id+'/members/'+b.id,'DELETE',{reason:'Removed during request'});finish();assert.equal(await pending,404);
 }finally{await f.cleanup();}
});
test('bot SDK accesses scoped projects and giveaways while human-only entries remain protected',async()=>{
 const {f,a,s,channel,base}=await setup();try{
 const application=(await f.call(a,'/applications','POST',{name:'Studio assistant'})).data;
 await f.call(a,'/servers/'+s.id+'/bots','POST',{applicationId:application.application.id});
 const bot=new VoxoraBot({url:f.origin,token:application.token});const task=await bot.createProjectTask(s.id,{channelId:channel,title:'A bot-created task'});assert.ok(task.id);assert.equal((await bot.getProjectTasks(s.id)).total,1);
 await assert.rejects(bot.createGiveaway(s.id,{channelId:channel,title:'Not authorized',endsAt:Date.now()+60000}),e=>e.status===403);
 const role=(await f.call(a,'/servers/'+s.id+'/roles','POST',{name:'Giveaway bot',permissions:['manageGiveaways']})).data;await f.call(a,'/servers/'+s.id+'/members/'+application.application.userId,'PATCH',{roles:[role.id]});
 const giveaway=await bot.createGiveaway(s.id,{channelId:channel,title:'Bot celebration',endsAt:Date.now()+60000});assert.ok(giveaway.id);
 await assert.rejects(bot.api('/servers/'+s.id+'/studio/giveaways/'+giveaway.id+'/enter','POST',{}),e=>e.status===403);
 const ended=await bot.endGiveaway(s.id,giveaway.id,giveaway.revision);assert.equal(ended.status,'ended');
 }finally{await f.cleanup();}
});
test('insight totals use the same UTC calendar boundaries as the daily chart',async()=>{
 const {f,a,channel,base}=await setup();try{
  for(const text of['today','old','outside'])await f.call(a,'/messages','POST',{channel,text});await f.stop();const state=JSON.parse(await readFile(f.dir+'/state.json','utf8')),now=new Date(),start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  state.messages.find(m=>m.text==='today').time=start;state.messages.find(m=>m.text==='old').time=start-6*86400000;state.messages.find(m=>m.text==='outside').time=start-7*86400000;await writeFile(f.dir+'/state.json',JSON.stringify(state));await f.start();
  const report=(await f.call(a,base+'/insights')).data;assert.equal(report.totals.messages,2);assert.equal(report.daily.reduce((sum,d)=>sum+d.messages,0),2);
 }finally{await f.cleanup();}
});
test('the shipped Studio bot serves channel-scoped project commands without replacing the default bot template',async()=>{
 const {f,a,s,channel,base}=await setup();let child,exited,output='',errors='';try{
  const app=(await f.call(a,'/applications','POST',{name:'Studio guide'})).data;await f.call(a,'/servers/'+s.id+'/bots','POST',{applicationId:app.application.id});await f.call(a,base+'/tasks','POST',{channelId:channel,title:'A real Studio bot task'});
  child=spawn(process.execPath,['examples/studio-bot.mjs'],{env:{...process.env,VOXORA_URL:f.origin,VOXORA_BOT_TOKEN:app.token},stdio:['ignore','pipe','pipe']});exited=once(child,'exit');child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>errors+=d);await until(()=>output.includes('Studio commands:'),10000);
  const command=await f.call(a,'/commands','POST',{channel,applicationId:app.application.id,name:'projects',args:''});assert.equal(command.status,202);
  await until(async()=>(await f.call(a,'/messages?channel='+channel)).data.some(m=>m.bot&&m.text.includes('A real Studio bot task')),7000);await f.call(a,'/servers/'+s.id+'/care/articles','POST',{nonce:randomUUID(),channelId:channel,title:'A community knowledge guide',summary:'How to join the event',body:'Meet in the lobby.',published:true});await f.call(a,'/servers/'+s.id+'/care/articles','POST',{nonce:randomUUID(),channelId:channel,title:'Unrelated reference',summary:'Hiking notes',body:'Chore list',published:true});const knowledge=await f.call(a,'/commands','POST',{channel,applicationId:app.application.id,name:'knowledge',arguments:'community'});assert.equal(knowledge.status,202);const answer=await until(async()=>(await f.call(a,'/messages?channel='+channel)).data.find(m=>m.bot&&m.text.includes('A community knowledge guide')),7000);assert.ok(!answer.text.includes('Unrelated reference'));assert.equal(errors,'');assert.ok(!output.includes(app.token));
 }finally{if(child?.exitCode===null){child.kill();await exited;}await f.cleanup();}
});
test('a failed winner write stays unpublished and retries keep the same draw',async()=>{
 const {studioService}=await import('../studio.js');const a={id:'a',displayName:'Owner'},b={id:'b',displayName:'Member'},s={id:'s',ownerId:'a',members:['a','b'],memberRoles:{},nicknames:{},auditLog:[],channels:[{id:'c',type:'text'}]},g={id:'g',serverId:'s',channelId:'c',title:'Durable draw',description:'',winnerCount:1,endsAt:Date.now()+60000,status:'active',entryIds:['b'],winnerIds:[],requiredRoleId:null,revision:0,createdAt:Date.now(),endedAt:null};let rejectWrite,pending=true,result,notifications=0;
 const state={servers:[s],users:[a,b],projectTasks:[],giveaways:[g],messages:[],threadMessages:[],threads:[]};
 const service=studioService({state,body:async req=>req.data,json:(res,status,data)=>{result={status,data};},fail:(status,message)=>{throw Object.assign(Error(message),{status});},save:()=>pending?new Promise((resolve,reject)=>{rejectWrite=reject;}):Promise.resolve(),canRead:()=>true,canChannel:()=>true,userById:id=>state.users.find(u=>u.id===id),management:{log:(server,actor,action,target)=>server.auditLog.unshift({id:randomUUID(),action,target})},notify:()=>notifications++});
 const url=new URL('http://localhost/api/servers/s/studio/giveaways/g/end'),ending=service.handle({method:'POST',data:{revision:0}},{},url,a);await until(()=>!!rejectWrite);
 await service.handle({method:'GET'},{},new URL('http://localhost/api/servers/s/studio/giveaways/g'),a);assert.equal(result.data.status,'active');assert.deepEqual(result.data.winners,[]);assert.equal(notifications,0);
 rejectWrite(Error('Disk full'));await assert.rejects(ending,/Disk full/);assert.equal(g.status,'active');const draw=[...g.drawResult.winnerIds];pending=false;
 await service.handle({method:'POST',data:{revision:0}},{},url,a);assert.equal(result.data.status,'ended');assert.deepEqual(g.winnerIds,draw);assert.equal(notifications,1);
});
