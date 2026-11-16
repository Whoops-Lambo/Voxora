import {randomUUID} from 'node:crypto';
import {administrator,permissionOverwrites,roleRank} from './public/permissions.js';
import {boostSummary,premiumPerks} from './premium.js';
export function recoveryService({state,body,json,fail,save,refresh,management,cleanupFiles}){
 state.recycleBin||=[];
 const filesOf=p=>[...(p.files||[]),...(p.message?.files||[]),...(p.message?.emojiAssets||[]).map(e=>e.fileId),...(p.messages||[]).flatMap(m=>[...(m.files||[]),...(m.emojiAssets||[]).map(e=>e.fileId)]),...(p.threadMessages||[]).flatMap(m=>[...(m.files||[]),...(m.emojiAssets||[]).map(e=>e.fileId)])].map(f=>typeof f==='string'?f:f.id);
 const retainedFiles=()=>new Set(state.recycleBin.flatMap(e=>filesOf(e.payload)));
 function record(s,actor,kind,payload){
  if(!s)return;const days=Math.max(boostSummary(state,s).recoveryDays,premiumPerks(state.users.find(u=>u.id===s.ownerId)).recoveryDays);
  const copy=structuredClone(payload);
  if(copy.channel){copy.channel.overwrites=structuredClone(permissionOverwrites(s,copy.channel));copy.channel.permissionSynced=false;}
  state.recycleBin.push({id:randomUUID(),serverId:s.id,kind,name:copy.channel?.name||copy.role?.name||copy.message?.text?.slice(0,80)||copy.thread?.name||kind,deletedBy:actor?.id||null,deletedAt:Date.now(),expiresAt:Date.now()+days*86400000,payload:copy});
  management?.log(s,actor||{id:null,displayName:'Voxora'},'Content moved to recovery',kind);
 }
 async function handle(req,res,url,me){
  const m=url.pathname.match(/^\/api\/servers\/([\w-]+)\/recovery(?:\/([\w-]+))?$/);if(!m)return false;
  const d=req.method==='POST'?await body(req):{};const s=state.servers.find(s=>s.id===m[1]&&s.members.includes(me.id));
  if(!s||!administrator(s,me.id))fail(403,'Only server owners and administrators can manage recovery.');
  if(req.method==='GET'&&!m[2]){json(res,200,{items:state.recycleBin.filter(e=>e.serverId===s.id&&e.expiresAt>Date.now()).map(({payload,...e})=>e)});return true;}
  const e=state.recycleBin.find(e=>e.id===m[2]&&e.serverId===s.id&&e.expiresAt>Date.now());if(!e)fail(404,'Recovery item not found or expired.');
  if(req.method==='DELETE'){state.recycleBin=state.recycleBin.filter(x=>x!==e);management.log(s,me,'Recovery item permanently deleted',e.name);await save();cleanupFiles(filesOf(e.payload));refresh();json(res,200,{ok:true});return true;}
  if(req.method!=='POST'||d.action!=='restore')fail(400,'Choose Restore.');
  const p=structuredClone(e.payload);
  const messages=p.messages||[p.message].filter(Boolean),threads=p.threads||[p.thread].filter(Boolean),replies=p.threadMessages||[];
  const channel=p.channel||s.channels.find(c=>c.id===(p.channelId||messages[0]?.channel||threads[0]?.channelId));
  if(p.role){if(me.id!==s.ownerId&&p.role.position>=roleRank(s,me.id))fail(403,'You can restore roles only below your highest role.');if(s.roles.some(r=>r.id===p.role.id)||s.roles.length>=100)fail(409,'Role already exists or role capacity was reached.');}
  else{
   if(!channel)fail(409,'Restore the parent channel first.');
   if(threads.some(t=>t.channelId!==channel.id||![...state.messages,...messages].some(m=>m.id===t.parentId&&m.channel===channel.id))||replies.some(m=>m.channel!==channel.id||![...state.threads,...threads].some(t=>t.id===m.threadId&&t.channelId===channel.id)))fail(409,'Restore the parent thread first.');
   if(p.channel&&(state.servers.some(s=>s.channels.some(c=>c.id===channel.id))||s.channels.length>=500))fail(409,'Channel already exists or channel capacity was reached.');
   if(messages.some(m=>[...state.messages,...state.threadMessages].some(x=>x.id===m.id))||threads.some(t=>state.threads.some(x=>x.id===t.id))||replies.some(m=>[...state.messages,...state.threadMessages].some(x=>x.id===m.id)))fail(409,'Some content already exists. Nothing was restored.');
  }
  if(p.role){const index=Math.max(1,Math.min(p.role.position,s.roles.length));s.roles.splice(index,0,p.role);s.roles.forEach((r,i)=>r.position=i);}
  if(p.channel){const category=s.categories.find(c=>c.id===channel.categoryId);channel.categoryId=category?.id||null;channel.category=category?.name||'';channel.permissionSynced=false;s.channels.push(channel);}
  for(const m of messages){m.sequence=++state.messageSequence;m.restoredAt=Date.now();state.messages.push(m);}
  for(const t of threads)if(state.messages.some(m=>m.id===t.parentId))state.threads.push(t);
  for(const m of replies)if(state.threads.some(t=>t.id===m.threadId)){m.sequence=++state.threadMessageSequence;state.threadMessages.push(m);}
  state.recycleBin=state.recycleBin.filter(x=>x!==e);management.log(s,me,'Content restored',e.name);await management.commit(s);json(res,200,{ok:true});return true;
 }
 async function sweep(){const expired=state.recycleBin.filter(e=>e.expiresAt<=Date.now());if(!expired.length)return;state.recycleBin=state.recycleBin.filter(e=>!expired.includes(e));await save();cleanupFiles(expired.flatMap(e=>filesOf(e.payload)));}
 function recordMessage(m,actor){const s=state.servers.find(s=>s.channels.some(c=>c.id===m.channel));if(m.threadId)record(s,actor,'message',{channelId:m.channel,threadMessages:[m]});else record(s,actor,'message',{message:m,threads:state.threads.filter(t=>t.parentId===m.id),threadMessages:state.threadMessages.filter(x=>state.threads.some(t=>t.parentId===m.id&&t.id===x.threadId))});}
 return {record,recordMessage,handle,sweep,retainedFiles};
}
