import {randomUUID} from 'node:crypto';
import {isSuspended} from './platform.js';

export function initializeScheduledUser(user){user.scheduledMessages ||= [];}
export function scheduledService({state,body,json,fail,save,notify,validate,targetView,createMessage}){
  const inFlight=new Set();let sweeping=false;
  const active=me=>{if(!me||me.bot||isSuspended(me)||!state.users.includes(me))fail(403,'Scheduled messages require an active account.');initializeScheduledUser(me);return me.scheduledMessages;};
  const keys=(d,allowed)=>{if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!allowed.includes(k)))fail(400,'Unsupported scheduled-message field.');};
  const time=value=>{if(!Number.isSafeInteger(value)||value<Date.now()+1000||value>Date.now()+365*86400000)fail(400,'Choose a send time at least a second ahead and within the next year.');return value;};
  const viewItem=(me,r)=>({id:r.id,channel:r.channel,text:r.text,replyTo:r.replyTo,sendAt:r.sendAt,createdAt:r.createdAt,updatedAt:r.updatedAt,revision:r.revision,status:r.status,error:r.error,messageId:r.messageId,sentAt:r.sentAt,destination:targetView(me,r.channel),delivering:inFlight.has(r.id)});
  function view(me){const rows=active(me);return{queuedCount:rows.filter(r=>r.status==='queued').length,failedCount:rows.filter(r=>r.status==='failed').length,next:rows.filter(r=>r.status==='queued').sort((a,b)=>a.sendAt-b.sendAt).slice(0,3).map(r=>viewItem(me,r))};}
  function capacity(rows,except){if(rows.filter(r=>r!==except&&r.status==='queued').length>=50)fail(400,'You can queue up to 50 messages. Cancel or send one first.');}
  async function handle(req,res,url,me){
    const match=url.pathname.match(/^\/api\/me\/scheduled-messages(?:\/([\w-]+))?$/);if(!match)return false;
    const method=req.method,d=['POST','PATCH'].includes(method)?await body(req):{},rows=active(me),id=match[1],r=id&&rows.find(r=>r.id===id);
    if(id&&!r)fail(404,'Scheduled message not found.');
    if(method==='GET'){
      if(id){json(res,200,viewItem(me,r));return true;}
      const status=url.searchParams.get('status')||'queued',offset=Number(url.searchParams.get('offset')||0);
      if(!['queued','failed','sent','cancelled','all'].includes(status)||!Number.isSafeInteger(offset)||offset<0)fail(400,'Invalid outbox filter or page.');
      const items=rows.filter(r=>status==='all'||r.status===status).sort((a,b)=>status==='queued'?a.sendAt-b.sendAt:b.updatedAt-a.updatedAt);
      json(res,200,{items:items.slice(offset,offset+50).map(r=>viewItem(me,r)),total:items.length,hasMore:offset+50<items.length,offset,summary:view(me)});return true;
    }
    if(!id&&method==='POST'){
      keys(d,['channel','text','sendAt','replyTo','nonce']);
      if(typeof d.nonce!=='string'||!/^[-\w]{16,80}$/.test(d.nonce))fail(400,'Use a unique request ID when scheduling a message.');
      const existing=rows.find(r=>r.nonce===d.nonce);
      if(existing){if(existing.channel!==d.channel||existing.text!==(typeof d.text==='string'?d.text.trim():null)||existing.sendAt!==d.sendAt||existing.replyTo!==(d.replyTo??null))fail(409,'This request ID was already used for another message.');json(res,200,viewItem(me,existing));return true;}
      if(rows.length>=200)fail(400,'Remove old outbox history before saving more than 200 messages.');capacity(rows);
      const text=validate(me,d),sendAt=time(d.sendAt),now=Date.now();
      const next={id:randomUUID(),nonce:d.nonce,channel:d.channel,text,replyTo:d.replyTo??null,sendAt,createdAt:now,updatedAt:now,revision:0,status:'queued',messageId:null,sentAt:null,error:null};
      rows.push(next);await save();notify(me.id);json(res,201,viewItem(me,next));return true;
    }
    if(id&&method==='PATCH'){
      keys(d,['revision','text','sendAt','action']);
      if(d.revision!==r.revision)fail(409,'This scheduled message changed. Refresh before editing it.');
      if(inFlight.has(id))fail(409,'This message is being delivered. Wait for its result.');
      if(!['queued','failed'].includes(r.status))fail(409,'Only queued or failed messages can be changed.');
      if(d.action!==undefined){
        if(!['cancel','send-now'].includes(d.action)||d.text!==undefined||d.sendAt!==undefined)fail(400,'Choose one outbox action.');
        if(d.action==='cancel'){r.status='cancelled';r.error=null;}
        else{capacity(rows,r);validate(me,r);r.status='queued';r.sendAt=Date.now();r.error=null;}
      }else{
        if(d.text===undefined&&d.sendAt===undefined)fail(400,'Choose a scheduled-message change.');
        capacity(rows,r);const text=validate(me,{...r,...d}),sendAt=time(d.sendAt===undefined?r.sendAt:d.sendAt);Object.assign(r,{text,sendAt,status:'queued',error:null});
      }
      r.revision++;r.updatedAt=Date.now();await save();notify(me.id);json(res,200,viewItem(me,r));return true;
    }
    if(id&&method==='DELETE'){
      if(inFlight.has(id)||r.status==='queued')fail(409,'Cancel a queued message before removing its history.');
      me.scheduledMessages=rows.filter(item=>item!==r);await save();notify(me.id);json(res,200,{ok:true});return true;
    }
    fail(405,'Method not allowed.');
  }
  async function sweep(){
    if(sweeping)return;sweeping=true;
    try{
      const due=state.users.filter(me=>!me.bot).flatMap(me=>(me.scheduledMessages||[]).filter(r=>r.status==='queued'&&r.sendAt<=Date.now()).map(r=>({me,r}))).sort((a,b)=>a.r.sendAt-b.r.sendAt).slice(0,25);
      for(const {me,r}of due){
        if(r.status!=='queued'||inFlight.has(r.id)||!me.scheduledMessages.includes(r))continue;inFlight.add(r.id);
        try{
          active(me);validate(me,r);
          await createMessage(me,{channel:r.channel,text:r.text,replyTo:r.replyTo},{beforeSave:m=>{
            // The message and its delivery receipt share one atomic state write.
            // Restarting cannot see a queued row with an already-saved message.
            Object.assign(r,{status:'sent',messageId:m.id,sentAt:m.time,updatedAt:m.time,revision:r.revision+1,error:null});
          }});
        }catch(error){
          if(r.status==='queued'){r.status='failed';r.revision++;r.updatedAt=Date.now();r.error=error.status&&error.status<500?error.message:'Delivery did not finish. Review and reschedule this message.';await save();}
        }finally{inFlight.delete(r.id);notify(me.id);}
      }
    }finally{sweeping=false;}
  }
  return{handle,view,sweep};
}
