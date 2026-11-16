import {randomUUID} from 'node:crypto';
import {copyFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {administrator,channelPermissions} from './public/permissions.js';
export function threadTransferService({state,dataDir,body,json,fail,save,refresh,management,forums,userById}){
 const busy=new Set();
 async function handle(req,res,url,me){
  const match=url.pathname.match(/^\/api\/threads\/([\w-]+)\/transfer$/);if(!match)return false;if(req.method!=='POST')fail(405,'Method not allowed.');
  const d=await body(req),t=state.threads.find(t=>t.id===match[1]),s=t&&state.servers.find(s=>s.channels.some(c=>c.id===t.channelId)),parent=t&&state.messages.find(m=>m.id===t.parentId);
  if(!s||!parent||!s.members.includes(me.id)||!['move','merge'].includes(d.action))fail(404,'Thread or action unavailable.');
  if(busy.has(t.id))fail(409,'This thread is already being transferred.');
  const target=d.action==='merge'?state.threads.find(x=>x.id===d.targetId&&x.id!==t.id):null,destination=d.action==='merge'?s.channels.find(c=>c.id===target?.channelId):s.channels.find(c=>c.id===d.channelId&&c.type==='text');
  const can=(channel)=>['viewChannel','manageThreads'].every(p=>channelPermissions(s,me.id,channel).includes(p));
  const check=()=>{
   if(!state.threads.includes(t)||!state.messages.includes(parent)||!destination||destination.archived||!can(t.channelId)||!can(destination.id)||d.action==='merge'&&(!target||!state.threads.includes(target)||target.archived||target.locked))fail(403,'Manage Threads and visibility are required in both active channels.');
   const widened=s.members.some(id=>!channelPermissions(s,id,t.channelId).includes('viewChannel')&&channelPermissions(s,id,destination.id).includes('viewChannel'));
   if(widened&&(!administrator(s,me.id)||d.confirmAudienceChange!==true))fail(403,'An administrator must explicitly confirm expanding the audience for this history.');
  };check();
  if(d.action==='move'&&destination.id===t.channelId)fail(400,'Choose another channel.');
  const draft=d.action==='move'&&destination.forum?forums.prepare(me,{channel:destination.id,text:parent.text,files:parent.files,forumPost:{title:t.name,tagIds:d.tagIds||[]}}):null;
  const source=()=>[parent,...state.threadMessages.filter(m=>m.threadId===t.id)],fingerprint=()=>JSON.stringify([t.name,t.channelId,t.archived,t.locked,source().map(m=>[m.id,m.text,m.editedAt,m.files])]);
  const before=fingerprint(),messages=source().map(m=>structuredClone(m)),fileIds=[...new Set(messages.flatMap(m=>[...(m.files||[]),...(m.emojiAssets||[]).map(e=>e.fileId)]))],copies=[],mapping=new Map();
  if(fileIds.length>5000)fail(400,'Transfer at most 5,000 attachments at once.');
  busy.add(t.id);
  try{
   for(const id of fileIds){const f=state.files.find(f=>f.id===id&&f.channel===t.channelId);if(!f)fail(409,'An attachment is no longer available.');const copy={...f,id:randomUUID(),channel:destination.id};await copyFile(path.join(dataDir,'uploads',id),path.join(dataDir,'uploads',copy.id));copies.push(copy);mapping.set(id,copy.id);}
   check();if(before!==fingerprint())fail(409,'The source thread changed during transfer. Retry after reviewing it.');
   for(const m of messages){m.channel=destination.id;m.files=(m.files||[]).map(id=>mapping.get(id)||id);if(m.emojiAssets)m.emojiAssets=m.emojiAssets.map(e=>({...e,fileId:mapping.get(e.fileId)||e.fileId}));m.mentions={recipients:[],references:[]};m.replyTo=null;m.transferredAt=Date.now();}
   const from=t.channelId;
   if(d.action==='move'){
    const replacement=messages[0];if(draft)replacement.forumPost={tagIds:draft.tagIds};else delete replacement.forumPost;
    replacement.sequence=++state.messageSequence;Object.assign(parent,replacement);t.channelId=destination.id;t.lastActivityAt=Date.now();
    for(const m of messages.slice(1)){const current=state.threadMessages.find(x=>x.id===m.id);Object.assign(current,m,{sequence:++state.threadMessageSequence});}
   }else{
    const additions=messages.map(m=>{delete m.forumPost;delete m.command;return{...m,threadId:target.id,sequence:++state.threadMessageSequence};});
    state.messages=state.messages.filter(m=>m!==parent);state.threadMessages=state.threadMessages.filter(m=>m.threadId!==t.id);state.threadMessages.push(...additions);state.threads=state.threads.filter(x=>x!==t);target.lastActivityAt=Date.now();
    state.threadTransfers||=[];state.threadTransfers.push({from:t.id,to:target.id,time:Date.now()});state.threadTransfers=state.threadTransfers.slice(-5000);
   }
   state.files.push(...copies);management.log(s,me,d.action==='move'?'Thread moved':'Threads merged',t.name,from+' → '+destination.id);await save();refresh();json(res,200,{ok:true,threadId:target?.id||t.id,channelId:destination.id});return true;
  }catch(e){
   // If the new references are already attached, retain bytes for persistence recovery.
   for(const f of copies)if(!state.files.includes(f))await unlink(path.join(dataDir,'uploads',f.id)).catch(()=>{});
   throw e;
  }finally{busy.delete(t.id);}
 }
 return{handle};
}
