import {randomUUID} from 'node:crypto';
import {isSuspended} from './platform.js';

export function initializeHubUser(user) {
  user.hub ||= {version:0,stars:[],reminders:[]};
}

export function hubService({state,body,json,fail,save,notify,canRead,sourceView}) {
  const keys=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail(400,'Unsupported Home field.');};
  const active=me=>{if(!me||me.bot||isSuspended(me))fail(403,'Home requires an active human account.');initializeHubUser(me);return me.hub;};
  function channelView(me,id){
    if(!canRead(me,id))return null;
    const server=state.servers.find(s=>s.channels.some(c=>c.id===id));
    const channel=server?.channels.find(c=>c.id===id);
    if(channel)return {id,name:channel.name,kind:channel.type==='voice'?'voice':'channel',serverId:server.id,serverName:server.name,forum:!!channel.forum};
    const dm=state.conversations.find(c=>c.id===id&&c.members.includes(me.id));
    if(dm&&dm.members.some(uid=>me.blocked?.includes(uid)||state.users.find(u=>u.id===uid)?.blocked?.includes(me.id)))return null;
    if(dm?.kind==='group')return{id,name:dm.name,kind:'dm',serverId:null};
    const other=dm&&state.users.find(u=>u.id===dm.members.find(uid=>uid!==me.id));
    return other?{id,name:other.displayName,kind:'dm',serverId:null}:null;
  }
  function reminderView(me,r){
    const source=r.source?sourceView(me,r.source):null;
    return {id:r.id,title:r.title,note:r.note,dueAt:r.dueAt,createdAt:r.createdAt,completedAt:r.completedAt,revision:r.revision,recurrence:r.recurrence||'none',lastCompletedAt:r.lastCompletedAt||null,
      due:!r.completedAt&&r.dueAt<=Date.now(),source:r.source?{...r.source,available:!!source,...(source?{preview:source}:{})}:null};
  }
  function view(me){
    const h=active(me),list=h.reminders.filter(r=>!r.completedAt).sort((a,b)=>a.dueAt-b.dueAt);
    return {version:h.version,stars:h.stars.map(id=>channelView(me,id)).filter(Boolean),dueCount:list.filter(r=>r.dueAt<=Date.now()).length,
      activeCount:list.length,reminders:list.slice(0,6).map(r=>reminderView(me,r))};
  }
  function fields(d,previous){
    const title=d.title===undefined?previous?.title:d.title,note=d.note===undefined?previous?.note||'':d.note,dueAt=d.dueAt===undefined?previous?.dueAt:d.dueAt;
    if(typeof title!=='string'||!title.trim()||title.length>120||/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(title))fail(400,'Use a reminder title of 1–120 characters.');
    if(typeof note!=='string'||note.length>2000)fail(400,'Reminder notes support up to 2,000 characters.');
    if(!Number.isSafeInteger(dueAt)||dueAt<Date.now()-1000||dueAt>Date.now()+366*86400000)fail(400,'Choose a reminder time within the next year.');
    const recurrence=d.recurrence===undefined?previous?.recurrence||'none':d.recurrence;if(!['none','daily','weekly'].includes(recurrence))fail(400,'Choose no repeat, daily or weekly.');
    return {title:title.trim(),note:note.trim(),dueAt,recurrence};
  }
  async function handle(req,res,url,me){
    const hub=url.pathname==='/api/me/hub',match=url.pathname.match(/^\/api\/me\/reminders(?:\/([\w-]+))?$/);
    if(!hub&&!match)return false;
    const method=req.method,d=['PATCH','POST'].includes(method)?await body(req):{},h=active(me);
    if(hub){
      if(method==='GET'){json(res,200,view(me));return true;}
      if(method!=='PATCH')fail(405,'Method not allowed.');keys(d,['version','stars']);
      if(d.version!==h.version)fail(409,'Your starred channels changed on another device. Refresh and try again.');
      if(!Array.isArray(d.stars)||d.stars.length>100||new Set(d.stars).size!==d.stars.length||d.stars.some(id=>typeof id!=='string'||!channelView(me,id)))fail(400,'Star up to 100 channels or conversations you can currently access.');
      h.stars=[...d.stars];h.version++;await save();notify(me.id,{type:'hub-update'});json(res,200,view(me));return true;
    }
    const id=match[1],r=id&&h.reminders.find(r=>r.id===id);
    if(id&&!r)fail(404,'Reminder not found.');
    if(id&&method==='GET'){json(res,200,reminderView(me,r));return true;}
    if(!id&&method==='GET'){
      const status=url.searchParams.get('status')||'active',offset=Number(url.searchParams.get('offset')||0);
      if(!['active','completed','all'].includes(status)||!Number.isSafeInteger(offset)||offset<0)fail(400,'Invalid reminder filter or page.');
      const items=h.reminders.filter(r=>status==='all'||!!r.completedAt===(status==='completed')).sort((a,b)=>status==='completed'?b.completedAt-a.completedAt:a.dueAt-b.dueAt);
      json(res,200,{items:items.slice(offset,offset+50).map(r=>reminderView(me,r)),total:items.length,offset,hasMore:offset+50<items.length});return true;
    }
    if(!id&&method==='POST'){
      keys(d,['title','note','dueAt','source','recurrence']);if(h.reminders.length>=500)fail(400,'Delete an old reminder before adding more than 500.');
      let source=null;
      if(d.source!==undefined){keys(d.source,['kind','id']);if(!['message','thread'].includes(d.source.kind)||typeof d.source.id!=='string'||!sourceView(me,d.source))fail(404,'The source message is not available.');source={kind:d.source.kind,id:d.source.id};}
      const next={id:randomUUID(),...fields(d),source,createdAt:Date.now(),completedAt:null,revision:0,notifiedAt:null};
      h.reminders.push(next);await save();notify(me.id,{type:'hub-update'});json(res,201,reminderView(me,next));return true;
    }
    if(id&&method==='PATCH'){
      keys(d,['revision','title','note','dueAt','completed','recurrence']);
      if(d.revision!==r.revision)fail(409,'This reminder changed. Reopen it before saving.');
      if(Object.keys(d).length<2||d.completed!==undefined&&typeof d.completed!=='boolean')fail(400,'Choose a reminder change.');
      // Completing a due item must remain possible without changing its time.
      const patch=d.title!==undefined||d.note!==undefined||d.dueAt!==undefined||d.recurrence!==undefined?fields(d,{...r,dueAt:d.dueAt??Math.max(r.dueAt,Date.now())}):{};
      if(d.dueAt===undefined)delete patch.dueAt;
      Object.assign(r,patch);if(d.completed!==undefined)r.completedAt=d.completed?Date.now():null;
      if(d.completed===true&&['daily','weekly'].includes(r.recurrence)){const interval=(r.recurrence==='daily'?1:7)*86400000;r.lastCompletedAt=Date.now();r.dueAt+=Math.max(1,Math.floor((Date.now()-r.dueAt)/interval)+1)*interval;r.completedAt=null;r.notifiedAt=null;}
      if(d.dueAt!==undefined||d.completed===false)r.notifiedAt=null;r.revision++;
      await save();notify(me.id,{type:'hub-update'});json(res,200,reminderView(me,r));return true;
    }
    if(id&&method==='DELETE'){
      h.reminders=h.reminders.filter(x=>x!==r);await save();notify(me.id,{type:'hub-update'});json(res,200,{ok:true});return true;
    }
    fail(405,'Method not allowed.');
  }
  let sweeping=false;
  async function sweep(){
    if(sweeping)return;sweeping=true;
    try{
      const now=Date.now(),due=[];
      for(const me of state.users){if(me.bot||isSuspended(me))continue;initializeHubUser(me);for(const r of me.hub.reminders)if(!r.completedAt&&!r.notifiedAt&&r.dueAt<=now){r.notifiedAt=now;due.push({me,r});}}
      if(!due.length)return;await save();
      for(const {me,r}of due)if(!isSuspended(me)&&me.hub.reminders.includes(r)&&!r.completedAt&&r.notifiedAt===now&&r.dueAt<=Date.now())notify(me.id,{type:'reminder-due',id:r.id});
    }finally{sweeping=false;}
  }
  return {view,handle,sweep};
}
