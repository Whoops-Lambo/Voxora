import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fixture, until } from './support/server.mjs';

async function lab() {
  const f = await fixture(), owner = await f.register('safety_owner'), member = await f.register('safety_member'), reviewer = await f.register('safety_reviewer'), outsider = await f.register('safety_outside');
  const O=(p,m,d)=>f.call(owner,p,m,d), M=(p,m,d)=>f.call(member,p,m,d), R=(p,m,d)=>f.call(reviewer,p,m,d);
  const s=(await O('/servers','POST',{name:'Safety Lab'})).data, base='/servers/'+s.id, channel=s.channels[0].id;
  for(const u of [member,reviewer])assert.equal((await f.call(u,'/invites/join','POST',{code:s.invite})).status,200);
  const role=(await O(base+'/roles','POST',{name:'Reviewers',permissions:['manageReports']})).data;
  await O(base+'/members/'+reviewer.id,'PATCH',{roles:[role.id]});
  const rule=async d=>{const r=await O(base+'/automod/rules','POST',d);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const post=async(text,who=member,extra={})=>f.call(who,'/messages','POST',{channel,text,...extra});
  const cases=async(who=owner,query='')=>(await f.call(who,base+'/moderation/cases?status=all'+query)).data;
  return {f,owner,member,reviewer,outsider,O,M,R,s,base,channel,role,rule,post,cases};
}

test('AutoMod filters Unicode phrases, literal boundaries, domains, mentions, edits, polls and threads; previews do not mutate private state',async()=>{
  const x=await lab(),{f,O,M,R,base,channel,member,reviewer,owner}=x;
  try {
    assert.equal((await M(base+'/automod')).status,403);assert.equal((await R(base+'/automod')).status,403);
    await x.rule({name:'Words',kind:'keywords',terms:['bad phrase','a+b'],action:'block'});
    await x.rule({name:'Links',kind:'domains',domains:['evil.example'],action:'block'});
    await x.rule({name:'Mentions',kind:'mentions',limit:1,action:'flag'});
    assert.equal((await x.post('bad phrase with AutoMod off')).status,201);
    const before=await readFile(f.dir+'/state.json','utf8');
    const preview=await O(base+'/automod/test','POST',{channel,text:'ＢＡＤ\u200b　ＰＨＲＡＳＥ'});assert.equal(preview.data.blocked,true);assert.equal(await readFile(f.dir+'/state.json','utf8'),before);
    await O(base+'/automod','PATCH',{enabled:true});
    for(const text of ['ＢＡＤ\u200b　ＰＨＲＡＳＥ','a+b','https://sub.evil.example/path'])assert.equal((await x.post(text)).status,422,text);
    for(const text of ['bad phrases','xa+by','https://not-evil.example/path','https://evil.example.safe.test/path'])assert.equal((await x.post(text)).status,201,text);
    assert.equal((await x.post('bad phrase',owner)).status,201);
    const good=(await x.post('Original safe text')).data;assert.equal((await M('/messages/'+good.id,'PATCH',{text:'bad phrase'})).status,422);
    assert.equal((await M('/messages?channel='+channel)).data.find(m=>m.id===good.id).text,'Original safe text');
    assert.equal((await M('/messages','POST',{channel,poll:{question:'Choose',answers:['safe','bad phrase']}})).status,422);
    const parent=(await x.post('Thread parent',owner)).data,thread=(await O('/threads','POST',{messageId:parent.id,name:'Discussion'})).data;
    assert.equal((await M('/threads/'+thread.id+'/messages','POST',{text:'bad phrase'})).status,422);
    const reply=(await M('/threads/'+thread.id+'/messages','POST',{text:'Safe reply'})).data;
    assert.equal((await M('/thread-messages/'+reply.id,'PATCH',{text:'bad phrase'})).status,422);
    await x.post('@safety_owner @safety_reviewer');
    const all=await x.cases();assert.ok(all.items.some(c=>c.action==='flag'));assert.ok(all.items.some(c=>c.threadId===thread.id));
    const words=all.items.find(c=>c.action==='block'&&!c.threadId&&c.operation==='create'&&c.rules.some(r=>r.name==='Words'));
    assert.ok(words.attempts>=2);assert.equal(words.snapshot.text,'ＢＡＤ\u200b　ＰＨＲＡＳＥ');assert.equal(words.version,1);
    // Ongoing attempts cannot move a reviewed action target or make staff versions stale.
    const claimed=await O(base+'/moderation/cases/'+words.id,'PATCH',{version:words.version,claim:true});assert.equal(claimed.status,200);
    await x.post('bad phrase once more');assert.equal((await O(base+'/moderation/cases/'+words.id,'PATCH',{version:claimed.data.version,status:'resolved',resolution:'Reviewed the repeated attempts'})).status,200);
    const boot=(await M('/state')).data;assert.ok(!JSON.stringify(boot).includes('snapshot'));assert.ok(!JSON.stringify(boot).includes('moderation'));assert.ok(!JSON.stringify(boot).includes('bad phrase once more'));
    assert.equal((await x.cases()).items.filter(c=>c.status==='resolved').length,1);
    const bypass=(await O(base+'/roles','POST',{name:'Trusted',permissions:[]})).data;
    const rule=(await O(base+'/automod')).data.rules.find(r=>r.name==='Words');await O(base+'/automod/rules/'+rule.id,'PATCH',{exemptRoleIds:[bypass.id]});await O(base+'/members/'+member.id,'PATCH',{roles:[bypass.id]});assert.equal((await x.post('bad phrase')).status,201);
    await O(base+'/bots','POST',{applicationId:'voxora-helper'});assert.equal((await M('/commands','POST',{channel,name:'poll',arguments:'bad phrase | yes | no'})).status,201,'bot-authored output is exempt');
  }finally{await f.cleanup();}
});

test('message flood and duplicate limits are atomic across threads and survive deletion and restart without counting edits or blocked attempts',async()=>{
  const x=await lab(),{f,O,M,base,channel}=x;
  try {
    const parent=(await x.post('Discuss',x.owner)).data, thread=(await O('/threads','POST',{messageId:parent.id,name:'Flood test'})).data;
    const flood=await x.rule({name:'Flood',kind:'spam',limit:2,windowSeconds:300,action:'block'});await O(base+'/automod','PATCH',{enabled:true});
    const sent=await Promise.all([x.post('One'),M('/threads/'+thread.id+'/messages','POST',{text:'Two'}),x.post('Three'),x.post('Four')]);assert.equal(sent.filter(r=>r.status===201).length,2);assert.equal(sent.filter(r=>r.status===422).length,2);
    const message=(await M('/messages?channel='+channel)).data.find(m=>m.authorId===x.member.id);
    assert.equal((await M('/messages/'+message.id,'PATCH',{text:'Edited without increasing frequency'})).status,200);
    await M('/messages/'+message.id,'DELETE');await f.stop();await f.start();assert.equal((await x.post('Still too fast')).status,422);
    await O(base+'/automod/rules/'+flood.id,'PATCH',{enabled:false});
    await x.rule({name:'Duplicates',kind:'duplicates',limit:1,windowSeconds:300,action:'block'});
    assert.equal((await x.post('Repeat only once')).status,201);assert.equal((await M('/threads/'+thread.id+'/messages','POST',{text:'ＲＥＰＥＡＴ ONLY ONCE'})).status,422);
    assert.equal((await x.post('Different content')).status,201);
    const room=(await O(base+'/channels','POST',{name:'off-topic',type:'text'})).data;assert.equal((await M('/messages','POST',{channel:room.id,text:'Repeat only once'})).status,201);
    const duplicate=(await O(base+'/automod')).data.rules.find(r=>r.kind==='duplicates');await O(base+'/automod/rules/'+duplicate.id,'PATCH',{exemptChannelIds:[channel]});assert.equal((await x.post('Repeat only once')).status,201);
    await O(base+'/automod','PATCH',{enabled:false});await O(base+'/automod','PATCH',{enabled:true});assert.equal((await M('/messages','POST',{channel:room.id,text:'Repeat only once'})).status,201,'pausing clears the frequency window');
  }finally{await f.cleanup();}
});

test('member reports have private receipts, bounded deduplicated submission and stable evidence; staff claims and notes use optimistic concurrency',async()=>{
  const x=await lab(),{f,O,M,R,base,channel}=x;
  try {
    const m=(await x.post('Report evidence',x.owner)).data;
    assert.equal((await O(base+'/reports','POST',{messageId:m.id,reason:'Spam'})).status,400);
    assert.equal((await f.call(x.outsider,base+'/reports','POST',{messageId:m.id,reason:'Spam'})).status,404);
    const report=await M(base+'/reports','POST',{messageId:m.id,reason:'Harassment',details:'Please review this'});assert.equal(report.status,201);
    const second=await R(base+'/reports','POST',{messageId:m.id,reason:'Other',details:'Second reporter'});assert.equal(second.data.id,report.data.id);
    assert.equal((await M(base+'/reports','POST',{messageId:m.id,reason:'Spam'})).status,200);
    assert.equal((await M(base+'/moderation/cases')).status,403);
    let c=(await R(base+'/moderation/cases/'+report.data.id)).data;assert.equal(c.reporters.length,2);
    const oldVersion=c.version; c=(await R(base+'/moderation/cases/'+c.id,'PATCH',{version:c.version,claim:true})).data;assert.equal(c.status,'reviewing');
    assert.equal((await O(base+'/moderation/cases/'+c.id,'PATCH',{version:oldVersion,note:'Stale'})).status,409);
    c=(await R(base+'/moderation/cases/'+c.id,'PATCH',{version:c.version,note:'PRIVATE INVESTIGATION NOTE'})).data;
    let receipt=(await M(base+'/reports/mine')).data;assert.equal(receipt.items.length,1);assert.ok(!JSON.stringify(receipt).includes('PRIVATE INVESTIGATION'));assert.ok(!JSON.stringify(receipt).includes('Second reporter'));assert.ok(!JSON.stringify(receipt).includes('snapshot'));
    await O('/messages/'+m.id,'PATCH',{text:'Edited after reporting'});assert.equal((await R(base+'/moderation/cases/'+c.id)).data.snapshot.text,'Report evidence');
    await O('/messages/'+m.id,'DELETE');assert.equal((await R(base+'/moderation/cases/'+c.id)).data.canOpen,false);
    assert.equal((await R(base+'/moderation/cases/'+c.id,'PATCH',{version:c.version,status:'resolved',resolution:'Handled privately'})).status,200);
    receipt=(await M(base+'/reports/mine')).data;assert.equal(receipt.items[0].status,'resolved');assert.equal(receipt.items[0].sourceAvailable,false);
    for(let i=0;i<4;i++){const message=(await x.post('Report '+i,x.owner)).data;assert.equal((await M(base+'/reports','POST',{messageId:message.id,reason:'Spam'})).status,201);}
    const sixth=(await x.post('Sixth report',x.owner)).data;assert.equal((await M(base+'/reports','POST',{messageId:sixth.id,reason:'Spam'})).status,429);
    await f.stop();await f.start();assert.equal((await M(base+'/reports/mine')).data.items.length,5);assert.equal((await M(base+'/reports','POST',{messageId:sixth.id,reason:'Spam'})).status,429);
    const other=(await O('/servers','POST',{name:'Other server'})).data;assert.equal((await O('/servers/'+other.id+'/reports','POST',{messageId:sixth.id,reason:'Spam'})).status,404);
  }finally{await f.cleanup();}
});

test('case actions enforce separate permissions and hierarchy, delete attached threads, apply durable timeouts, kicks and bans and filter activity',async()=>{
  const x=await lab(),{f,O,M,R,base,channel}=x;
  try {
    const report=async message=>(await R(base+'/reports','POST',{messageId:message.id,reason:'Spam'})).data;
    const m=(await x.post('Remove this source')).data,t=(await O('/threads','POST',{messageId:m.id,name:'Attached'})).data;await M('/threads/'+t.id+'/messages','POST',{text:'Attached reply'});
    let c=await report(m);c=(await R(base+'/moderation/cases/'+c.id)).data;assert.deepEqual(c.availableActions,[]);
    assert.equal((await R(base+'/moderation/cases/'+c.id+'/action','POST',{version:c.version,action:'remove-message',reason:'No permission'})).status,403);
    c=(await O(base+'/moderation/cases/'+c.id)).data;assert.ok(c.availableActions.includes('remove-message'));assert.equal((await O(base+'/moderation/cases/'+c.id+'/action','POST',{version:c.version,action:'remove-message',reason:'Removed spam and replies'})).status,200);assert.equal((await M('/threads/'+t.id)).status,404);
    const timeoutMessage=(await x.post('Timeout case')).data;let timed=await report(timeoutMessage);timed=(await O(base+'/moderation/cases/'+timed.id)).data;
    assert.equal((await O(base+'/moderation/cases/'+timed.id+'/action','POST',{version:timed.version,action:'timeout',durationSeconds:60,reason:'Cool down'})).status,200);assert.equal((await x.post('Cannot post now')).status,403);
    await f.stop();await f.start();assert.equal((await x.post('Still timed out')).status,403);await O(base+'/members/'+x.member.id,'PATCH',{timeoutUntil:0});
    const ownerMessage=(await x.post('Protected owner',x.owner)).data;let protectedCase=await report(ownerMessage);
    await O(base+'/roles/'+x.role.id,'PATCH',{permissions:['manageReports','moderateMembers','kickMembers','banMembers']});protectedCase=(await R(base+'/moderation/cases/'+protectedCase.id)).data;assert.deepEqual(protectedCase.availableActions,[]);
    for(const action of ['kick','ban']){const msg=(await x.post(action+' case')).data;let incident=await report(msg);incident=(await R(base+'/moderation/cases/'+incident.id)).data;assert.ok(incident.availableActions.includes(action));assert.equal((await R(base+'/moderation/cases/'+incident.id+'/action','POST',{version:incident.version,action,reason:'Staff action'})).status,200);assert.equal((await x.post('Removed')).status,403);const join=await M('/invites/join','POST',{code:x.s.invite});assert.equal(join.status,action==='ban'?403:200);}
    const stats=(await O(base+'/moderation/stats')).data;assert.equal(stats.daily.length,7);assert.equal(stats.reports,5);assert.equal(stats.daily.reduce((n,d)=>n+d.cases,0),5);assert.ok(stats.messages>=4);assert.equal(stats.open,1);
  }finally{await f.cleanup();}
});

test('private evidence, search, stats and mutations recheck channel access and revoked permissions after delayed bodies',async()=>{
  const x=await lab(),{f,O,M,R,base,channel}=x;
  try {
    const room=(await O(base+'/channels','POST',{name:'hidden-staff',type:'text',private:true})).data;
    await O('/channels/'+room.id,'PATCH',{overwrites:[{type:'role',id:'everyone',deny:['viewChannel'],allow:[]},{type:'member',id:x.reviewer.id,allow:['viewChannel'],deny:[]}]});
    const secret=(await O('/messages','POST',{channel:room.id,text:'SENSITIVE hidden evidence'})).data;
    const report=(await R(base+'/reports','POST',{messageId:secret.id,reason:'Other'})).data;
    assert.equal((await x.cases(x.member)).items,undefined);assert.equal((await M(base+'/reports','POST',{messageId:secret.id,reason:'Spam'})).status,404);
    const visible=(await x.post('Visible report',x.owner)).data;await R(base+'/reports','POST',{messageId:visible.id,reason:'Other'});
    assert.equal((await R(base+'/moderation/stats')).data.reports,2);
    await O('/channels/'+room.id,'PATCH',{overwrites:[{type:'role',id:'everyone',deny:['viewChannel'],allow:[]}]});
    assert.equal((await R(base+'/moderation/cases/'+report.id)).status,404);assert.equal((await R(base+'/moderation/cases?status=all&q=SENSITIVE')).data.total,0);assert.equal((await R(base+'/moderation/stats')).data.reports,1);assert.equal((await R(base+'/reports/mine')).data.items.length,1);
    const publicCase=(await x.cases(x.reviewer)).items[0];let finish;
    const payload=JSON.stringify({version:publicCase.version,note:'DELAYED unauthorized note'});
    const response=new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api'+base+'/moderation/cases/'+publicCase.id,{method:'PATCH',headers:{Cookie:x.reviewer.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(payload.slice(0,4));finish=()=>req.end(payload.slice(4));});
    await O(base+'/members/'+x.reviewer.id,'PATCH',{roles:[]});finish();assert.equal(await response,403);assert.ok(!(await O(base+'/moderation/cases/'+publicCase.id)).data.history.some(h=>h.text.includes('DELAYED')));
    await O(base+'/members/'+x.reviewer.id,'PATCH',{roles:[x.role.id]});await O(base+'/roles/'+x.role.id,'PATCH',{permissions:['manageReports','manageAutoMod']});
    const filter=await x.rule({name:'Hidden exemption',kind:'keywords',terms:['blocked'],exemptChannelIds:[room.id]});const config=(await R(base+'/automod')).data;assert.deepEqual(config.rules[0].exemptChannelIds,[]);assert.ok(!JSON.stringify(config).includes(room.id));
    await R(base+'/automod/rules/'+filter.id,'PATCH',{name:'Still hidden',exemptChannelIds:[]});assert.deepEqual((await O(base+'/automod')).data.rules[0].exemptChannelIds,[room.id]);
    await O('/channels/'+room.id,'DELETE');assert.ok(!(await x.cases()).items.some(c=>c.id===report.id));
    assert.ok(!JSON.stringify((await M('/state')).data).includes('SENSITIVE'));assert.equal((await f.call(x.outsider,base+'/moderation/stats')).status,404);
  }finally{await f.cleanup();}
});

test('queue capacity preserves open cases, evicts closed evidence only when allocating, and keeps blocking when full',async()=>{
  const x=await lab(),{f,O,M,base}=x;
  try{
    await x.rule({name:'Capacity filter',kind:'keywords',terms:['blocked'],action:'block'});await O(base+'/automod','PATCH',{enabled:true});
    const m=(await x.post('Seed evidence',x.owner)).data;await M(base+'/reports','POST',{messageId:m.id,reason:'Other'});
    await f.stop();const stored=JSON.parse(await readFile(f.dir+'/state.json','utf8')),s=stored.servers.find(s=>s.id===x.s.id),sample=s.moderation.cases[0];
    s.moderation.cases=Array.from({length:500},(_,i)=>({...structuredClone(sample),id:'capacity-'+i,number:'CAP'+i,kind:'automod',action:'flag',status:i===0?'resolved':'open',reporters:[],createdAt:i,updatedAt:i,version:1,signature:'seed',lastTriggeredAt:0}));await writeFile(f.dir+'/state.json',JSON.stringify(stored));await f.start();
    assert.equal((await x.post('Ordinary traffic')).status,201);let cases=(await O(base+'/moderation/cases?status=all&q=CAP0')).data;assert.equal(cases.total,1,'ordinary traffic must not evict closed evidence');
    assert.equal((await x.post('blocked first')).status,422);assert.equal((await O(base+'/moderation/cases?status=all')).data.total,500);assert.equal((await O(base+'/moderation/cases/capacity-0')).status,404);
    assert.equal((await x.post('blocked second',x.reviewer)).status,422);assert.equal((await O(base+'/moderation/stats')).data.droppedEvents,1);assert.equal((await x.R(base+'/moderation/stats')).data.droppedEvents,null);
    assert.equal((await M(base+'/reports','POST',{messageId:m.id,reason:'Other'})).status,429);
    assert.equal((await O(base+'/moderation/cases/capacity-1','PATCH',{version:1,status:'dismissed',resolution:'Free an old closed slot'})).status,200);
    assert.equal((await M(base+'/reports','POST',{messageId:m.id,reason:'Other'})).status,201);assert.equal((await O(base+'/moderation/cases?status=all')).data.total,500);assert.equal((await O(base+'/moderation/cases/capacity-1')).status,404);
  }finally{await f.cleanup();}
});

test('moderation SSE updates disclose no hidden-channel activity and reach reviewers only after current access is granted',async()=>{
  const x=await lab(),{f,O,M,base}=x;const controller=new AbortController();let task;
  try{
    const room=(await O(base+'/channels','POST',{name:'private-report-room',type:'text',private:true})).data;
    await O('/channels/'+room.id,'PATCH',{overwrites:[{type:'role',id:'everyone',allow:[],deny:['viewChannel']},{type:'member',id:x.member.id,allow:['viewChannel'],deny:[]}]});
    await x.rule({name:'Private filter',kind:'keywords',terms:['flagged'],action:'flag'});await O(base+'/automod','PATCH',{enabled:true});
    const response=await fetch(f.origin+'/api/events?client=safety-event-privacy',{headers:{Cookie:x.reviewer.cookie},signal:controller.signal}),reader=response.body.getReader(),events=[];const decoder=new TextDecoder();
    task=(async()=>{let buffer='';while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,i);buffer=buffer.slice(i+2);for(const line of frame.split('\n'))if(line.startsWith('data: '))events.push(JSON.parse(line.slice(6)));}}})().catch(e=>{if(!controller.signal.aborted)throw e;});
    await until(()=>events.some(e=>e.type==='connected'));
    assert.equal((await M('/messages','POST',{channel:room.id,text:'flagged SECRET MESSAGE'})).status,201);
    // A readable-channel event is a transport barrier: earlier frames have already arrived.
    await x.post('Public barrier');await until(()=>events.some(e=>e.type==='message'&&e.message.text==='Public barrier'));
    assert.equal(events.filter(e=>e.type==='moderation-update').length,0);assert.ok(!JSON.stringify(events).includes('SECRET MESSAGE'));
    await O('/channels/'+room.id,'PATCH',{overwrites:[{type:'role',id:'everyone',allow:[],deny:['viewChannel']},{type:'member',id:x.member.id,allow:['viewChannel'],deny:[]},{type:'member',id:x.reviewer.id,allow:['viewChannel'],deny:[]}]});
    await M('/messages','POST',{channel:room.id,text:'flagged now visible'});await until(()=>events.some(e=>e.type==='moderation-update'));assert.deepEqual(events.find(e=>e.type==='moderation-update'),{type:'moderation-update',serverId:x.s.id});
  }finally{controller.abort();await task;await f.cleanup();}
});
