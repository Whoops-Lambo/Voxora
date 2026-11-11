import {taskPlanSummary,taskCompletionBlocked} from './planning.js';
import {randomUUID,randomInt} from 'node:crypto';
import {serverPermissions} from './public/permissions.js';
import {isSuspended} from './platform.js';
export function initializeStudio(state){state.projectTasks||=[];state.giveaways||=[];}
export function studioService({state,body,json,fail,save,canRead,canChannel,userById,management,notify,onTaskChange}){
 const keys=(d,allowed)=>{if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!allowed.includes(k)))fail(400,'Unsupported community tool field.');};
 const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||required&&!value.trim())fail(400,'Enter '+(required?'nonempty ':'')+'text up to '+max+' characters.');return value.trim();};
 const visible=(me,channel,o={})=>canRead(me,channel)&&(!o.allowed||o.allowed(channel));
 function server(id,me){const s=state.servers.find(s=>s.id===id&&s.members.includes(me.id));if(!s||isSuspended(me))fail(404,'Community not found.');return s;}
 function channel(s,me,id,o={}){const c=s.channels.find(c=>c.id===id&&c.type==='text');if(!c||!visible(me,id,o))fail(403,'Choose a text channel you can view.');return c;}
 function requireWrite(me,cid,permission,o){o.authorize?.(cid,permission);if(!canChannel(me,cid,permission))fail(403,'You need '+permission+' in this channel.');}
 const version=(item,d)=>{if(!Number.isSafeInteger(d.revision)||item.revision!==d.revision)fail(409,'This item changed. Refresh it before saving.');};
 const memberName=(s,id)=>s.members.includes(id)?s.nicknames[id]||userById(id)?.displayName||'Member':'Former member';
 function taskView(s,t,me,o={}){const source=t.sourceId&&state.messages.find(m=>m.id===t.sourceId&&m.channel===t.channelId);return {...t,nonce:undefined,request:undefined,assignee:t.assigneeId&&s.members.includes(t.assigneeId)?{id:t.assigneeId,name:memberName(s,t.assigneeId)}:null,source:t.sourceId?{id:t.sourceId,channel:t.channelId,available:!!source,text:source?.text.slice(0,180)||''}:null,canEdit:canChannel(me,t.channelId,'sendMessages')&&(t.createdBy===me.id||canChannel(me,t.channelId,'manageProjects')),canMove:canChannel(me,t.channelId,'sendMessages')&&(t.createdBy===me.id||t.assigneeId===me.id||canChannel(me,t.channelId,'manageProjects')),comments:t.comments.map(c=>({...c,author:memberName(s,c.authorId)})),...taskPlanSummary(state,t,me,(user,cid)=>visible(user,cid,o))};}
 function eligible(s,g,u){return !!(u&&!u.bot&&!isSuspended(u)&&s.members.includes(u.id)&&canRead(u,g.channelId)&&canChannel(u,g.channelId,'sendMessages')&&(!g.requiredRoleId||s.memberRoles[u.id]?.includes(g.requiredRoleId)));}
 function giveawayView(s,g,me){if(g._finalizing)g={...g,...g._finalizing};return {id:g.id,serverId:g.serverId,channelId:g.channelId,title:g.title,description:g.description,winnerCount:g.winnerCount,endsAt:g.endsAt,status:g.status,revision:g.revision,createdAt:g.createdAt,endedAt:g.endedAt,requiredRoleId:g.requiredRoleId,entryCount:g.entryIds.filter(id=>eligible(s,g,userById(id))).length,entered:g.entryIds.includes(me.id),canEnter:g.status==='active'&&g.endsAt>Date.now()&&eligible(s,g,me),canManage:canChannel(me,g.channelId,'manageGiveaways'),winners:g.winnerIds.map(id=>({id:s.members.includes(id)?id:null,name:memberName(s,id)}))};}
 function taskFields(s,me,d,old,o){
  const next={title:d.title===undefined?old?.title:d.title,description:d.description===undefined?old?.description||'':d.description,channelId:old?.channelId||d.channelId,status:d.status===undefined?old?.status||'todo':d.status,priority:d.priority===undefined?old?.priority||'normal':d.priority,assigneeId:d.assigneeId===undefined?old?.assigneeId||null:d.assigneeId,dueAt:d.dueAt===undefined?old?.dueAt||null:d.dueAt,labels:d.labels===undefined?old?.labels||[]:d.labels};
  channel(s,me,next.channelId,o);next.title=text(next.title,120,true);next.description=text(next.description,4000);
  if(!['todo','doing','done'].includes(next.status)||!['low','normal','high'].includes(next.priority))fail(400,'Invalid task status or priority.');
  if(next.assigneeId!==null&&(!s.members.includes(next.assigneeId)||!userById(next.assigneeId)||!canRead(userById(next.assigneeId),next.channelId)))fail(400,'Choose a member who can view this channel.');
  if(next.assigneeId&&(old?.dependencyIds||[]).some(id=>{const task=state.projectTasks.find(t=>t.id===id);return task&&!canRead(userById(next.assigneeId),task.channelId);}))fail(400,'Choose an assignee who can read every dependency.');
  if(next.dueAt!==null&&(!Number.isSafeInteger(next.dueAt)||next.dueAt<0||next.dueAt>Date.now()+366*86400000))fail(400,'Choose a due date within the next year.');
  if(!Array.isArray(next.labels)||next.labels.length>5||next.labels.some(l=>typeof l!=='string'||!l.trim()||l.length>20))fail(400,'Use up to five labels of 20 characters.');next.labels=[...new Set(next.labels.map(l=>l.trim()))];return next;
 }
 async function commit(s,item,me,action){if(action)management.log(s,me,action,item.id);if(action?.startsWith('Project task'))onTaskChange?.(s,item,me,action);await save();notify(s.id,item.channelId);}
 function finish(s,g,actor){
  if(g.status!=='active')return false;const pool=g.entryIds.filter(id=>eligible(s,g,userById(id)));
  for(let i=pool.length-1;i>0;i--){const j=randomInt(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
  g.drawResult ||= {winnerIds:pool.slice(0,g.winnerCount),endedAt:Date.now()};
  g.winnerIds=[...g.drawResult.winnerIds];g.status='ended';g.endedAt=g.drawResult.endedAt;g.revision++;management.log(s,actor,'Giveaway ended',g.id);return true;
 }
 async function finalize(s,g,actor,cancel=false){
  if(g._finalizing)fail(409,'This giveaway is being saved. Try again shortly.');
  const before={status:g.status,revision:g.revision,endedAt:g.endedAt,winnerIds:[...g.winnerIds]},audits=new Set(s.auditLog.map(a=>a.id));
  Object.defineProperty(g,'_finalizing',{value:before,configurable:true});let added=[];
  try{
   if(cancel){g.status='cancelled';g.revision++;g.endedAt=Date.now();management.log(s,actor,'Giveaway cancelled',g.id);}else finish(s,g,actor);
   added=s.auditLog.filter(a=>!audits.has(a.id)).map(a=>a.id);await save();
  }catch(error){Object.assign(g,before);s.auditLog=s.auditLog.filter(a=>!added.includes(a.id));throw error;}
  finally{delete g._finalizing;}
  notify(g.serverId,g.channelId);
 }
 function insights(s,me,o,days){
  if(!serverPermissions(s,me.id).some(p=>['viewInsights','manageServer'].includes(p)))fail(403,'You need View Community Insights.');
  const now=Date.now(),today=new Date(now),start=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate());
  const channels=s.channels.filter(c=>visible(me,c.id,o)),ids=new Set(channels.map(c=>c.id)),since=start-(days-1)*86400000;
  const messages=[...state.messages,...state.threadMessages].filter(m=>ids.has(m.channel)&&m.time>=since&&m.time<=now),people=new Set(messages.filter(m=>userById(m.authorId)&&!userById(m.authorId).bot).map(m=>m.authorId).filter(Boolean));
  const daily=Array.from({length:days},(_,i)=>({date:new Date(start-(days-1-i)*86400000).toISOString().slice(0,10),messages:0}));for(const m of messages){const d=daily.find(d=>d.date===new Date(m.time).toISOString().slice(0,10));if(d)d.messages++;}
  return {days,generatedAt:Date.now(),totals:{messages:messages.length,activePeople:people.size,members:s.members.filter(id=>!userById(id)?.bot).length,bots:s.members.filter(id=>userById(id)?.bot).length,threads:state.threads.filter(t=>ids.has(t.channelId)).length,completedTasks:state.projectTasks.filter(t=>t.serverId===s.id&&ids.has(t.channelId)&&t.status==='done').length},daily,channels:channels.filter(c=>c.type==='text').map(c=>({id:c.id,name:c.name,messages:messages.filter(m=>m.channel===c.id).length})).sort((a,b)=>b.messages-a.messages).slice(0,10)};
 }
 function home(me){const tasks=state.projectTasks.filter(t=>t.assigneeId===me.id&&!t.archived&&t.status!=='done'&&state.servers.some(s=>s.id===t.serverId&&s.members.includes(me.id))&&canRead(me,t.channelId)).sort((a,b)=>(a.dueAt||Infinity)-(b.dueAt||Infinity));const giveaways=state.giveaways.filter(g=>g.status==='active'&&g.endsAt>Date.now()&&state.servers.some(s=>s.id===g.serverId&&s.members.includes(me.id))&&canRead(me,g.channelId)).sort((a,b)=>a.endsAt-b.endsAt);return {assignedCount:tasks.length,assigned:tasks.slice(0,6).map(t=>({id:t.id,title:t.title,status:t.status,priority:t.priority,dueAt:t.dueAt,serverId:t.serverId,serverName:state.servers.find(s=>s.id===t.serverId).name})),giveaways:giveaways.slice(0,4).map(g=>({id:g.id,title:g.title,endsAt:g.endsAt,serverId:g.serverId,serverName:state.servers.find(s=>s.id===g.serverId).name}))};}
 async function handle(req,res,url,me,o={}){
  const route=url.pathname.replace('/api/bot/','/api/'),match=route.match(/^\/api\/servers\/([\w-]+)\/studio(?:\/(tasks|giveaways|insights)(?:\/([\w-]+)(?:\/(enter|leave|end|cancel))?)?)?$/);
  if(!match)return false;
  const method=req.method,d=o.data??(['POST','PATCH'].includes(method)?await body(req):{}),s=server(match[1],me),kind=match[2],id=match[3],action=match[4];
  if(!kind&&method==='GET'){json(res,200,{serverId:s.id,channels:s.channels.filter(c=>c.type==='text'&&visible(me,c.id,o)).map(c=>({id:c.id,name:c.name,canCreate:canChannel(me,c.id,'sendMessages'),canGiveaway:canChannel(me,c.id,'manageGiveaways')})),tasks:state.projectTasks.filter(t=>t.serverId===s.id&&!t.archived&&visible(me,t.channelId,o)).length,giveaways:state.giveaways.filter(g=>g.serverId===s.id&&g.status==='active'&&visible(me,g.channelId,o)).length,canInsights:serverPermissions(s,me.id).some(p=>['viewInsights','manageServer'].includes(p))});return true;}
  if(kind==='insights'&&method==='GET'&&!id){const days=Number(url.searchParams.get('days')||7);if(![7,30].includes(days))fail(400,'Choose 7 or 30 days.');json(res,200,insights(s,me,o,days));return true;}
  if(!['tasks','giveaways'].includes(kind))fail(405,'Method not allowed.');
  const list=kind==='tasks'?state.projectTasks:state.giveaways,item=id&&list.find(t=>t.id===id&&t.serverId===s.id&&visible(me,t.channelId,o));
  if(id&&!item)fail(404,'Community item not found.');
  if(item?._finalizing&&method!=='GET')fail(409,'This giveaway is being saved. Try again shortly.');
  const view=t=>kind==='tasks'?taskView(s,t,me,o):giveawayView(s,t,me);
  if(method==='GET'){
   if(id){json(res,200,view(item));return true;}
   const q=(url.searchParams.get('q')||'').toLowerCase(),offset=Number(url.searchParams.get('offset')||0),status=url.searchParams.get('status')||'all',cid=url.searchParams.get('channel'),assigned=url.searchParams.get('assigned')==='me';
   if(q.length>100||!Number.isSafeInteger(offset)||offset<0||!(kind==='tasks'?['all','todo','doing','done','archived']:['all','active','ended','cancelled']).includes(status))fail(400,'Invalid community filter.');
   const items=list.filter(t=>t.serverId===s.id&&visible(me,t.channelId,o)&&(!cid||t.channelId===cid)&&t.title.toLowerCase().includes(q)&&(status==='archived'?t.archived:kind==='tasks'?!t.archived&&(status==='all'||t.status===status):status==='all'||t.status===status)&&(!assigned||t.assigneeId===me.id)).sort((a,b)=>b.createdAt-a.createdAt);
   json(res,200,{items:items.slice(offset,offset+100).map(view),total:items.length,hasMore:offset+100<items.length,offset});return true;
  }
  if(!id&&method==='POST'){
   keys(d,kind==='tasks'?['title','description','channelId','status','priority','assigneeId','dueAt','labels','sourceId','nonce']:['title','description','channelId','endsAt','winnerCount','requiredRoleId','nonce']);
   channel(s,me,d.channelId,o);requireWrite(me,d.channelId,kind==='tasks'?'sendMessages':'manageGiveaways',o);o.post?.();
   if(list.filter(t=>t.serverId===s.id).length>=500)fail(400,'This community has reached 500 items. Delete old tasks or closed giveaway history to make room.');
   if(d.nonce!==undefined&&(typeof d.nonce!=='string'||!/^[a-f0-9-]{36}$/.test(d.nonce)))fail(400,'Invalid request nonce.');
   const request=JSON.stringify(Object.fromEntries(Object.keys(d).sort().map(key=>[key,d[key]]))),duplicate=d.nonce&&list.find(t=>t.serverId===s.id&&t.createdBy===me.id&&t.nonce===d.nonce);if(duplicate){if(duplicate.request!==request)fail(409,'This request nonce was already used.');await save();json(res,200,view(duplicate));return true;}
   let next;
   if(kind==='tasks'){
    const fields=taskFields(s,me,d,null,o);if(d.sourceId!==undefined&&!state.messages.some(m=>m.id===d.sourceId&&m.channel===d.channelId))fail(404,'Source message not found.');
    next={...fields,sourceId:d.sourceId||null,archived:false,comments:[]};
   }else{
    const endsAt=d.endsAt,winnerCount=d.winnerCount??1,requiredRoleId=d.requiredRoleId||null;
    if(!Number.isSafeInteger(endsAt)||endsAt<Date.now()+1000||endsAt>Date.now()+366*86400000||!Number.isSafeInteger(winnerCount)||winnerCount<1||winnerCount>10)fail(400,'Choose 1–10 winners and an end time within a year.');
    if(requiredRoleId&&!s.roles.some(r=>r.id===requiredRoleId&&r.id!=='everyone'))fail(400,'Choose an existing eligibility role.');
    next={title:text(d.title,120,true),description:text(d.description??'',2000),channelId:d.channelId,endsAt,winnerCount,requiredRoleId,status:'active',entryIds:[],winnerIds:[],endedAt:null};
   }
   Object.assign(next,{id:randomUUID(),serverId:s.id,createdBy:me.id,createdAt:Date.now(),updatedAt:Date.now(),revision:0,nonce:d.nonce,request});list.push(next);await commit(s,next,me,kind==='tasks'?'Project task created':'Giveaway created');json(res,201,view(next));return true;
  }
  if(kind==='tasks'&&id&&!action&&method==='PATCH'){
   keys(d,['revision','title','description','status','priority','assigneeId','dueAt','labels','archived','comment']);version(item,d);requireWrite(me,item.channelId,'sendMessages',o);
   const editor=item.createdBy===me.id||canChannel(me,item.channelId,'manageProjects');
   if(d.comment!==undefined){if(Object.keys(d).some(k=>!['revision','comment'].includes(k)))fail(400,'Post a comment separately from task edits.');if(item.comments.length>=100)fail(400,'This task has reached 100 comments.');item.comments.push({id:randomUUID(),authorId:me.id,text:text(d.comment,1000,true),time:Date.now()});}
   else{if(item.createdBy!==me.id&&editor)requireWrite(me,item.channelId,'manageProjects',o);if(!editor&&(item.assigneeId!==me.id||Object.keys(d).some(k=>!['revision','status'].includes(k))))fail(403,'Only the creator or a project manager can edit task details. Assignees may change status.');const patch=taskFields(s,me,d,item,o);if(d.archived!==undefined&&(!editor||typeof d.archived!=='boolean'))fail(403,'Only a project manager or creator can archive a task.');if(patch.status==='done'&&taskCompletionBlocked(state,item))fail(409,'Complete this task’s dependencies first.');Object.assign(item,patch,...(d.archived===undefined?[]:[{archived:d.archived}]));}
   item.revision++;item.updatedAt=Date.now();await commit(s,item,me,'Project task updated');json(res,200,view(item));return true;
  }
  if(kind==='tasks'&&id&&!action&&method==='DELETE'){
   if(!url.searchParams.has('revision'))fail(409,'Refresh this item before deleting.');version(item,{revision:Number(url.searchParams.get('revision'))});requireWrite(me,item.channelId,'sendMessages',o);if(item.createdBy!==me.id)requireWrite(me,item.channelId,'manageProjects',o);state.projectTasks=list.filter(t=>t!==item);await commit(s,item,me,'Project task deleted');json(res,200,{ok:true});return true;
  }
  if(kind==='giveaways'&&id&&method==='DELETE'&&!action){requireWrite(me,item.channelId,'manageGiveaways',o);if(!url.searchParams.has('revision'))fail(409,'Refresh before deleting.');version(item,{revision:Number(url.searchParams.get('revision'))});if(item.status==='active')fail(409,'Cancel or end this giveaway before deleting its history.');state.giveaways=list.filter(g=>g!==item);await commit(s,item,me,'Giveaway history deleted');json(res,200,{ok:true});return true;}
  if(kind==='giveaways'&&id&&method==='POST'){
   if(['enter','leave'].includes(action)){
    keys(d,[]);if(me.bot)fail(403,'Only human accounts can enter giveaways.');if(item.status!=='active'||item.endsAt<=Date.now())fail(409,'This giveaway is closed.');if(action==='enter'&&!eligible(s,item,me))fail(403,'You are not eligible to enter this giveaway.');
    item.entryIds=action==='enter'?[...new Set([...item.entryIds,me.id])]:item.entryIds.filter(id=>id!==me.id);await commit(s,item,me);json(res,200,view(item));return true;
   }
   if(['end','cancel'].includes(action)){
    keys(d,['revision']);version(item,d);requireWrite(me,item.channelId,'manageGiveaways',o);if(item.status!=='active')fail(409,'This giveaway is already closed.');
    await finalize(s,item,me,action==='cancel');json(res,200,view(item));return true;
   }
  }
  fail(405,'Method not allowed.');
 }
 let sweeping=false;
 async function sweep(){if(sweeping)return;sweeping=true;try{let changed=false;for(const g of state.giveaways.filter(g=>g.status==='active'&&g.endsAt<=Date.now()).slice(0,50)){const s=state.servers.find(s=>s.id===g.serverId);if(!s||!s.channels.some(c=>c.id===g.channelId)){g.status='cancelled';g.revision++;changed=true;continue;}await finalize(s,g,{id:null,displayName:'Voxora'});}if(changed)await save();}finally{sweeping=false;}}
 return {handle,home,sweep};
}
