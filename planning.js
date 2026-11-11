import {randomUUID} from 'node:crypto';
import {isSuspended} from './platform.js';

export function taskPlanSummary(state,task,me,canRead){
  const dependencies=(task.dependencyIds||[]).map(id=>state.projectTasks.find(t=>t.id===id));
  return {checklist:task.checklist||[],checklistDone:(task.checklist||[]).filter(i=>i.done).length,dependencyIds:undefined,dependencies:dependencies.map(t=>t&&canRead(me,t.channelId)?{id:t.id,title:t.title,status:t.status,available:true}:{id:null,title:'Unavailable dependency',available:false}),blocked:dependencies.some(t=>!t||t.status!=='done'),watcherIds:undefined,watching:!!task.watcherIds?.includes(me.id),watcherCount:(task.watcherIds||[]).filter(id=>{const u=state.users.find(u=>u.id===id);return u&&!isSuspended(u)&&canRead(u,task.channelId);}).length,milestone:state.milestones?.filter(m=>m.id===task.milestoneId&&canRead(me,m.channelId)).map(m=>({id:m.id,name:m.name,status:m.status}))[0]||null,planActivity:(task.planActivity||[]).map(e=>({...e,actor:state.servers.find(s=>s.id===task.serverId)?.members.includes(e.actorId)?state.users.find(u=>u.id===e.actorId)?.displayName||'Member':'Former member'}))};
}
export function taskCompletionBlocked(state,task){return(task.dependencyIds||[]).some(id=>state.projectTasks.find(t=>t.id===id)?.status!=='done');}
export function calendarFile(entries){
  const escape=v=>String(v).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'),date=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Voxora//Together//EN','CALSCALE:GREGORIAN'];
  for(const e of entries)lines.push('BEGIN:VEVENT','UID:'+e.id+'@voxora','DTSTAMP:'+date(e.createdAt||Date.now()),'DTSTART:'+date(e.startsAt),'DTEND:'+date(e.endsAt),'SUMMARY:'+escape(e.title),'DESCRIPTION:'+escape(e.description||''),'END:VEVENT');lines.push('END:VCALENDAR');
  return lines.map(line=>{const parts=[];let current='';for(const char of line){if(Buffer.byteLength(current+char)>75){parts.push(current);current=' ';}current+=char;}parts.push(current);return parts.join('\r\n');}).join('\r\n')+'\r\n';
}
export function planningService({state,body,json,fail,save,canRead,canChannel,userById,notify,management}){
  state.milestones||=[];
  const keys=(d,allowed)=>{if(Object.keys(d).some(k=>!allowed.includes(k)))fail(400,'Unsupported planning field.');};
  const version=(item,d)=>{if(!Number.isSafeInteger(d.revision)||item.revision!==d.revision)fail(409,'This plan changed. Refresh before saving.');};
  const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||required&&!v.trim())fail(400,'Use '+(required?'nonempty ':'')+'text up to '+max+' characters.');return v.trim();};
  const allowed=(me,channel)=>!!me&&!isSuspended(me)&&canRead(me,channel);
  const editor=(me,t)=>canChannel(me,t.channelId,'sendMessages')&&(t.createdBy===me.id||canChannel(me,t.channelId,'manageProjects'));
  const canMove=(me,t)=>editor(me,t)||canChannel(me,t.channelId,'sendMessages')&&t.assigneeId===me.id;
  const taskView=(t,me)=>({id:t.id,serverId:t.serverId,channelId:t.channelId,title:t.title,status:t.status,priority:t.priority,dueAt:t.dueAt,revision:t.revision,assigneeId:t.assigneeId,canEdit:editor(me,t),canMove:canMove(me,t),...taskPlanSummary(state,t,me,allowed)});
  const milestoneView=(m,me)=>{const tasks=state.projectTasks.filter(t=>t.milestoneId===m.id&&allowed(me,t.channelId));return {...m,taskCount:tasks.length,completed:tasks.filter(t=>t.status==='done').length,canManage:canChannel(me,m.channelId,'manageProjects')&&canChannel(me,m.channelId,'sendMessages')};};
  const human=me=>{if(me.bot||isSuspended(me))fail(403,'Planning requires an active human account.');};
  function updateView(me,u){const task=state.projectTasks.find(t=>t.id===u.taskId&&allowed(me,t.channelId));return task?{id:u.id,taskId:task.id,serverId:task.serverId,title:task.title,action:u.action,time:u.time,read:u.read}:null;}
  function home(me){const updates=(me.planningUpdates||[]).map(u=>updateView(me,u)).filter(Boolean);return{revision:me.planningRevision||0,unread:updates.filter(u=>!u.read).length,updates:updates.slice(0,6),milestones:state.milestones.filter(m=>m.status==='open'&&allowed(me,m.channelId)).sort((a,b)=>(a.dueAt||Infinity)-(b.dueAt||Infinity)).slice(0,4).map(m=>milestoneView(m,me))};}
  function recordChange(server,task,actor,action='Task updated'){
    task.planActivity=[{id:randomUUID(),actorId:actor.id,action,time:Date.now()},...(task.planActivity||[])].slice(0,50);
    for(const id of new Set([task.createdBy,task.assigneeId,...(task.watcherIds||[])])){const u=userById(id);if(!u||u.bot||id===actor.id||!allowed(u,task.channelId)||u.blocked?.includes(actor.id))continue;u.planningUpdates=[{id:randomUUID(),taskId:task.id,action,time:Date.now(),read:false},...(u.planningUpdates||[])].slice(0,100);u.planningRevision=(u.planningRevision||0)+1;}
  }
  async function commit(s,t,me,action){recordChange(s,t,me,action);management.log(s,me,action,t.id);await save();notify(s.id,t.channelId);}
  async function handle(req,res,url,me){
    const own=url.pathname==='/api/me/planning-updates',route=url.pathname.match(/^\/api\/servers\/([\w-]+)\/planning(?:\/(milestones|tasks|calendar)(?:\/([\w-]+)(?:\/(checklist|dependencies|milestone|watch))?)?)?$/);if(!own&&!route)return false;human(me);const method=req.method,d=['POST','PATCH'].includes(method)?await body(req):{};
    if(own){if(method==='GET'){json(res,200,{...home(me),items:(me.planningUpdates||[]).map(u=>updateView(me,u)).filter(Boolean)});return true;}if(method!=='POST')fail(405,'Method not allowed.');keys(d,['revision','all','ids']);version({revision:me.planningRevision||0},d);if(d.all!==true&&(!Array.isArray(d.ids)||d.ids.length>100||d.ids.some(id=>typeof id!=='string')))fail(400,'Choose updates to mark read.');for(const u of me.planningUpdates||[])if(d.all===true||d.ids.includes(u.id))u.read=true;me.planningRevision=(me.planningRevision||0)+1;await save();json(res,200,home(me));return true;}
    const [,serverId,kind,id,action]=route,s=state.servers.find(s=>s.id===serverId&&s.members.includes(me.id));if(!s)fail(404,'Server not found.');
    const channels=s.channels.filter(c=>c.type==='text'&&allowed(me,c.id));
    if(!kind&&method==='GET'){json(res,200,{channels:channels.map(c=>({id:c.id,name:c.name,canManage:canChannel(me,c.id,'manageProjects')&&canChannel(me,c.id,'sendMessages')})),tasks:state.projectTasks.filter(t=>t.serverId===s.id&&!t.archived&&allowed(me,t.channelId)).map(t=>taskView(t,me)),milestones:state.milestones.filter(m=>m.serverId===s.id&&allowed(me,m.channelId)).map(m=>milestoneView(m,me))});return true;}
    if(kind==='calendar'&&method==='GET'&&!id){const entries=[...state.projectTasks.filter(t=>t.serverId===s.id&&!t.archived&&t.dueAt&&allowed(me,t.channelId)).map(t=>({id:t.id,title:'Task due: '+t.title,description:t.description,startsAt:t.dueAt,endsAt:t.dueAt+1800000,createdAt:t.createdAt})),...state.milestones.filter(m=>m.serverId===s.id&&m.dueAt&&allowed(me,m.channelId)).map(m=>({id:m.id,title:'Milestone: '+m.name,description:m.description,startsAt:m.dueAt,endsAt:m.dueAt+1800000,createdAt:m.createdAt}))];res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="Voxora-project-calendar.ics"','Cache-Control':'no-store'});res.end(calendarFile(entries));return true;}
    if(kind==='milestones'){
      const item=id&&state.milestones.find(m=>m.id===id&&m.serverId===s.id&&allowed(me,m.channelId));if(id&&!item)fail(404,'Milestone not found.');if(action)fail(405,'Method not allowed.');
      if(method==='GET'){json(res,200,item?milestoneView(item,me):{items:state.milestones.filter(m=>m.serverId===s.id&&allowed(me,m.channelId)).map(m=>milestoneView(m,me))});return true;}
      const channel=item?.channelId||d.channelId;if(!channels.some(c=>c.id===channel)||!canChannel(me,channel,'manageProjects')||!canChannel(me,channel,'sendMessages'))fail(403,'Manage Projects and Send Messages are required.');
      if(item)version(item,method==='DELETE'?{revision:url.searchParams.has('revision')?Number(url.searchParams.get('revision')):null}:d);
      if(method==='DELETE'&&item){if(state.projectTasks.some(t=>t.milestoneId===item.id))fail(409,'Unassign its tasks before deleting this milestone.');state.milestones=state.milestones.filter(m=>m!==item);management.log(s,me,'Milestone deleted',item.name);await save();notify(s.id,channel);json(res,200,{ok:true});return true;}
      if(!(method==='POST'&&!id||method==='PATCH'&&item))fail(405,'Method not allowed.');keys(d,['revision','channelId','name','description','dueAt','status']);if(item&&d.channelId!==undefined&&d.channelId!==item.channelId)fail(400,'A milestone stays in its original channel.');const next={name:text(d.name??item?.name,100,true),description:text(d.description??item?.description??'',2000),dueAt:d.dueAt===undefined?item?.dueAt||null:d.dueAt,status:d.status??item?.status??'open'};
      if(next.dueAt!==null&&(!Number.isSafeInteger(next.dueAt)||next.dueAt<0||next.dueAt>Date.now()+366*86400000)||!['open','completed'].includes(next.status))fail(400,'Choose an open/completed milestone and valid due date.');if(item&&next.status==='completed'&&state.projectTasks.some(t=>t.milestoneId===item?.id&&t.status!=='done'))fail(409,'Complete the milestone’s tasks first.');if(!item&&state.milestones.filter(m=>m.serverId===s.id).length>=200)fail(400,'This server has reached 200 milestones.');
      const result=item||{id:randomUUID(),serverId:s.id,channelId:channel,revision:-1,createdAt:Date.now()};Object.assign(result,next,{revision:result.revision+1});if(!item)state.milestones.push(result);management.log(s,me,item?'Milestone updated':'Milestone created',result.name);await save();notify(s.id,channel);json(res,item?200:201,milestoneView(result,me));return true;
    }
    if(kind!=='tasks'||!id||!action)fail(405,'Method not allowed.');const t=state.projectTasks.find(t=>t.id===id&&t.serverId===s.id&&allowed(me,t.channelId));if(!t)fail(404,'Task not found.');
    if(action==='watch'&&method==='POST'){keys(d,['watching']);if(typeof d.watching!=='boolean')fail(400,'Choose whether to watch this task.');const watchers=d.watching?[...new Set([...(t.watcherIds||[]),me.id])]:(t.watcherIds||[]).filter(id=>id!==me.id);if(watchers.length>200)fail(400,'This task already has 200 watchers.');t.watcherIds=watchers;await save();json(res,200,taskView(t,me));return true;}
    if(method!=='PATCH')fail(405,'Method not allowed.');version(t,d);if(t.archived)fail(409,'Restore the task before changing its plan.');
    if(action==='checklist'){
      if(!canMove(me,t))fail(403,'Only the creator, assignee or project manager can update the checklist.');keys(d,['revision','items']);if(!Array.isArray(d.items)||d.items.length>30||new Set(d.items.map(i=>i?.id)).size!==d.items.length)fail(400,'Keep up to 30 unique checklist items.');const items=d.items.map(i=>{if(!i||typeof i!=='object'||Array.isArray(i))fail(400,'Invalid checklist item.');keys(i,['id','text','done']);if(!/^[a-f0-9-]{36}$/i.test(i.id||'')||typeof i.done!=='boolean')fail(400,'Invalid checklist item.');return{id:i.id,text:text(i.text,160,true),done:i.done};});
      if(!editor(me,t)&&(items.length!==(t.checklist||[]).length||items.some((i,index)=>i.id!==t.checklist[index].id||i.text!==t.checklist[index].text)))fail(403,'Assignees can check items; the creator or manager edits the checklist.');t.checklist=items;t.revision++;await commit(s,t,me,'Checklist updated');json(res,200,taskView(t,me));return true;
    }
    if(!editor(me,t))fail(403,'Only the creator or a project manager can edit this plan.');
    if(action==='dependencies'){
      keys(d,['revision','ids']);if(!Array.isArray(d.ids)||d.ids.length>15||new Set(d.ids).size!==d.ids.length||d.ids.some(id=>typeof id!=='string'||id===t.id))fail(400,'Choose up to 15 different prerequisite tasks.');
      for(const id of d.ids){const target=state.projectTasks.find(x=>x.id===id&&x.serverId===s.id&&allowed(me,x.channelId));if(!target||t.assigneeId&&!allowed(userById(t.assigneeId),target.channelId))fail(403,'Dependencies must be visible to you and the current assignee.');}
      const queue=[...d.ids],seen=new Set();while(queue.length){const id=queue.pop();if(id===t.id)fail(409,'Task dependencies cannot form a cycle.');if(seen.has(id))continue;seen.add(id);queue.push(...(state.projectTasks.find(x=>x.id===id)?.dependencyIds||[]));}if(t.status==='done'&&d.ids.some(id=>state.projectTasks.find(x=>x.id===id)?.status!=='done'))fail(409,'Reopen this task before adding an unfinished dependency.');t.dependencyIds=[...d.ids];
    }else if(action==='milestone'){
      keys(d,['revision','milestoneId']);const milestone=d.milestoneId===null?null:state.milestones.find(m=>m.id===d.milestoneId&&m.serverId===s.id&&m.channelId===t.channelId&&m.status==='open');if(d.milestoneId!==null&&!milestone)fail(400,'Choose an open milestone in this task’s channel.');t.milestoneId=milestone?.id||null;
    }else fail(405,'Method not allowed.');t.revision++;await commit(s,t,me,action==='dependencies'?'Dependencies updated':'Milestone assignment updated');json(res,200,taskView(t,me));return true;
  }
  return{handle,home,recordChange,taskView};
}
