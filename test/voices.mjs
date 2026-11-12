import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './support/server.mjs';

async function lab() {
  const f=await fixture(), o=await f.register('voices_owner'), m=await f.register('voices_member'), n=await f.register('voices_friend'), x=await f.register('voices_outsider');
  const O=(p,v,d)=>f.call(o,p,v,d), M=(p,v,d)=>f.call(m,p,v,d), N=(p,v,d)=>f.call(n,p,v,d), X=(p,v,d)=>f.call(x,p,v,d);
  const s=(await O('/servers','POST',{name:'Community Voices Lab'})).data;
  for(const u of[m,n]) await f.call(u,'/invites/join','POST',{code:s.invite});
  const base='/servers/'+s.id+'/voices', ch=s.channels[0].id;
  const create=async(who=M,extra={})=>{const r=await who(base+'/suggestions','POST',{title:'A better community',description:'Let us make something together.',channelId:ch,nonce:randomUUID(),...extra});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  return{f,o,m,n,x,O,M,N,X,s,ch,base,create};
}
const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};

test('server profiles stay within the server, validate fields, reject stale writes and respect reset hierarchy',async()=>{
  const a=await lab();try{const{O,M,N,X,base,m,o}=a;
    const p=ok(await M(base+'/profiles/me','PATCH',{revision:0,bio:'I build games here.',pronouns:'they/them',interests:['Games','music','games'],lookingForGroup:true,availability:'open'}));
    assert.deepEqual(p.interests,['games','music']);assert.equal(p.revision,1);assert.equal(ok(await N(base+'/profiles/'+m.id)).bio,p.bio);
    assert.equal((await X(base+'/profiles/'+m.id)).status,404);assert.equal((await N(base+'/profiles/'+m.id,'PATCH',{revision:1,bio:'Hijack'})).status,403);
    assert.equal((await M(base+'/profiles/me','PATCH',{revision:0,bio:'Stale'})).status,409);
    assert.equal((await M(base+'/profiles/me','PATCH',{revision:1,interests:['x'.repeat(25)]})).status,400);
    assert.equal((await M(base+'/profiles/me','PATCH',{revision:1,owner:true})).status,400);
    assert.equal((await N(base+'/profiles/'+m.id+'?revision=1','DELETE')).status,403);
    assert.equal((await O(base+'/profiles/'+m.id+'?revision=1','DELETE')).status,200);
    assert.equal(ok(await M(base+'/profiles/me')).bio,'');assert.equal(ok(await M(base+'/profiles/me')).revision,2);
    assert.equal((await M(base+'/profiles/'+o.id+'?revision=0','DELETE')).status,403);
    assert.doesNotMatch(JSON.stringify(ok(await M('/state'))),/I build games here|communityProfiles|storedStyle/);
  }finally{await a.f.cleanup();}
});
test('six Plus profile customizations require active Plus and fall back without deleting retained styles',async()=>{
  const a=await lab();try{const{O,M,N,base,m,f}=a,style={accent:'#abccdd',bannerStart:'#112233',bannerEnd:'#445566',headline:'Games on weekends',links:[{label:'Portfolio',url:'https://example.com/work'}],pattern:'grid',communityTitle:'Weekend builder'};
    assert.equal((await M(base+'/profiles/me','PATCH',{revision:0,style})).status,403);
    let plan=ok(await M('/premium/me'));ok(await O('/platform/premium/members/'+m.id,'PATCH',{version:plan.version,days:null,reason:'Test server profile styling'}));
    const p=ok(await M(base+'/profiles/me','PATCH',{revision:0,style}));assert.deepEqual(p.style,style);assert.equal(p.plusStyle,true);
    for(const links of [[{label:'Bad',url:'javascript:alert(1)'}],[{label:'Secret',url:'https://person:password@example.com'}]])assert.equal((await M(base+'/profiles/me','PATCH',{revision:1,style:{links}})).status,400);
    assert.equal(ok(await N(base+'/profiles/'+m.id)).storedStyle,undefined);
    plan=ok(await M('/premium/me'));ok(await O('/platform/premium/members/'+m.id,'PATCH',{version:plan.version,revoke:true,reason:'Test plan fallback'}));
    const publicView=ok(await N(base+'/profiles/'+m.id));assert.equal(publicView.style.headline,'');assert.equal(publicView.style.pattern,'none');assert.deepEqual(publicView.style.links,[]);
    assert.equal(ok(await M(base+'/profiles/me')).storedStyle.headline,style.headline);
    assert.equal((await M(base+'/profiles/me','PATCH',{revision:1,style:{headline:'Cannot bypass'}})).status,403);
    ok(await M(base+'/profiles/me','PATCH',{revision:1,bio:'Basic editing still works.'}));await f.stop();await f.start();assert.equal(ok(await M(base+'/profiles/me')).storedStyle.communityTitle,style.communityTitle);
  }finally{await a.f.cleanup();}
});
test('directory filters interests, roles, group availability and presence without exposing blocked profiles',async()=>{
  const a=await lab();try{const{O,M,N,X,base,s,m,n}=a;
    ok(await M(base+'/profiles/me','PATCH',{revision:0,bio:'I love synthesizers',interests:['music'],lookingForGroup:true,availability:'open'}));
    ok(await N(base+'/profiles/me','PATCH',{revision:0,bio:'Design and art',interests:['design'],availability:'busy'}));
    assert.equal(ok(await O(base+'/profiles?q=synthesizers')).total,1);assert.equal(ok(await O(base+'/profiles?interest=music&lfg=1')).items[0].userId,m.id);
    assert.equal(ok(await O(base+'/profiles?sort=available')).items[0].userId,m.id);
    const role=ok(await O('/servers/'+s.id+'/roles','POST',{name:'Musicians',permissions:[]}),201);ok(await O('/servers/'+s.id+'/members/'+m.id,'PATCH',{roles:[role.id]}));
    assert.equal(ok(await O(base+'/profiles?role='+role.id)).items[0].userId,m.id);
    ok(await N('/blocks/'+m.id,'POST',{}));const view=ok(await N(base+'/profiles'));assert.ok(!view.items.some(p=>p.userId===m.id));assert.ok(!view.interests.includes('music'));
    assert.equal((await N(base+'/profiles/'+m.id)).status,404);assert.equal((await X(base+'/profiles')).status,404);
    assert.equal((await O(base+'/profiles?offset=-1')).status,400);assert.equal((await O(base+'/profiles?presence=invisible')).status,400);
  }finally{await a.f.cleanup();}
});
test('suggestions use channel visibility, idempotent creation and private vote/watch storage',async()=>{
  const a=await lab();try{const{O,M,N,X,s,ch,base,create}=a;
    const request={title:'Open idea',channelId:ch,nonce:randomUUID()},first=ok(await M(base+'/suggestions','POST',request),201),retry=ok(await M(base+'/suggestions','POST',request));assert.equal(first.id,retry.id);
    assert.equal((await M(base+'/suggestions','POST',{...request,title:'Changed retry'})).status,409);
    const privateChannel=ok(await O('/servers/'+s.id+'/channels','POST',{name:'staff-ideas',type:'text',private:true}),201),hidden=await create(O,{title:'Private staff suggestion',channelId:privateChannel.id});
    assert.equal((await M(base+'/suggestions/'+hidden.id)).status,404);assert.doesNotMatch(JSON.stringify(ok(await M(base+'/suggestions'))),/Private staff suggestion/);
    assert.equal((await X(base+'/suggestions/'+first.id)).status,404);
    const dto=ok(await N(base+'/suggestions/'+first.id));assert.doesNotMatch(JSON.stringify(dto),/voterIds|watcherIds|nonce|request/);
    assert.equal(ok(await N(base+'/suggestions?q=open&category=idea')).total,1);
    assert.equal((await M(base+'/suggestions','POST',{title:'No channel',channelId:'missing',nonce:randomUUID()})).status,403);
  }finally{await a.f.cleanup();}
});
test('votes are idempotent, independent of edit revisions and count only currently eligible members',async()=>{
  const a=await lab();try{const{O,M,N,s,ch,base,m,create}=a,t=await create(),path=base+'/suggestions/'+t.id;
    assert.equal(ok(await M(path+'/vote','POST',{voted:true})).votes,1);assert.equal(ok(await M(path+'/vote','POST',{voted:true})).votes,1);
    assert.equal(ok(await N(path+'/vote','POST',{voted:true})).votes,2);
    assert.equal(ok(await M(path,'PATCH',{revision:0,title:'Edited despite votes'})).revision,1);
    ok(await O('/servers/'+s.id+'/members/'+m.id,'PATCH',{timeoutUntil:Date.now()+60000}));assert.equal(ok(await O(path)).votes,1);
    assert.equal((await M(path+'/vote','POST',{voted:true})).status,403);assert.equal((await M(base+'/profiles/me','PATCH',{revision:0,bio:'Timed out edit'})).status,403);
    ok(await O('/servers/'+s.id+'/members/'+m.id,'PATCH',{timeoutUntil:0}));assert.equal(ok(await O(path)).votes,2);
    ok(await O(path+'/moderation','PATCH',{revision:1,status:'completed',locked:true}));assert.equal((await N(path+'/vote','POST',{voted:true})).status,409);
    assert.equal(ok(await N(path+'/vote','POST',{voted:false})).votes,1);
    ok(await O('/channels/'+ch,'PATCH',{overwrites:[{type:'member',id:m.id,allow:[],deny:['createSuggestions']}]}));assert.equal((await M(path+'/vote','POST',{voted:false})).status,403);
  }finally{await a.f.cleanup();}
});
test('discussion comments enforce ownership, revisions, idempotent retries and moderation locks',async()=>{
  const a=await lab();try{const{O,M,N,base,create}=a,t=await create(),path=base+'/suggestions/'+t.id,request={text:'A useful detail',nonce:randomUUID()};
    let detail=ok(await N(path+'/comments','POST',request),201);assert.equal(detail.comments.length,1);assert.equal(ok(await N(path+'/comments','POST',request)).comments.length,1);
    let c=detail.comments[0];assert.equal((await M(path+'/comments/'+c.id,'PATCH',{revision:0,text:'Hijack'})).status,403);
    detail=ok(await N(path+'/comments/'+c.id,'PATCH',{revision:0,text:'An edited detail'}));c=detail.comments[0];assert.equal(c.revision,1);
    assert.equal((await N(path+'/comments/'+c.id,'PATCH',{revision:0,text:'Stale'})).status,409);
    assert.equal((await M(path+'/comments/'+c.id+'?revision=1','DELETE')).status,403);
    ok(await O(path+'/moderation','PATCH',{revision:0,locked:true}));assert.equal((await N(path+'/comments','POST',{text:'Locked',nonce:randomUUID()})).status,409);
    assert.equal((await N(path+'/comments/'+c.id,'PATCH',{revision:1,text:'Locked edit'})).status,409);
    ok(await O(path+'/comments/'+c.id+'?revision=1','DELETE'));assert.equal(ok(await M(path)).comments.length,0);
  }finally{await a.f.cleanup();}
});
test('Manage Suggestions is a separate channel permission with audited decisions, archive filters and stale-write protection',async()=>{
  const a=await lab();try{const{O,M,N,s,ch,base,n,create}=a,t=await create(),path=base+'/suggestions/'+t.id;
    assert.equal((await N(path+'/moderation','PATCH',{revision:0,status:'planned'})).status,403);
    const role=ok(await O('/servers/'+s.id+'/roles','POST',{name:'Community Council',permissions:['manageSuggestions']}),201);ok(await O('/servers/'+s.id+'/members/'+n.id,'PATCH',{roles:[role.id]}));
    let next=ok(await N(path+'/moderation','PATCH',{revision:0,status:'planned',response:'We will work on this.',pinned:true}));assert.equal(next.status,'planned');assert.equal(next.response,'We will work on this.');
    assert.equal((await N(path+'/moderation','PATCH',{revision:0,status:'declined'})).status,409);
    next=ok(await N(path+'/moderation','PATCH',{revision:1,archived:true}));assert.equal(ok(await M(base+'/suggestions')).total,0);assert.equal(ok(await M(base+'/suggestions?archived=1')).total,1);
    assert.equal((await M(path,'PATCH',{revision:2,title:'Closed edit'})).status,403);
    ok(await O('/channels/'+ch,'PATCH',{overwrites:[{type:'member',id:n.id,allow:[],deny:['manageSuggestions']}]}));assert.equal((await N(path+'/moderation','PATCH',{revision:2,archived:false})).status,403);
  }finally{await a.f.cleanup();}
});
test('watched suggestion updates remain private, recheck permissions and persist across restart',async()=>{
  const a=await lab();try{const{f,O,M,N,ch,base,create}=a,t=await create(),path=base+'/suggestions/'+t.id;
    ok(await N(path+'/watch','POST',{watching:true}));ok(await O(path+'/moderation','PATCH',{revision:0,status:'in-progress',response:'Implementation is underway.'}));
    let inbox=ok(await N('/me/community-updates'));assert.equal(inbox.unread,1);assert.equal(ok(await O('/me/community-updates')).unread,0);
    assert.equal(ok(await M('/me/community-updates')).unread,1);assert.doesNotMatch(JSON.stringify(ok(await M(path))),/watcherIds/);
    ok(await N('/me/community-updates','POST',{revision:inbox.revision}));assert.equal(ok(await N('/me/community-updates')).unread,0);
    assert.equal((await N('/me/community-updates','POST',{revision:inbox.revision})).status,409);
    await f.stop();await f.start();assert.equal(ok(await N(path)).watching,true);
    ok(await O('/channels/'+ch,'PATCH',{overwrites:[{type:'role',id:'everyone',allow:[],deny:['viewChannel']}]}));assert.deepEqual(ok(await N('/me/community-updates')).items,[]);assert.equal(ok(await M('/me/community-updates')).unread,0);
  }finally{await a.f.cleanup();}
});
test('existing server AutoMod blocks suggestion and discussion text, including edits',async()=>{
  const a=await lab();try{const{O,M,N,s,ch,base,create}=a;
    ok(await O('/servers/'+s.id+'/automod/rules','POST',{name:'Community words',kind:'keywords',terms:['forbiddenphrase'],action:'block'}),201);ok(await O('/servers/'+s.id+'/automod','PATCH',{enabled:true}));
    assert.equal((await M(base+'/suggestions','POST',{title:'forbiddenphrase',channelId:ch,nonce:randomUUID()})).status,422);
    const t=await create(),path=base+'/suggestions/'+t.id;
    assert.equal((await M(path,'PATCH',{revision:0,description:'forbiddenphrase'})).status,422);
    assert.equal((await N(path+'/comments','POST',{text:'forbiddenphrase',nonce:randomUUID()})).status,422);
    const detail=ok(await M(path));assert.equal(detail.revision,0);assert.equal(detail.comments.length,0);
  }finally{await a.f.cleanup();}
});
