import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture,until} from './support/server.mjs';
import {VoxoraBot} from '../sdk/voxora.mjs';
async function lab(){
 const f=await fixture(),owner=await f.register('forum_owner'),member=await f.register('forum_member'),outside=await f.register('forum_outside');
 const O=(p,m,d)=>f.call(owner,p,m,d),M=(p,m,d)=>f.call(member,p,m,d);
 const s=(await O('/servers','POST',{name:'Forum community'})).data;await M('/invites/join','POST',{code:s.invite});
 const created=await O('/servers/'+s.id+'/channels','POST',{name:'ideas',type:'forum',forum:{tags:[{name:'Question',color:'#23a559'},{name:'Idea',color:'#5865f2'}],requireTag:true}});
 assert.equal(created.status,201,JSON.stringify(created.data));const c=created.data;
 const post=(title,text='Discussion content',who=member,tagIds=[c.forum.tags[0].id])=>f.call(who,'/forums/'+c.id+'/posts','POST',{title,text,tagIds});
 return{f,owner,member,outside,O,M,s,c,post};
}
test('forum posts create discussions atomically, enforce tags and permissions, paginate, search titles, and survive restarts',async()=>{
 const x=await lab(),{f,O,M,c,member,outside,s}=x;
 try{
  assert.equal(c.type,'text');assert.ok(c.forum);assert.equal((await M('/messages','POST',{channel:c.id,text:'Untitled bypass'})).status,400);
  assert.equal((await x.post('Missing tags','content',member,[])).status,400);assert.equal((await x.post('Wrong tag','content',member,['not-a-tag'])).status,400);
  assert.equal((await x.post('A'.repeat(81))).status,400);assert.equal((await f.call(outside,'/forums/'+c.id+'/posts')).status,404);
  const first=await x.post('Launch planning','First post');assert.equal(first.status,201,JSON.stringify(first.data));const p=first.data;
  assert.equal(p.thread.name,'Launch planning');assert.equal(p.message.forumPost.title,p.title);assert.equal((await M('/threads/'+p.thread.id)).data.parentId,p.message.id);
  assert.equal((await O('/search?q=Launch%20planning&server='+s.id)).data[0].id,p.message.id);
  for(let i=0;i<22;i++)assert.equal((await x.post('Post '+i)).status,201);
  const list=(await O('/forums/'+c.id+'/posts?sort=oldest')).data,next=(await O('/forums/'+c.id+'/posts?sort=oldest&offset=20')).data;
  assert.equal(list.posts.length,20);assert.equal(next.posts.length,3);assert.equal(new Set([...list.posts,...next.posts].map(p=>p.message.id)).size,23);assert.equal(list.posts[0].title,'Launch planning');
  assert.equal((await O('/forums/'+c.id+'/posts?q=Launch&tag='+c.forum.tags[1].id)).data.total,0);
  const reply=(await O('/threads/'+p.thread.id+'/messages','POST',{text:'A reply in the discussion'})).data;assert.ok(reply.id);
  const unread=(await M('/forum-posts/'+p.message.id)).data;assert.equal(unread.thread.unreadCount,1);assert.equal(unread.unread,true);
  assert.equal((await M('/threads/'+p.thread.id+'/read','POST',{through:reply.sequence})).status,200);
  await f.stop();await f.start();assert.equal((await O('/forums/'+c.id+'/posts')).data.total,23);assert.equal((await M('/forum-posts/'+p.message.id)).data.thread.replyCount,1);
  assert.equal((await O('/threads/'+p.thread.id,'DELETE')).status,400);
  await M('/messages/'+p.message.id,'DELETE');assert.equal((await O('/forum-posts/'+p.message.id)).status,404);assert.equal((await O('/threads/'+p.thread.id)).status,404);
 }finally{await f.cleanup();}
});
test('forum moderation restricts pins, protects stale edits and settings, validates title filters, and respects archive and locks',async()=>{
 const x=await lab(),{f,O,M,c,member,s}=x;
 try{
  const p=(await x.post('Original topic')).data;
  assert.equal((await M('/forum-posts/'+p.message.id,'PATCH',{revision:p.revision,pinned:true})).status,403);
  assert.equal((await M('/messages/'+p.message.id+'/pin','POST',{})).status,403);
  const pinned=(await O('/forum-posts/'+p.message.id,'PATCH',{revision:p.revision,pinned:true})).data;assert.equal(pinned.message.pinned,true);
  assert.equal((await M('/forum-posts/'+p.message.id,'PATCH',{revision:p.revision,title:'Stale edit'})).status,409);
  const updated=await M('/forum-posts/'+p.message.id,'PATCH',{revision:pinned.revision,title:'Updated topic',text:'Updated content',tagIds:[c.forum.tags[1].id]});assert.equal(updated.status,200,JSON.stringify(updated.data));
  const other=(await x.post('Second topic','Other content',x.owner)).data;
  assert.equal((await M('/forum-posts/'+other.message.id,'PATCH',{revision:other.revision,text:'Change someone else'})).status,403);
  const base='/servers/'+s.id;await O(base+'/automod/rules','POST',{name:'Forbidden title',kind:'keywords',terms:['forbidden title'],action:'block'});await O(base+'/automod','PATCH',{enabled:true});
  assert.equal((await x.post('Forbidden title','Innocent body')).status,422);
  const current=(await M('/forum-posts/'+p.message.id)).data;assert.equal((await M('/forum-posts/'+p.message.id,'PATCH',{revision:current.revision,title:'Forbidden title'})).status,422);
  assert.equal((await M('/threads/'+p.thread.id,'PATCH',{name:'Forbidden title'})).status,422);
  assert.equal((await M('/forum-posts/'+p.message.id)).data.title,'Updated topic');
  await O('/threads/'+p.thread.id,'PATCH',{locked:true});assert.equal((await M('/threads/'+p.thread.id+'/messages','POST',{text:'Locked'})).status,403);
  await O('/threads/'+p.thread.id,'PATCH',{locked:false,archived:true});assert.equal((await O('/forums/'+c.id+'/posts?archived=1')).data.total,1);assert.equal((await M('/threads/'+p.thread.id+'/messages','POST',{text:'Archived'})).status,403);
  assert.equal((await M('/forums/'+c.id,'PATCH',{version:0,tags:[],requireTag:false})).status,403);
  const changed=await O('/forums/'+c.id,'PATCH',{...c.forum,tags:[c.forum.tags[0]],requireTag:false});assert.equal(changed.status,200);assert.equal((await O('/forums/'+c.id,'PATCH',{...c.forum})).status,409);
  assert.deepEqual((await M('/forum-posts/'+p.message.id)).data.tags,[]);
  assert.equal((await O('/channels/'+c.id,'PATCH',{announcement:true})).status,400);
  const ann=(await O('/servers/'+s.id+'/channels','POST',{name:'news',type:'announcement'})).data;assert.equal((await O('/announcements/'+ann.id+'/follows','POST',{channelId:c.id})).status,404);
 }finally{await f.cleanup();}
});
test('forum mutations recheck access after delayed bodies and revoked access hides posts, replies and search results',async()=>{
 const x=await lab(),{f,O,M,c,member}=x;
 try{
  const p=(await x.post('Private forum evidence')).data;
  const data=JSON.stringify({title:'Delayed forbidden post',text:'Must not be posted',tagIds:[c.forum.tags[0].id]});let req;
  const result=new Promise((resolve,reject)=>{req=http.request(new URL(f.origin+'/api/forums/'+c.id+'/posts'),{method:'POST',headers:{Cookie:member.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(data.slice(0,-1));});
  await O('/channels/'+c.id,'PATCH',{overwrites:[{type:'member',id:member.id,allow:[],deny:['viewChannel']}]});req.end(data.slice(-1));assert.equal(await result,404);
  assert.equal((await M('/forum-posts/'+p.message.id)).status,404);assert.equal((await M('/threads/'+p.thread.id)).status,404);assert.equal((await M('/search?q=Private%20forum')).data.length,0);
  assert.equal((await O('/forums/'+c.id+'/posts')).data.total,1);
  assert.equal((await O('/forums/'+c.id+'/posts?offset=-1')).status,400);
 }finally{await f.cleanup();}
});
test('bot SDK creates and edits forum posts, receives thread replies, and enforces installation channel restrictions',async()=>{
 const x=await lab(),{f,O,c,s}=x;let bot,connection;
 try{
  const app=(await O('/applications','POST',{name:'Forum SDK Bot'})).data;assert.equal((await O('/servers/'+s.id+'/bots','POST',{applicationId:app.application.id})).status,201);
  bot=new VoxoraBot({url:f.origin,token:app.token});const events=[];bot.on('message',m=>events.push(m));bot.on('threadMessage',m=>events.push(m));bot.on('ready',()=>events.push('ready'));connection=bot.connect();await until(()=>events.includes('ready'));
  const p=await bot.createForumPost(c.id,{title:'Bot topic',text:'Posted through the SDK',tagIds:[c.forum.tags[0].id]});assert.equal(p.message.bot,true);assert.equal(p.title,'Bot topic');
  await until(()=>events.some(m=>m.forumPost?.title==='Bot topic'));await bot.sendThreadMessage(p.thread.id,'SDK discussion reply');
  await until(()=>events.some(m=>m.threadId===p.thread.id));const latest=await bot.getForumPost(p.message.id);assert.equal(latest.thread.replyCount,1);
  const updated=await bot.updateForumPost(p.message.id,{revision:latest.revision,title:'SDK renamed topic'});assert.equal(updated.title,'SDK renamed topic');assert.equal((await bot.getForumPosts(c.id,{q:'renamed'})).total,1);
  await assert.rejects(bot.updateForumPost(p.message.id,{revision:updated.revision,pinned:true}),e=>e.status===403);
  await O('/servers/'+s.id+'/bots/'+app.application.id,'PATCH',{channelIds:[]});await assert.rejects(bot.getForumPosts(c.id),e=>e.status===403);await assert.rejects(bot.createForumPost(c.id,{title:'No permission',text:'No',tagIds:[]}),e=>e.status===403);
 }finally{bot?.close();await connection;await f.cleanup();}
});
