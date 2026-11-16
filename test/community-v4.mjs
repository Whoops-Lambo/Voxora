import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fixture} from './support/server.mjs';
import {premiumPerks,initializePremiumUser,boostSummary} from '../premium.js';
import {VoxoraBot} from '../sdk/voxora.mjs';
const palette={background:'#102030',panel:'#203040',text:'#eeeeee',accent:'#00bb99'};
const ok=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.data;};
async function grant(f,o,u,plan){const info=ok(await f.call(u,'/premium/me'));return ok(await f.call(o,'/platform/premium/members/'+u.id,'PATCH',{version:info.version,days:null,plan,reason:'V4 entitlement fixture'}));}
async function lab(){const f=await fixture(),o=await f.register('v4_owner'),u=await f.register('v4_member'),x=await f.register('v4_outsider'),O=(...a)=>f.call(o,...a),U=(...a)=>f.call(u,...a),s=ok(await O('/servers','POST',{name:'V4 Lab'}));ok(await U('/invites/join','POST',{code:s.invite}));return{f,o,u,x,O,U,s,base:'/servers/'+s.id,ch:s.channels[0].id};}
async function seed(f,fn){await f.stop();const state=JSON.parse(await readFile(f.dir+'/state.json','utf8'));fn(state);await writeFile(f.dir+'/state.json',JSON.stringify(state));await f.start();}

test('Max grants survive restart, expose exact prices and enforce bot command and creation quotas after downgrade',async()=>{
 const a=await lab(),{f,o,u,O,U}=a;try{
  assert.deepEqual(['botApplications','botCommands','groupMembers','customThemes'].map(k=>premiumPerks(u)[k]),[20,200,20,0]);
  const catalog=ok(await f.call(null,'/premium/catalog'));assert.deepEqual(catalog.plans.find(p=>p.id==='max').prices.map(p=>p.amount),[2499,14999]);
  const app=ok(await U('/applications','POST',{name:'Limits Bot'})),bot={token:app.token};
  const commands=n=>Array.from({length:n},(_,i)=>({name:'cmd'+i,description:'A command'}));
  assert.equal((await f.call(bot,'/bot/commands','PUT',{commands:commands(201)})).status,400);
  ok(await f.call(bot,'/bot/commands','PUT',{commands:commands(200)}));
  await grant(f,o,u,'plus');ok(await f.call(bot,'/bot/commands','PUT',{commands:commands(400)}));assert.equal((await f.call(bot,'/bot/commands','PUT',{commands:commands(401)})).status,400);
  await grant(f,o,u,'max');ok(await f.call(bot,'/bot/commands','PUT',{commands:commands(1000)}));assert.equal((await f.call(bot,'/bot/commands','PUT',{commands:commands(1001)})).status,400);
  await f.stop();await f.start();const max=ok(await U('/premium/me'));assert.equal(max.plan,'max');assert.equal(max.boosts.length,6);assert.equal(max.perks.botApplications,250);
  await seed(f,state=>{const original=state.botApplications.find(x=>x.id===app.application.id);for(let i=1;i<20;i++)state.botApplications.push({...structuredClone(original),id:randomUUID()});state.users.find(x=>x.id===u.id).premium.grant=null;});
  assert.equal((await U('/applications','POST',{name:'Over quota'})).status,400);
  await grant(f,o,u,'plus');assert.equal((await U('/applications','POST',{name:'Plus capacity'})).status,201);
 }finally{await f.cleanup();}
});

test('shared themes, Max workspace scenes and private lists remain scoped and honor downgraded slots',async()=>{
 const {f,o,u,x,O,U,s,ch}=await lab();try{
  assert.equal((await U('/personal-workspace/themes','POST',{name:'Denied',palette})).status,403);await grant(f,o,u,'plus');
  const first=ok(await U('/personal-workspace/themes','POST',{name:'Ocean',palette})).themes[0];ok(await U('/personal-workspace/themes','POST',{name:'Night',palette}));assert.equal((await U('/personal-workspace/themes','POST',{name:'Third',palette})).status,403);
  const shared=ok(await U('/personal-workspace/share','POST',{themeId:first.id})).shares[0];ok(await O('/personal-workspace/apply','POST',{code:shared.code}));assert.equal(ok(await O('/personal-workspace')).active.name,'Ocean');
  const secret=ok(await O('/servers/'+s.id+'/channels','POST',{name:'hidden-list',private:true}));assert.equal((await U('/personal-workspace/channel-lists/'+s.id,'PUT',{order:[secret.id],hidden:[]})).status,400);
  ok(await U('/personal-workspace/channel-lists/'+s.id,'PUT',{order:[ch],hidden:[ch]}));
  assert.equal((await U('/personal-workspace/scenes','POST',{name:'Scene'})).status,403);await grant(f,o,u,'max');
  ok(await U('/personal-workspace/apply','POST',{themeId:first.id}));const scene=ok(await U('/personal-workspace/scenes','POST',{name:'Gaming'})).scenes[0];
  ok(await U('/personal-workspace/themes/'+first.id,'DELETE'));ok(await U('/personal-workspace/scenes/'+scene.id,'POST',{}));assert.equal(ok(await U('/personal-workspace')).active,null,'deleted own theme cannot be resurrected by a scene');
  assert.equal((await f.call(x,'/personal-workspace/apply','POST',{code:shared.code})).status,403,'deleting original theme revokes future imports');
  await f.stop();await f.start();assert.equal(ok(await U('/personal-workspace')).scenes[0].name,'Gaming');assert.equal(ok(await O('/personal-workspace')).channelLists[s.id],undefined);
 }finally{await f.cleanup();}
});

test('deleted channels, messages, threads and roles restore with protected attachments and retained privacy',async()=>{
 const {f,o,u,x,O,U,s,ch,base}=await lab();try{
  const privateCh=ok(await O(base+'/channels','POST',{name:'private-recovery',private:true}));
  const upload=await fetch(f.origin+'/api/files?channel='+privateCh.id,{method:'POST',headers:{Cookie:o.cookie,'X-File-Name':'evidence.txt','Content-Type':'text/plain'},body:'Private attachment'});assert.equal(upload.status,201);const file=await upload.json();
  const root=ok(await O('/messages','POST',{channel:privateCh.id,text:'Private original',files:[file.id]})),t=ok(await O('/threads','POST',{messageId:root.id,name:'Recovered thread'}));ok(await O('/threads/'+t.id+'/messages','POST',{text:'Private reply'}));
  ok(await O('/channels/'+privateCh.id,'DELETE'));assert.equal((await U(base+'/recovery')).status,403);let items=ok(await O(base+'/recovery')).items;assert.ok(!JSON.stringify(items).includes('Private original'));assert.equal((await fetch(f.origin+'/api/files/'+file.id,{headers:{Cookie:u.cookie}})).status,404);
  await f.stop();await f.start();ok(await O(base+'/recovery/'+items[0].id,'POST',{action:'restore'}));assert.equal(ok(await O('/threads/'+t.id)).replyCount,1);assert.equal((await U('/messages?channel='+privateCh.id)).status,403);assert.equal((await fetch(f.origin+'/api/files/'+file.id,{headers:{Cookie:o.cookie}})).status,200);
  const role=ok(await O(base+'/roles','POST',{name:'Recover role',permissions:[]}));ok(await O(base+'/roles/'+role.id,'DELETE'));items=ok(await O(base+'/recovery')).items;ok(await O(base+'/recovery/'+items.find(i=>i.kind==='role').id,'POST',{action:'restore'}));assert.ok(ok(await O('/state')).servers.find(x=>x.id===s.id).roles.some(r=>r.id===role.id));
  const reply=ok(await O('/threads/'+t.id+'/messages','POST',{text:'Delete just this reply'}));ok(await O('/thread-messages/'+reply.id,'DELETE'));items=ok(await O(base+'/recovery')).items;ok(await O(base+'/recovery/'+items.find(i=>i.kind==='message').id,'POST',{action:'restore'}));assert.equal(ok(await O('/threads/'+t.id)).replyCount,2);
  ok(await O('/messages/'+root.id,'DELETE'));items=ok(await O(base+'/recovery')).items;ok(await O(base+'/recovery/'+items[0].id,'DELETE'));assert.equal((await fetch(f.origin+'/api/files/'+file.id,{headers:{Cookie:o.cookie}})).status,404);
 }finally{await f.cleanup();}
});

test('reaction roles cannot grant staff powers, manual assignments survive removal, and XP ignores repeated rapid messages',async()=>{
 const {f,o,u,O,U,s,ch,base}=await lab();try{
  const role=ok(await O(base+'/roles','POST',{name:'Games',permissions:[]})),staff=ok(await O(base+'/roles','POST',{name:'Staff',permissions:['manageRoles']})),m=ok(await O('/messages','POST',{channel:ch,text:'Choose games'}));
  assert.equal((await U(base+'/engagement')).status,403);assert.equal((await O(base+'/engagement/rules','POST',{messageId:m.id,emoji:'✅',roleId:staff.id})).status,403);
  const rule=ok(await O(base+'/engagement/rules','POST',{messageId:m.id,emoji:'✅',roleId:role.id})).rules[0];
  ok(await U('/messages/'+m.id+'/reactions','POST',{emoji:'✅'}));assert.ok(ok(await O('/state')).servers.find(x=>x.id===s.id).memberRoles[u.id].includes(role.id));
  ok(await O(base+'/members/'+u.id,'PATCH',{roles:[role.id]}));ok(await O(base+'/engagement/rules/'+rule.id,'DELETE'));assert.ok(ok(await O('/state')).servers.find(x=>x.id===s.id).memberRoles[u.id].includes(role.id));
  ok(await O(base+'/engagement/leveling','PUT',{enabled:true,rewards:[{level:1,roleId:role.id}]}));for(const text of ['First eligible message','First eligible message','A different rapid message'])ok(await U('/messages','POST',{channel:ch,text}));
  assert.equal(ok(await U(base+'/engagement/leaderboard')).items.find(i=>i.id===u.id).xp,20);
  await seed(f,state=>{state.servers.find(x=>x.id===s.id).engagementMembers[u.id].lastAwardAt=0;});ok(await U('/messages','POST',{channel:ch,text:'First eligible message'}));assert.equal(ok(await U(base+'/engagement/leaderboard')).items.find(i=>i.id===u.id).xp,20,'repeated text does not farm XP even after cooldown');
 }finally{await f.cleanup();}
});

test('thread moves require explicit audience consent, clone attachments, and merge into one durable discussion',async()=>{
 const {f,o,u,O,U,s,ch,base}=await lab();try{
  const privateCh=ok(await O(base+'/channels','POST',{name:'private-transfer',private:true}));const upload=await fetch(f.origin+'/api/files?channel='+privateCh.id,{method:'POST',headers:{Cookie:o.cookie,'X-File-Name':'note.txt'},body:'Transfer me'}),file=await upload.json();
  const root=ok(await O('/messages','POST',{channel:privateCh.id,text:'Hidden discussion',files:[file.id]})),t=ok(await O('/threads','POST',{messageId:root.id,name:'Move me'}));ok(await O('/threads/'+t.id+'/messages','POST',{text:'Original reply'}));
  assert.equal((await O('/threads/'+t.id+'/transfer','POST',{action:'move',channelId:ch})).status,403);assert.equal((await U('/threads/'+t.id+'/transfer','POST',{action:'move',channelId:ch,confirmAudienceChange:true})).status,403);
  ok(await O('/threads/'+t.id+'/transfer','POST',{action:'move',channelId:ch,confirmAudienceChange:true}));const moved=ok(await U('/messages?channel='+ch)).find(m=>m.id===root.id);assert.notEqual(moved.attachments[0].id,file.id);assert.equal((await fetch(f.origin+moved.attachments[0].url,{headers:{Cookie:u.cookie}})).status,200);assert.equal((await fetch(f.origin+'/api/files/'+file.id,{headers:{Cookie:u.cookie}})).status,404);
  const parent=ok(await O('/messages','POST',{channel:ch,text:'Merge destination'})),target=ok(await O('/threads','POST',{messageId:parent.id,name:'Target'}));ok(await O('/threads/'+t.id+'/transfer','POST',{action:'merge',targetId:target.id}));assert.equal(ok(await U('/threads/'+target.id)).replyCount,2);await f.stop();await f.start();assert.equal(ok(await U('/threads/'+target.id)).replyCount,2);
 }finally{await f.cleanup();}
});

test('account switching requires prior sign-in and live session proof, and revoking a session removes its shortcut',async()=>{
 const f=await fixture();try{
  async function auth(username,cookie){const r=await fetch(f.origin+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({username,password:'Fixture-password-987'})});assert.equal(r.status,200);return {data:await r.json(),cookies:r.headers.getSetCookie().map(c=>c.split(';')[0])};}
  const first=await auth('switch_first'),account=first.cookies.find(c=>c.startsWith('voxora_accounts=')),session=first.cookies.find(c=>c.startsWith('voxora_session='));assert.ok(account);const second=await auth('switch_second',account),who={cookie:second.cookies.find(c=>c.startsWith('voxora_session='))+'; '+account};
  assert.equal(ok(await f.call(who,'/accounts')).items.length,2);assert.equal((await f.call(who,'/accounts','POST',{userId:'never-signed-in'})).status,403);
  const switched=await f.call(who,'/accounts','POST',{userId:first.data.me.id});assert.equal(switched.status,200);assert.equal(ok(await f.call({cookie:switched.cookie},'/state')).me.id,first.data.me.id);
  await seed(f,state=>{state.sessions=state.sessions.filter(s=>s.hash!==createHash('sha256').update(switched.cookie.split('=')[1]).digest('hex'));});
  assert.equal(ok(await f.call(who,'/accounts')).items.length,1);assert.equal((await f.call(who,'/accounts','POST',{userId:first.data.me.id})).status,403);
  const originalProof={cookie:session+'; '+account};assert.equal((await f.call(originalProof,'/accounts','POST',{userId:second.data.me.id})).status,200,'a still valid current sign-in keeps the other enrolled account available');
 }finally{await f.cleanup();}
});

test('webhooks hide secrets after creation, widgets restrict origins, guest AutoMod and private-channel revocation',async()=>{
 const {f,o,u,O,U,s,ch,base}=await lab();try{
  const hook=ok(await O(base+'/webhooks','POST',{name:'Build events',channelId:ch}));assert.ok(hook.url);assert.ok(!JSON.stringify(ok(await O(base+'/webhooks'))).includes(hook.url.split('/').at(-1)));
  const post=async(url,data,headers={})=>{const r=await fetch(url.startsWith('http')?url:f.origin+url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});return{status:r.status,data:await r.json()};};
  const msg=ok(await post(hook.url,{embeds:[{title:'Build completed',description:'Ready'}]}));assert.equal(msg.embeds[0].title,'Build completed');ok(await O(base+'/webhooks/'+hook.id,'DELETE'));assert.equal((await post(hook.url,{text:'revoked'})).status,404);
  const secret=ok(await O(base+'/channels','POST',{name:'private-widget',private:true}));assert.equal((await O(base+'/widgets','POST',{name:'Unsafe',channelId:secret.id,origins:['https://example.com'],confirmPublic:true})).status,400);
  assert.equal((await U(base+'/widgets','POST',{name:'No permission',channelId:ch,origins:['https://example.com'],confirmPublic:true})).status,403);
  const widget=ok(await O(base+'/widgets','POST',{name:'Website Chat',channelId:ch,origins:['https://example.com'],confirmPublic:true})),path='/api/widgets/'+widget.id;
  assert.equal((await post(path+'/session',{}, {Origin:'https://evil.example'})).status,403);const ticket=ok(await post(path+'/session',{}, {Origin:'https://example.com'})),auth={Authorization:'Widget '+ticket.token};
  assert.equal((await post(path+'/messages',{text:'Guest hello'},auth)).status,201);const read=await fetch(f.origin+path+'/messages',{headers:auth});assert.equal(read.status,200);assert.ok((await read.json()).messages.some(m=>m.author==='Website Visitor'&&m.text==='Guest hello'));
  ok(await O(base+'/automod/rules','POST',{name:'No forbidden',kind:'keywords',terms:['forbidden'],action:'block'}));ok(await O(base+'/automod','PATCH',{enabled:true}));assert.equal((await post(path+'/messages',{text:'forbidden'},auth)).status,422);
  const page=await fetch(f.origin+'/widgets/'+widget.id);assert.ok(page.headers.get('content-security-policy').includes('frame-ancestors https://example.com'));
  ok(await O('/channels/'+ch,'PATCH',{overwrites:[{type:'role',id:'everyone',allow:[],deny:['viewChannel']}]}));assert.equal((await fetch(f.origin+path+'/messages',{headers:auth})).status,404);assert.equal((await post(path+'/messages',{text:'Still revoked'},auth)).status,404);
 }finally{await f.cleanup();}
});

test('bot embeds and components use safe URLs and current permissions; search combines OR, NOT and rich-content filters',async()=>{
 const {f,o,u,O,U,s,ch,base}=await lab();try{
  assert.equal((await U('/messages','POST',{channel:ch,embeds:[{title:'spoof'}]})).status,403);
  const app=ok(await O('/applications','POST',{name:'Rich Bot'}));ok(await O(base+'/bots','POST',{applicationId:app.application.id}));const sdk=new VoxoraBot({url:f.origin,token:app.token});
  await assert.rejects(sdk.sendMessage(ch,{embeds:[{url:'javascript:alert(1)'}]}),e=>e.status===400);await assert.rejects(sdk.sendMessage(ch,{embeds:[{fields:[null]}]}),e=>e.status===400);
  const m=await sdk.sendMessage(ch,{embeds:[{title:'Launch',description:'A safe rich message',color:'#00bb99'}],components:[{label:'Join',customId:'join'},{label:'Website',url:'https://example.com'}]});assert.equal(m.embeds[0].title,'Launch');
  assert.equal((await U('/messages/'+m.id+'/components','POST',{customId:'join'})).status,202);await sdk.editMessage(m.id,{embeds:[{title:'Updated Launch'}],components:[]});assert.equal((await U('/messages/'+m.id+'/components','POST',{customId:'join'})).status,404);
  const plain=ok(await U('/messages','POST',{channel:ch,text:'Oranges and apples'}));ok(await U('/messages','POST',{channel:ch,text:'Oranges only'}));
  const results=ok(await U('/search?q='+encodeURIComponent('has:embed OR oranges NOT apples')));assert.ok(results.some(x=>x.id===m.id));assert.ok(!results.some(x=>x.id===plain.id));
  const role=ok(await O(base+'/roles','POST',{name:'Restricted Bot',permissions:[]}));ok(await O('/channels/'+ch,'PATCH',{overwrites:[{type:'member',id:app.application.userId,allow:[],deny:['sendLinks']}]}));await assert.rejects(sdk.sendMessage(ch,{embeds:[{description:'https://example.com'}]}),e=>e.status===403);
 }finally{await f.cleanup();}
});

test('role icons and server branding follow boost gates and emoji restrictions apply to posting and reactions',async()=>{
 const {default:sharp}=await import('sharp'),{f,o,u,O,U,s,ch,base}=await lab();try{
  const role=ok(await O(base+'/roles','POST',{name:'Icon Role',permissions:[]})),png=await sharp({create:{width:16,height:16,channels:4,background:'#00bb99'}}).png().toBuffer();
  const upload=async(route,bytes=png)=>{const r=await fetch(f.origin+'/api'+route,{method:'POST',headers:{Cookie:o.cookie},body:bytes});return {status:r.status,data:await r.json()};};
  assert.equal((await upload(base+'/roles/'+role.id+'/icon')).status,403);
  ok(await O('/platform/server-boosts/'+s.id,'PATCH',{version:0,level:2,expiresAt:null,reason:'Icon boost fixture'}));const icon=ok(await upload(base+'/roles/'+role.id+'/icon'));assert.equal((await fetch(f.origin+icon.url,{headers:{Cookie:u.cookie}})).status,200);
  const frames=Buffer.alloc(2*4*4,200);frames.fill(50,0,16);const moving=await sharp(frames,{raw:{width:2,height:4,channels:4,pageHeight:2}}).gif({delay:[100,100],loop:0}).toBuffer();assert.equal((await sharp(moving,{animated:true}).metadata()).pages,2);assert.equal((await upload(base+'/roles/'+role.id+'/icon',moving)).status,403);
  const emoji=ok(await upload(base+'/emojis?name=role_only'));ok(await O(base+'/emojis/'+emoji.id,'PATCH',{roleIds:[role.id]}));const code='<:role_only:'+emoji.id+'>';
  assert.equal((await U('/messages','POST',{channel:ch,text:code})).status,403);const root=ok(await O('/messages','POST',{channel:ch,text:'Reaction test'}));assert.equal((await U('/messages/'+root.id+'/reactions','POST',{emoji:code})).status,403);
  ok(await O(base+'/members/'+u.id,'PATCH',{roles:[role.id]}));ok(await U('/messages','POST',{channel:ch,text:code}));ok(await U('/messages/'+root.id+'/reactions','POST',{emoji:code}));
  ok(await O('/platform/server-boosts/'+s.id,'PATCH',{version:1,level:3,expiresAt:null,reason:'Animated fixture'}));const animated=ok(await upload(base+'/roles/'+role.id+'/icon',moving));const brand=ok(await upload(base+'/icon?version=0',moving));assert.equal((await fetch(f.origin+brand.url,{headers:{Cookie:u.cookie}})).status,200);
  ok(await O('/platform/server-boosts/'+s.id,'PATCH',{version:2,level:0,expiresAt:null,reason:'Downgrade fixture'}));assert.equal((await fetch(f.origin+animated.url,{headers:{Cookie:u.cookie}})).status,404);assert.equal((await fetch(f.origin+brand.url,{headers:{Cookie:u.cookie}})).status,404);assert.equal(ok(await O('/state')).servers.find(x=>x.id===s.id).iconUrl,null);ok(await O(base+'/roles/'+role.id+'/icon','DELETE'));
 }finally{await f.cleanup();}
});


test('the Play app consumes digital memberships without launching external digital checkout',async()=>{
 const f=await fixture();try{const u=await f.register('play_checkout_member');const r=await fetch(f.origin+'/api/premium/checkout',{method:'POST',headers:{Cookie:u.cookie,'User-Agent':'Mozilla/5.0 Android VoxoraPlay/4.0.0','Content-Type':'application/json'},body:JSON.stringify({plan:'max',interval:'month'})});assert.equal(r.status,403);assert.match((await r.json()).error,/Play app/);}finally{await f.cleanup();}
});
