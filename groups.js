import { randomUUID } from 'node:crypto';
import { activePremium } from './premium.js';
import { isSuspended } from './platform.js';

export function groupService({state,body,json,fail,save,refresh,rate,userById,onMembershipChange}) {
  state.groupInvites=(state.groupInvites||[]).filter(i=>i.expiresAt>Date.now()-30*86400000);
  const keys=(d,allowed)=>{if(Object.keys(d).some(k=>!allowed.includes(k)))fail(400,'Unsupported group field.');};
  const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||required&&!value.trim()||/[\p{Cc}\p{Cf}]/u.test(value))fail(400,'Choose '+(required?'nonempty ':'')+'text up to '+max+' characters.');return value.trim();};
  const human=u=>!!u&&!u.bot&&!isSuspended(u);
  const blocked=(a,b)=>a?.blocked?.includes(b?.id)||b?.blocked?.includes(a?.id);
  const cap=c=>activePremium(userById(c.ownerId))?20:10;
  const pending=i=>i.status==='pending'&&i.expiresAt>Date.now();
  const known=(me,target)=>state.servers.some(s=>s.members.includes(me.id)&&s.members.includes(target.id))||state.friendships.some(f=>f.status==='accepted'&&[f.from,f.to].includes(me.id)&&[f.from,f.to].includes(target.id));
  const group=(id,me)=>{const c=state.conversations.find(c=>c.id===id&&c.kind==='group'&&c.members.includes(me.id));if(!c)fail(404,'Group not found.');return c;};
  const owner=(c,me)=>{if(c.ownerId!==me.id)fail(403,'Only the group owner can manage this group.');};
  const version=(c,d)=>{if(!Number.isSafeInteger(d.revision)||d.revision!==c.revision)fail(409,'This group changed. Reopen it before saving.');};
  const view=c=>c.kind!=='group'?c:{id:c.id,kind:'group',name:c.name,topic:c.topic,color:c.color,ownerId:c.ownerId,members:[...c.members],revision:c.revision,createdAt:c.createdAt,memberLimit:cap(c)};
  const inviteView=i=>{const c=state.conversations.find(c=>c.id===i.groupId);return {id:i.id,groupId:i.groupId,name:c?.name||'Closed group',topic:c?.topic||'',inviter:userById(i.inviterId)?.displayName||'Member',expiresAt:i.expiresAt,members:(c?.members||[]).map(id=>{const u=userById(id);return {id,displayName:u?.displayName||'Former member',username:u?.username||''};})};};
  function inviteTarget(c,me,id){const target=userById(id);if(!human(target)||target.id===me.id||c.members.includes(id))fail(400,'Choose another active member who is not already in this group.');if(!known(me,target)||c.members.some(uid=>blocked(userById(uid),target)))fail(403,'Invite a friend or shared-server member without a blocked participant.');return target;}
  function addInvite(c,me,id){if(state.groupInvites.length>=50000)fail(400,'The invitation storage limit has been reached.');const existing=state.groupInvites.find(i=>i.groupId===c.id&&i.userId===id&&pending(i));if(existing)return existing;if(state.groupInvites.filter(i=>i.groupId===c.id&&pending(i)).length>=30)fail(400,'This group already has 30 pending invitations.');const i={id:randomUUID(),groupId:c.id,userId:id,inviterId:me.id,status:'pending',createdAt:Date.now(),expiresAt:Date.now()+7*86400000};state.groupInvites.push(i);return i;}
  const commit=async(c,res,value,status=200)=>{await save();onMembershipChange(c);refresh();json(res,status,value);return true;};
  async function handle(req,res,url,me){
    const route=url.pathname.match(/^\/api\/groups(?:\/([\w-]+)(?:\/(invites|members|leave)(?:\/([\w-]+))?)?)?$/),invitations=url.pathname.match(/^\/api\/group-invites(?:\/([\w-]+)\/(accept|decline))?$/);if(!route&&!invitations)return false;
    if(!human(me))fail(403,'Group chats require an active human account.');const method=req.method,d=['POST','PATCH'].includes(method)?await body(req):{};
    if(invitations){
      if(!invitations[1]&&method==='GET'){json(res,200,{items:state.groupInvites.filter(i=>i.userId===me.id&&pending(i)&&state.conversations.some(c=>c.id===i.groupId&&c.members.length&&!c.members.includes(me.id))).filter(i=>{const c=state.conversations.find(c=>c.id===i.groupId);return !c.members.some(id=>blocked(userById(id),me));}).map(inviteView)});return true;}
      if(method!=='POST'||!invitations[1])fail(405,'Method not allowed.');keys(d,['confirmHistory']);if(invitations[2]==='accept'&&d.confirmHistory===true){const accepted=state.groupInvites.find(i=>i.id===invitations[1]&&i.userId===me.id&&i.status==='accepted'),joined=accepted&&state.conversations.find(c=>c.id===accepted.groupId&&c.kind==='group'&&c.members.includes(me.id));if(joined){json(res,200,view(joined));return true;}}const i=state.groupInvites.find(i=>i.id===invitations[1]&&i.userId===me.id&&pending(i)),c=i&&state.conversations.find(c=>c.id===i.groupId&&c.kind==='group'&&c.members.length);if(!i||!c)fail(404,'Invitation not found or expired.');
      if(invitations[2]==='decline'){i.status='declined';return commit(c,res,{ok:true});}
      if(d.confirmHistory!==true)fail(400,'Confirm that group members and existing history will be visible before joining.');if(c.members.some(id=>blocked(userById(id),me)))fail(403,'A blocked participant is in this group.');if(c.members.length>=cap(c))fail(409,'This group is full. Ask the owner to free a place.');if(!c.members.includes(me.id)){c.members.push(me.id);me.readState[c.id]={sequence:state.messageSequence,version:(me.readState[c.id]?.version||0)+1};me.activityRevision++;c.revision++;}i.status='accepted';return commit(c,res,view(c));
    }
    const [,id,action,targetId]=route;
    if(!id){
      if(method==='GET'){json(res,200,{items:state.conversations.filter(c=>c.kind==='group'&&c.members.includes(me.id)).map(view)});return true;}
      if(method!=='POST')fail(405,'Method not allowed.');keys(d,['name','topic','color','memberIds','nonce']);const name=text(d.name,60,true),topic=text(d.topic||'',240),color=d.color||'#55e6bc';if(!/^#[a-f0-9]{6}$/i.test(color)||typeof d.nonce!=='string'||!/^[a-f0-9-]{36}$/i.test(d.nonce))fail(400,'Choose a color and valid request identifier.');
      const ids=d.memberIds||[];if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string')||ids.length>(activePremium(me)?19:9))fail(400,'Choose up to '+(activePremium(me)?19:9)+' people.');const request=JSON.stringify({name,topic,color,ids:[...ids].sort()}),duplicate=state.conversations.find(c=>c.kind==='group'&&c.createdBy===me.id&&c.nonce===d.nonce);if(duplicate){if(duplicate.request!==request||!duplicate.members.includes(me.id))fail(409,'This request identifier was already used.');json(res,200,view(duplicate));return true;}
      rate('group-create:'+me.id,5,3600000);if(state.conversations.filter(c=>c.kind==='group'&&c.ownerId===me.id).length>=30||state.conversations.filter(c=>c.kind==='group').length>=5000)fail(400,'The group creation limit has been reached.');
      if(state.groupInvites.length+ids.length>50000)fail(400,'The invitation storage limit has been reached.');
      const c={id:'group-'+randomUUID(),kind:'group',name,topic,color,ownerId:me.id,createdBy:me.id,members:[me.id],revision:0,createdAt:Date.now(),nonce:d.nonce,request};for(const id of ids)inviteTarget(c,me,id);state.conversations.push(c);for(const id of ids)addInvite(c,me,id);return commit(c,res,view(c),201);
    }
    const c=group(id,me);
    if(!action&&method==='GET'){json(res,200,view(c));return true;}
    if(!action&&method==='PATCH'){owner(c,me);keys(d,['revision','name','topic','color','ownerId']);version(c,d);const next={};if(d.name!==undefined)next.name=text(d.name,60,true);if(d.topic!==undefined)next.topic=text(d.topic,240);if(d.color!==undefined){if(!/^#[a-f0-9]{6}$/i.test(d.color))fail(400,'Choose a valid color.');next.color=d.color;}if(d.ownerId!==undefined){if(!c.members.includes(d.ownerId)||!human(userById(d.ownerId)))fail(400,'Choose an active current member as owner.');next.ownerId=d.ownerId;}Object.assign(c,next);c.revision++;return commit(c,res,view(c));}
    if(action==='invites'){
      owner(c,me);if(method==='GET'&&!targetId){json(res,200,{items:state.groupInvites.filter(i=>i.groupId===c.id&&pending(i)).map(i=>({id:i.id,userId:i.userId,name:userById(i.userId)?.displayName||'Member',expiresAt:i.expiresAt}))});return true;}
      if(method==='DELETE'&&targetId){const i=state.groupInvites.find(i=>i.id===targetId&&i.groupId===c.id&&pending(i));if(!i)fail(404,'Invitation not found.');i.status='cancelled';return commit(c,res,{ok:true});}
      if(method==='POST'&&!targetId){keys(d,['userId']);inviteTarget(c,me,d.userId);rate('group-invite:'+me.id,15,60000);const i=addInvite(c,me,d.userId);return commit(c,res,{id:i.id,expiresAt:i.expiresAt},201);}
    }
    if(action==='members'&&targetId&&method==='DELETE'){owner(c,me);if(targetId===me.id)fail(400,'Use Leave Group to leave.');if(!c.members.includes(targetId))fail(404,'Member not found.');c.members=c.members.filter(id=>id!==targetId);c.revision++;return commit(c,res,view(c));}
    if(action==='leave'&&!targetId&&method==='POST'){keys(d,['revision']);version(c,d);if(c.ownerId===me.id&&c.members.length>1)fail(409,'Transfer ownership to another member before leaving.');c.members=c.members.filter(id=>id!==me.id);c.revision++;if(!c.members.length){c.ownerId=null;c.closedAt=Date.now();for(const i of state.groupInvites.filter(i=>i.groupId===c.id&&pending(i)))i.status='cancelled';}return commit(c,res,{ok:true});}
    fail(405,'Method not allowed.');
  }
  const overview=me=>({groups:state.conversations.filter(c=>c.kind==='group'&&c.members.includes(me.id)).length,invitations:state.groupInvites.filter(i=>i.userId===me.id&&pending(i)&&state.conversations.some(c=>c.id===i.groupId&&c.members.length&&!c.members.some(id=>blocked(userById(id),me)))).length});
  return {handle,view,overview};
}
