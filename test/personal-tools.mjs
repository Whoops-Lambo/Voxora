import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './support/server.mjs';
import {timestampInfo} from '../public/personal-tools-ui.js';
import {shouldNotify} from '../public/activity.js';

async function lab() {
  const f = await fixture(), owner = await f.register('tools_owner'), member = await f.register('tools_member'), other = await f.register('tools_other');
  const O = (p,m,d) => f.call(owner,p,m,d), M = (p,m,d) => f.call(member,p,m,d), X = (p,m,d) => f.call(other,p,m,d);
  const server = (await O('/servers','POST',{name:'Toolbox Lab'})).data, channel = server.channels[0].id;
  await M('/invites/join','POST',{code:server.invite});
  const grant = async(revoke=false) => {const info=(await M('/premium/me')).data;const result=await O('/platform/premium/members/'+member.id,'PATCH',{version:info.version,...(revoke?{revoke:true}:{days:null}),reason:'Toolbox entitlement test'});assert.equal(result.status,200);};
  return {...f,owner,member,other,O,M,X,server,channel,grant};
}

test('message collections are private, preserve revisions, include threads and hide revoked originals',async()=>{
  const f=await lab();try{
    const {O,M,X,channel}=f,original=(await O('/messages','POST',{channel,text:'A collection source'})).data,thread=(await O('/threads','POST',{messageId:original.id,name:'A collected thread'})).data,reply=(await O('/threads/'+thread.id+'/messages','POST',{text:'Thread source'})).data;
    let c=(await M('/me/collections','POST',{name:'Research'})).data;assert.equal(c.revision,0);
    assert.equal((await M('/me/collections/'+c.id,'DELETE')).status,409);
    assert.equal((await X('/me/collections/'+c.id)).status,404);
    let response=await M('/me/collections/'+c.id+'/messages','POST',{revision:0,kind:'message',id:original.id});assert.equal(response.status,201);c=response.data;
    assert.equal((await M('/me/collections/'+c.id+'/messages','POST',{revision:0,kind:'thread',id:reply.id})).status,409);
    c=(await M('/me/collections/'+c.id+'/messages','POST',{revision:c.revision,kind:'thread',id:reply.id})).data;assert.equal(c.entries.length,2);
    assert.equal((await M('/me/collections/'+c.id+'/export')).status,403);await f.grant();const exported=await M('/me/collections/'+c.id+'/export');assert.equal(exported.status,200);assert.match(exported.data.markdown,/Thread source/);
    await f.stop();await f.start();assert.equal((await M('/me/collections/'+c.id)).data.entries.length,2);
    await O('/channels/'+channel,'PATCH',{overwrites:[{type:'role',id:'everyone',allow:[],deny:['viewChannel']}]});const hidden=(await M('/me/collections/'+c.id)).data;assert.equal(hidden.entries.length,0);assert.equal(hidden.unavailable,2);assert.doesNotMatch(JSON.stringify(hidden),/A collection source|Thread source/);
  }finally{await f.cleanup();}
});

test('quick replies gate dynamic variables on creation and insertion and survive plan changes',async()=>{
  const f=await lab();try{
    const {M,X,channel}=f,item=(await M('/me/snippets','POST',{name:'Hello',content:'Welcome to Voxora.'})).data;
    assert.equal((await M('/me/snippets/'+item.id+'/expand','POST',{channel})).data.text,'Welcome to Voxora.');assert.equal((await X('/me/snippets/'+item.id+'/expand','POST',{channel})).status,404);
    assert.equal((await M('/me/snippets','POST',{name:'Dynamic',content:'Hello {{username}} from {{channel}} on {{date}} at {{time}}'})).status,403);
    await f.grant();const dynamic=(await M('/me/snippets','POST',{name:'Dynamic',content:'Hello {{username}} from {{channel}} on {{date}} at {{time}}'})).data;
    const expanded=await M('/me/snippets/'+dynamic.id+'/expand','POST',{channel});assert.equal(expanded.status,200);assert.match(expanded.data.text,/tools_member/);assert.doesNotMatch(expanded.data.text,/\{\{/);
    await f.grant(true);assert.equal((await M('/me/snippets/'+dynamic.id+'/expand','POST',{channel})).status,403);assert.equal((await M('/me/snippets')).data.items.length,2);assert.equal((await M('/me/snippets/'+dynamic.id+'?revision='+dynamic.revision,'DELETE')).status,200);
  }finally{await f.cleanup();}
});

test('conversation libraries paginate media, files, voice and links while enforcing blocks and channel access',async()=>{
  const f=await lab();try{
    const {O,M,X,owner,channel}=f,upload=await fetch(f.origin+'/api/files?channel='+channel,{method:'POST',headers:{Cookie:owner.cookie,'Content-Type':'text/plain','X-File-Name':'release.txt'},body:'A shared file'}),file=await upload.json();assert.equal(upload.status,201);
    const parent=(await O('/messages','POST',{channel,text:'Reference https://example.com/guide and https://user:pass@example.com/private',files:[file.id]})).data;
    const thread=(await O('/threads','POST',{messageId:parent.id,name:'Links in threads'})).data;await O('/threads/'+thread.id+'/messages','POST',{text:'See https://example.com/thread'});
    assert.equal((await M('/channels/'+channel+'/library?kind=files')).data.items[0].file.name,'release.txt');const links=(await M('/channels/'+channel+'/library?kind=links')).data;assert.equal(links.total,2);assert.ok(links.items.some(i=>i.threadId===thread.id));assert.ok(links.items.every(item=>!new URL(item.url).username));
    assert.equal((await X('/channels/'+channel+'/library?kind=files')).status,404);assert.equal((await M('/channels/'+channel+'/library?kind=unknown')).status,400);
    await M('/blocks/'+owner.id,'POST',{});assert.equal((await M('/channels/'+channel+'/library?kind=files')).data.total,0);
  }finally{await f.cleanup();}
});

test('aliases and private user notes sync without changing public names or leaking notes to another account',async()=>{
  const f=await lab();try{
    const {O,M,X,channel,owner,member}=f,tools=(await M('/me/toolbox')).data;
    assert.equal((await M('/me/channel-tools/'+channel,'PATCH',{revision:tools.revision,alias:'My planning room'})).status,200);assert.equal((await O('/me/toolbox')).data.aliases[channel],undefined);
    assert.equal((await M('/me/user-notes/'+owner.id,'PATCH',{revision:0,text:'Private meeting details'})).status,200);assert.equal((await O('/me/user-notes/'+owner.id)).data.text,'');assert.equal((await X('/me/user-notes/'+owner.id)).data.text,'');assert.equal((await M('/me/user-notes/'+owner.id,'PATCH',{revision:0,text:'Stale edit'})).status,409);
    assert.doesNotMatch(JSON.stringify((await O('/state')).data),/Private meeting details|My planning room/);
    await f.stop();await f.start();assert.equal((await M('/me/toolbox')).data.aliases[channel],'My planning room');assert.equal((await M('/me/user-notes/'+owner.id)).data.text,'Private meeting details');
    assert.equal((await M('/me/user-notes/'+f.other.id,'PATCH',{revision:0,text:'Not known'})).status,200); // The default community makes these users known.
  }finally{await f.cleanup();}
});

test('time zones validate and expiring status hides itself after expiry without changing online status',async()=>{
  const f=await lab();try{
    const {M}=f;assert.equal((await M('/profile','PATCH',{timeZone:'Not/A_Zone'})).status,400);assert.equal((await M('/profile','PATCH',{customStatusExpiresAt:Date.now()-1})).status,400);
    const response=await M('/profile','PATCH',{timeZone:'America/Indianapolis',customStatus:'Back shortly',customStatusExpiresAt:Date.now()+250});assert.equal(response.status,200);assert.equal(response.data.timeZone,'America/Indianapolis');
    await new Promise(resolve=>setTimeout(resolve,300));const user=(await M('/state')).data.me;assert.equal(user.customStatus,'');assert.notEqual(user.status,'dnd');
  }finally{await f.cleanup();}
});

test('session management exposes no authentication hashes and revokes exactly the chosen device',async()=>{
  const f=await lab();try{
    const {M,member}=f,second=await f.call(null,'/auth/login','POST',{username:'tools_member',password:'Fixture-password-987'});assert.equal(second.status,200);
    const sessions=(await M('/me/sessions')).data;assert.equal(sessions.items.length,2);assert.doesNotMatch(JSON.stringify(sessions),/hash|voxora_session|Fixture-password/);const foreign=sessions.items.find(s=>!s.current),current=sessions.items.find(s=>s.current);
    assert.equal((await M('/me/sessions/'+current.id,'DELETE')).status,400);assert.equal((await f.X('/me/sessions/'+foreign.id,'DELETE')).status,404);assert.equal((await M('/me/sessions/'+foreign.id,'DELETE')).status,200);
    assert.equal((await f.call({cookie:second.cookie},'/state')).status,401);assert.equal((await M('/state')).status,200);
    await f.call(null,'/auth/login','POST',{username:'tools_member',password:'Fixture-password-987'});assert.equal((await M('/me/sessions/revoke-others','POST',{})).data.revoked,1);assert.equal((await M('/me/sessions')).data.items.length,1);
  }finally{await f.cleanup();}
});

test('focus sessions suppress notifications and recurring reminders advance without creating duplicate jobs',async()=>{
  const f=await lab();try{
    const {M}=f;assert.equal((await M('/me/focus','POST',{minutes:25})).status,200);let state=(await M('/state')).data;assert.ok(state.me.focusUntil>Date.now());assert.equal(state.activity.doNotDisturb,true);assert.equal(shouldNotify({authorId:'another'},state.me,{mode:'all',muted:false}),false);
    await M('/me/focus','POST',{minutes:0});state=(await M('/state')).data;assert.equal(state.activity.doNotDisturb,false);assert.equal(shouldNotify({authorId:'another'},state.me,{mode:'all',muted:false}),true);
    const reminder=(await M('/me/reminders','POST',{title:'Daily review',dueAt:Date.now()+10000,recurrence:'daily'})).data;assert.equal(reminder.recurrence,'daily');const next=await M('/me/reminders/'+reminder.id,'PATCH',{revision:reminder.revision,completed:true});assert.equal(next.status,200);assert.equal(next.data.completedAt,null);assert.equal(next.data.dueAt,reminder.dueAt+86400000);assert.ok(next.data.lastCompletedAt);assert.equal((await M('/me/reminders?status=all')).data.total,1);
    assert.equal((await M('/me/reminders','POST',{title:'Bad repeat',dueAt:Date.now()+10000,recurrence:'forever'})).status,400);
  }finally{await f.cleanup();}
});

test('server resources require Manage Channels and channel-limited resources do not leak to other members',async()=>{
  const f=await lab();try{
    const {O,M,X,server}=f,hidden=(await O('/servers/'+server.id+'/channels','POST',{name:'private-reference',type:'text',private:true})).data;
    assert.equal((await M('/servers/'+server.id+'/resources','POST',{title:'No permission',url:'https://example.com'})).status,403);
    assert.equal((await O('/servers/'+server.id+'/resources','POST',{title:'Bad link',url:'javascript:alert(1)'})).status,400);
    const shared=await O('/servers/'+server.id+'/resources','POST',{title:'Guide',url:'https://example.com/guide',description:'Public resource'});assert.equal(shared.status,201);
    await O('/servers/'+server.id+'/resources','POST',{title:'Secret Guide',url:'https://example.com/secret',channelId:hidden.id});const list=(await M('/servers/'+server.id+'/resources')).data;assert.equal(list.items.length,1);assert.doesNotMatch(JSON.stringify(list),/Secret Guide|example.com\/secret/);assert.equal((await X('/servers/'+server.id+'/resources')).status,404);
    assert.equal((await O('/servers/'+server.id+'/resources/'+shared.data.id,'DELETE')).status,409);assert.equal((await O('/servers/'+server.id+'/resources/'+shared.data.id+'?revision=0','DELETE')).status,200);
  }finally{await f.cleanup();}
});

test('all Plus tools enforce entitlement server-side, preserve own content and fall back after revocation',async()=>{
  const f=await lab();try{
    const {M,O,channel}=f,theme={start:'#122332',end:'#123b35'},style={bannerStart:'#224466',bannerEnd:'#335577',accent:'#55e6bc',showBadge:true};
    let tools=(await M('/me/toolbox')).data;
    for(const [path,data]of [['/me/channel-tools/'+channel,{revision:tools.revision,theme}],['/me/toolbox',{revision:tools.revision,sound:'bell'}],['/me/cloud-drafts/'+channel,{revision:0,text:'Cloud text'}]])assert.equal((await M(path,'PATCH',data)).status,403,path);
    for(const [path,data]of [['/me/saved-searches',{name:'Voice',query:'has:voice'}],['/me/profile-presets',{name:'Mint',style}]])assert.equal((await M(path,'POST',data)).status,403,path);
    await f.grant();assert.equal((await M('/me/channel-tools/'+channel,'PATCH',{revision:tools.revision,theme})).status,200);tools=(await M('/me/toolbox')).data;assert.equal((await M('/me/toolbox','PATCH',{revision:tools.revision,sound:'orbit'})).status,200);
    const draft=(await M('/me/cloud-drafts/'+channel,'PATCH',{revision:0,text:'Cloud text'})).data;assert.equal((await M('/me/cloud-drafts/'+channel,'PATCH',{revision:0,text:'Stale text'})).status,409);
    const search=(await M('/me/saved-searches','POST',{name:'Voice',query:'has:voice'})).data;assert.equal((await M('/me/saved-searches/'+search.id+'/run','POST',{})).data.query,'has:voice');assert.equal((await M('/me/saved-searches','POST',{name:'Bad dates',query:'after:2026-02-30'})).status,400);
    const preset=(await M('/me/profile-presets','POST',{name:'Mint',style})).data;assert.equal((await M('/me/profile-presets/'+preset.id+'/apply','POST',{revision:0})).status,200);assert.equal((await M('/premium/me')).data.profile.accent,'#55e6bc');assert.equal((await O('/me/cloud-drafts')).data.items.length,0);
    await f.grant(true);tools=(await M('/me/toolbox')).data;assert.deepEqual(tools.themes,{});assert.equal(tools.sound,'classic');assert.equal((await M('/me/saved-searches/'+search.id+'/run','POST',{})).status,403);assert.equal((await M('/me/profile-presets/'+preset.id+'/apply','POST',{revision:0})).status,403);assert.equal((await M('/me/cloud-drafts/'+channel)).data.text,'Cloud text');assert.equal((await M('/me/cloud-drafts/'+channel,'PATCH',{revision:draft.revision,text:'Free overwrite'})).status,403);
    assert.equal((await M('/me/cloud-drafts/'+channel+'?revision='+draft.revision,'DELETE')).status,200);
  }finally{await f.cleanup();}
});

test('Plus voice recordings allow five minutes and cannot be newly posted after access ends',async()=>{
  const f=await lab();try{
    const {M,member,channel}=f,audio=Buffer.concat([Buffer.from([26,69,223,163]),Buffer.alloc(44)]),upload=async duration=>{const r=await fetch(f.origin+'/api/voice-notes?channel='+channel,{method:'POST',headers:{Cookie:member.cookie,'Content-Type':'audio/webm','X-Voice-Duration':String(duration)},body:audio});return{status:r.status,data:await r.json()};};
    assert.equal((await upload(180000)).status,400);await f.grant();assert.equal((await upload(300001)).status,400);const clip=await upload(180000);assert.equal(clip.status,201);await f.grant(true);assert.equal((await M('/messages','POST',{channel,files:[clip.data.id]})).status,403);assert.equal((await M('/premium/me')).data.perks.voiceDurationMs,120000);
  }finally{await f.cleanup();}
});

test('localized timestamp tokens handle formats and reject malformed or impossible dates',()=>{
  const now=Date.UTC(2026,10,10,12,0);assert.match(timestampInfo('<t:'+Math.floor((now+3600000)/1000)+':R>',now).display,/hour/);
  for(const format of ['t','T','d','D','f','F'])assert.ok(timestampInfo('<t:'+now/1000+':'+format+'>',now).display);
  for(const token of ['<t:999999999999:F>','<t:-1:R>','<t:1:Z>','<img src=x>'])assert.equal(timestampInfo(token),null);
});
