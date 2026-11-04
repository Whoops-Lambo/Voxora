import {randomUUID,createHash} from 'node:crypto';
import {serverPermissions,activeLockdown,timedOut,screeningPending} from './public/permissions.js';
import {isSuspended} from './platform.js';

export function initializeCare(state){state.supportTickets||=[];state.knowledgeArticles||=[];}
export function assertJoiningAllowed(server,user,fail){if(!server.members.includes(user.id)&&activeLockdown(server)?.pauseInvites)fail(403,'New members are temporarily paused: '+server.lockdown.reason);}
export function careService({state,body,json,fail,save,canRead,userById,management,notify,refresh,rate=()=>{}}){
 const pending=new Map(),writeLocks=new Set(),statuses=['open','waiting','resolved','archived'];
 const permissions=(s,u)=>serverPermissions(s,u.id),has=(s,u,p)=>permissions(s,u).some(id=>[p,'manageServer'].includes(id));
 const staff=(s,u)=>!u.bot&&has(s,u,'manageTickets');
 const name=(s,id)=>s.members.includes(id)?s.nicknames?.[id]||userById(id)?.displayName||'Member':'Former member';
 const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||required&&!v.trim())fail(400,'Enter '+(required?'nonempty ':'')+'text up to '+max+' characters.');return v.trim();};
 const keys=(d,list)=>{if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!list.includes(k)))fail(400,'Unknown community care field.');};
 const version=(v,d)=>{if(pending.has(v)||!Number.isSafeInteger(d.revision)||d.revision!==v.revision)fail(409,'This item changed. Refresh before saving.');};
 const nonce=d=>{if(typeof d.nonce!=='string'||!(/^[\w-]{8,80}$/).test(d.nonce))fail(400,'A valid request identifier is required.');};
 const digest=d=>createHash('sha256').update(JSON.stringify(d)).digest('hex');
 const stable=item=>pending.has(item)?pending.get(item):item;
 const records=list=>list.map(stable).filter(Boolean);
 function server(id,u){const s=state.servers.find(s=>s.id===id&&s.members.includes(u.id));if(!s||isSuspended(u))fail(404,'Community not found.');return s;}
 function participant(s,u){if(u.bot||timedOut(s,u.id)||screeningPending(s,u.id))fail(403,'An active human member who has accepted server rules is required.');}
 function ticketVisible(s,t,u){return t.serverId===s.id&&(t.createdBy===u.id||staff(s,u));}
 function articleVisible(s,a,u,o={}){return a.serverId===s.id&&canRead(u,a.channelId)&&(!o.allowed||o.allowed(a.channelId))&&(a.published||!o.bot&&has(s,u,'manageKnowledgeBase'));}
 const settings=s=>s.careSettings||{revision:0,description:'Ask a question privately. The server support team can read and respond to your ticket.',categories:['General','Account help','Report a concern','Other']};
 async function commit(s,u,list,item,changes,action,{created=false,staffOnly=false,kind='care-update'}={}){
  if(pending.has(item))fail(409,'This item is being saved. Try again shortly.');const before=created?null:structuredClone(item);pending.set(item,before);let audit;
  try{Object.assign(item,changes);if(action){management.log(s,u,action,item.id||s.id);audit=s.auditLog[0]?.id;}await save();}
  catch(error){if(before){for(const k of Object.keys(item))delete item[k];Object.assign(item,before);}else if(list)list.splice(list.indexOf(item),1);if(audit)s.auditLog=s.auditLog.filter(a=>a.id!==audit);throw error;}
  finally{pending.delete(item);}
  notify(s,item,{staffOnly,kind,previous:before});
 }
 async function setting(s,key,next,u,action,reason=''){
  const lock=s.id+':'+key;if(writeLocks.has(lock))fail(409,'This setting is being saved. Refresh before changing it.');writeLocks.add(lock);const before=s[key];let audit;
  try{s[key]=next;management.log(s,u,action,s.name,reason);audit=s.auditLog[0]?.id;await save();}
  catch(error){s[key]=before;if(audit)s.auditLog=s.auditLog.filter(a=>a.id!==audit);throw error;}
  finally{writeLocks.delete(lock);}
 }
 function ticketView(s,t,u,detail=false){
  const manager=staff(s,u),messages=t.messages.filter(m=>!m.private||manager);
  const view={id:t.id,serverId:s.id,number:t.number,title:t.title,category:t.category,status:t.status,priority:t.priority,revision:t.revision,createdAt:t.createdAt,updatedAt:t.updatedAt,requester:{id:s.members.includes(t.createdBy)?t.createdBy:null,name:name(s,t.createdBy)},assignee:t.assigneeId?{id:s.members.includes(t.assigneeId)?t.assigneeId:null,name:name(s,t.assigneeId),active:!!(userById(t.assigneeId)&&s.members.includes(t.assigneeId)&&!isSuspended(userById(t.assigneeId))&&staff(s,userById(t.assigneeId)))}:null,isMine:t.createdBy===u.id,canManage:manager,canReply:!u.bot&&!timedOut(s,u.id)&&!screeningPending(s,u.id)&&!['resolved','archived'].includes(t.status),replyCount:messages.length,needsReply:t.status==='open'&&t.lastPublicAuthor===t.createdBy};
  if(detail)view.messages=messages.map(m=>({id:m.id,authorId:s.members.includes(m.authorId)?m.authorId:null,author:name(s,m.authorId),text:m.text,private:m.private,time:m.time}));return view;
 }
 function articleView(s,a,u,detail=false){const mine=a.feedback.find(f=>f.userId===u.id);const view={id:a.id,serverId:s.id,channelId:a.channelId,channelName:s.channels.find(c=>c.id===a.channelId)?.name||'channel',title:a.title,summary:a.summary,tags:a.tags,published:a.published,pinned:a.pinned,revision:a.revision,createdAt:a.createdAt,updatedAt:a.updatedAt,author:name(s,a.authorId),canManage:!u.bot&&has(s,u,'manageKnowledgeBase'),helpful:a.feedback.filter(f=>f.helpful).length,notHelpful:a.feedback.filter(f=>!f.helpful).length,myFeedback:mine?.helpful??null};if(detail)view.body=a.body;return view;}
 function page(items,url,view){const offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)fail(400,'Invalid page.');return {items:items.slice(offset,offset+25).map(view),total:items.length,offset,hasMore:offset+25<items.length};}
 function overview(s,u){const tickets=records(state.supportTickets).filter(t=>ticketVisible(s,t,u));return {serverId:s.id,canManageTickets:staff(s,u),canManageKnowledge:has(s,u,'manageKnowledgeBase'),canManageSafety:has(s,u,'manageSafety'),canCreateTicket:!u.bot&&permissions(s,u).includes('createTickets'),settings:settings(s),openTickets:tickets.filter(t=>!['resolved','archived'].includes(t.status)).length,assignedTickets:tickets.filter(t=>t.assigneeId===u.id&&!['resolved','archived'].includes(t.status)).length,channels:s.channels.filter(c=>c.type==='text'&&canRead(u,c.id)).map(c=>({id:c.id,name:c.name})),lockdown:activeLockdown(s)};}
 function articleFields(s,u,d,old){
  const next={channelId:d.channelId??old?.channelId,title:d.title??old?.title,summary:d.summary??old?.summary??'',body:d.body??old?.body,tags:d.tags??old?.tags??[],published:d.published??old?.published??false,pinned:d.pinned??old?.pinned??false};
  if(!s.channels.some(c=>c.id===next.channelId&&c.type==='text')||!canRead(u,next.channelId))fail(403,'Choose a text channel you can view.');
  next.title=text(next.title,120,true);next.summary=text(next.summary,300);next.body=text(next.body,12000,true);
  if(!Array.isArray(next.tags)||next.tags.length>6)fail(400,'Choose up to six tags.');next.tags=[...new Set(next.tags.map(t=>text(t,24,true)))];
  if(typeof next.published!=='boolean'||typeof next.pinned!=='boolean')fail(400,'Invalid article visibility.');return next;
 }
 async function handle(req,res,url,u,o={}){
  const route=url.pathname.replace('/api/bot/','/api/'),m=route.match(/^\/api\/servers\/([\w-]+)\/care(?:\/(tickets|articles|safety|settings)(?:\/([\w-]+)(?:\/(reply|transcript|feedback|history|restore))?)?)?$/);if(!m)return false;
  const method=req.method,d=o.data??(['POST','PATCH','PUT'].includes(method)?await body(req):{}),s=server(m[1],u),kind=m[2],id=m[3],action=m[4];
  if(o.bot&&(kind!=='articles'||method!=='GET'||action))fail(403,'Bots can only read published knowledge articles.');
  if(!kind&&method==='GET'){json(res,200,overview(s,u));return true;}
  if(kind==='settings'&&!id){if(!staff(s,u))fail(403,'Manage Support Tickets is required.');if(method==='GET'){json(res,200,settings(s));return true;}if(method!=='PATCH')fail(405,'Method not allowed.');keys(d,['revision','description','categories']);const old=s.careSettings||{...settings(s)};version(old,d);if(!Array.isArray(d.categories)||!d.categories.length||d.categories.length>8)fail(400,'Choose 1–8 ticket categories.');const next={revision:old.revision+1,description:text(d.description,500,true),categories:[...new Set(d.categories.map(c=>text(c,32,true)))]};await setting(s,'careSettings',next,u,'Support settings updated');notify(s,null,{});json(res,200,next);return true;}
  if(kind==='safety'&&!id){
   if(!has(s,u,'manageSafety'))fail(403,'Manage Server Safety is required.');if(method==='GET'){json(res,200,{revision:s.lockdown?.revision||0,active:activeLockdown(s),stored:s.lockdown?{...s.lockdown,actorId:undefined}:null});return true;}if(method!=='PATCH')fail(405,'Method not allowed.');participant(s,u);keys(d,['revision','enabled','endsAt','pauseChat','pauseInvites','reason']);const old=s.lockdown||{revision:0};version(old,d);
   if(typeof d.enabled!=='boolean')fail(400,'Choose whether lockdown is enabled.');const reason=text(d.reason,300,true);
   if(d.enabled&&(typeof d.pauseChat!=='boolean'||typeof d.pauseInvites!=='boolean'||!d.pauseChat&&!d.pauseInvites||d.endsAt!==null&&(!Number.isSafeInteger(d.endsAt)||d.endsAt<Date.now()+1000||d.endsAt>Date.now()+30*86400000)))fail(400,'Choose pauses and an end time within 30 days, or until manually stopped.');
   const next={revision:old.revision+1,enabled:d.enabled,pauseChat:!!d.pauseChat,pauseInvites:!!d.pauseInvites,endsAt:d.enabled?d.endsAt:null,reason,actorId:u.id,startedAt:Date.now()};await setting(s,'lockdown',next,u,d.enabled?'Server lockdown started':'Server lockdown stopped',reason);refresh();json(res,200,{revision:next.revision,active:activeLockdown(s)});return true;
  }
  if(kind==='tickets'){
   if(u.bot)fail(403,'Support tickets are for human members and staff.');const list=state.supportTickets,item=id&&list.find(t=>t.id===id&&ticketVisible(s,t,u));if(id&&(!item||stable(item)===null))fail(404,'Ticket not found.');const manager=staff(s,u);
   if(method==='GET'){
    if(id){const t=stable(item);if(action==='transcript'){const visible=ticketView(s,t,u,true),lines=['Voxora Support · '+s.name,'Ticket #'+t.number+' · '+t.title,'Category: '+t.category,'Status: '+t.status,'Requester: '+visible.requester.name,'',...visible.messages.flatMap(m=>[new Date(m.time).toISOString()+' · '+m.author+(m.private?' [STAFF NOTE]':''),m.text,''])];json(res,200,{filename:'voxora-ticket-'+t.number+'.txt',text:lines.join('\n')});return true;}if(action)fail(405,'Method not allowed.');json(res,200,ticketView(s,t,u,true));return true;}
    const q=text(url.searchParams.get('q')||'',100).toLowerCase(),status=url.searchParams.get('status')||'active',assigned=url.searchParams.get('assigned');if(!['active','all',...statuses].includes(status))fail(400,'Invalid ticket status.');const items=records(list).filter(t=>ticketVisible(s,t,u)&&(status==='all'||(status==='active'?!['resolved','archived'].includes(t.status):t.status===status))&&(!q||(t.title+' '+t.number+' '+t.category).toLowerCase().includes(q))&&(!assigned||assigned==='me'&&t.assigneeId===u.id)).sort((a,b)=>b.updatedAt-a.updatedAt);json(res,200,page(items,url,t=>ticketView(s,t,u)));return true;
   }
   participant(s,u);
   if(method==='POST'&&!id){if(!permissions(s,u).includes('createTickets'))fail(403,'Create Support Tickets is required.');keys(d,['nonce','title','category','text']);nonce(d);const title=text(d.title,120,true),category=text(d.category,32,true),message=text(d.text,6000,true);if(!settings(s).categories.includes(category))fail(400,'Choose an available ticket category.');const request=digest({title,category,message}),duplicate=list.find(t=>t.serverId===s.id&&t.createdBy===u.id&&t.nonce===d.nonce);if(duplicate){if(duplicate.request!==request)fail(409,'This request identifier was already used.');if(pending.has(duplicate))fail(409,'This ticket is being saved.');json(res,200,ticketView(s,duplicate,u,true));return true;}
    rate('care-open:'+s.id+':'+u.id,5,3600000);if(list.filter(t=>t.serverId===s.id&&t.createdBy===u.id&&!['resolved','archived'].includes(t.status)).length>=5)fail(429,'Resolve an existing ticket before opening another (five active tickets per person).');if(list.filter(t=>t.serverId===s.id).length>=2000)fail(409,'This server has reached its support ticket storage limit.');const time=Date.now(),next={id:randomUUID(),serverId:s.id,number:Math.max(0,...list.filter(t=>t.serverId===s.id).map(t=>t.number))+1,title,category,createdBy:u.id,createdAt:time,updatedAt:time,lastPublicAuthor:u.id,status:'open',priority:'normal',revision:0,assigneeId:null,nonce:d.nonce,request,messages:[{id:randomUUID(),authorId:u.id,text:message,private:false,time}]};list.push(next);await commit(s,u,list,next,{},'Support ticket opened',{created:true});json(res,201,ticketView(s,next,u,true));return true;
   }
   if(!id)fail(405,'Method not allowed.');
   if(method==='POST'&&action==='reply'){
    keys(d,['revision','nonce','text','private']);if(pending.has(item))fail(409,'This ticket is being saved. Try again shortly.');nonce(d);const message=text(d.text,6000,true),privateNote=d.private??false;if(typeof privateNote!=='boolean'||privateNote&&!manager)fail(403,'Only support staff can add private notes.');const duplicate=item.messages.find(m=>m.authorId===u.id&&m.nonce===d.nonce);if(duplicate){if(duplicate.text!==message||duplicate.private!==privateNote)fail(409,'This reply identifier was already used.');json(res,200,ticketView(s,stable(item)||item,u,true));return true;}version(item,d);if(['resolved','archived'].includes(item.status))fail(409,'Reopen this ticket before replying.');rate('care-reply:'+u.id,30,60000);if(item.messages.length>=200)fail(409,'This ticket has reached 200 messages.');const time=Date.now(),messages=[...item.messages,{id:randomUUID(),authorId:u.id,text:message,private:privateNote,time,nonce:d.nonce}];await commit(s,u,list,item,{messages,revision:item.revision+1,...(privateNote?{}:{updatedAt:time,lastPublicAuthor:u.id,status:manager?'waiting':'open'})},null,{staffOnly:privateNote});json(res,200,ticketView(s,item,u,true));return true;
   }
   if(method==='PATCH'&&!action){keys(d,['revision','status','priority','claim']);version(item,d);const changes={revision:item.revision+1,updatedAt:Date.now()};if(d.status!==undefined){if(!statuses.includes(d.status)||!manager&&!['open','resolved'].includes(d.status)||!manager&&item.status==='archived')fail(403,'This ticket status change requires support staff.');changes.status=d.status;}if(d.priority!==undefined){if(!manager||!['low','normal','high','urgent'].includes(d.priority))fail(403,'Only support staff can set priority.');changes.priority=d.priority;}if(d.claim!==undefined){if(!manager||typeof d.claim!=='boolean')fail(403,'Only support staff can claim tickets.');if(item.assigneeId&&item.assigneeId!==u.id&&s.members.includes(item.assigneeId)&&userById(item.assigneeId)&&!isSuspended(userById(item.assigneeId))&&staff(s,userById(item.assigneeId)))fail(409,'This ticket is already assigned to another staff member.');changes.assigneeId=d.claim?u.id:null;}if(Object.keys(changes).length===2)fail(400,'Choose a ticket change.');await commit(s,u,list,item,changes,'Support ticket updated');json(res,200,ticketView(s,item,u,true));return true;}
   fail(405,'Method not allowed.');
  }
  if(kind==='articles'){
   const list=state.knowledgeArticles,item=id&&list.find(a=>a.id===id&&stable(a)&&articleVisible(s,stable(a),u,o));if(id&&(!item||stable(item)===null))fail(404,'Article not found.');
   if(method==='GET'){
    if(id){const a=stable(item);if(action==='history'){if(!has(s,u,'manageKnowledgeBase')||o.bot)fail(403,'Manage Knowledge Base is required.');json(res,200,{items:a.history.filter(h=>canRead(u,h.channelId)).map(h=>({revision:h.revision,title:h.title,time:h.updatedAt,author:name(s,h.authorId)}))});return true;}if(action)fail(405,'Method not allowed.');json(res,200,articleView(s,a,u,true));return true;}
    const q=text(url.searchParams.get('q')||'',100).toLowerCase(),tag=text(url.searchParams.get('tag')||'',24),channel=url.searchParams.get('channel'),status=url.searchParams.get('status')||'published';if(!['published','drafts','all'].includes(status))fail(400,'Invalid article status.');const items=records(list).filter(a=>articleVisible(s,a,u,o)&&(status==='all'||status==='published'&&a.published||status==='drafts'&&!a.published)&&(!q||(a.title+' '+a.summary+' '+a.body+' '+a.tags.join(' ')).toLowerCase().includes(q))&&(!tag||a.tags.includes(tag))&&(!channel||channel===a.channelId)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt-a.updatedAt);json(res,200,page(items,url,a=>articleView(s,a,u)));return true;
   }
   if(method==='POST'&&action==='feedback'){participant(s,u);keys(d,['revision','helpful']);version(item,d);if(!item.published||![true,false,null].includes(d.helpful))fail(400,'Choose helpful, not helpful, or clear your vote.');rate('knowledge-feedback:'+u.id,30,60000);const feedback=item.feedback.filter(f=>f.userId!==u.id);if(d.helpful!==null)feedback.push({userId:u.id,helpful:d.helpful});await commit(s,u,list,item,{feedback},null,{kind:'knowledge-update'});json(res,200,articleView(s,item,u,true));return true;}
   if(!has(s,u,'manageKnowledgeBase')||u.bot)fail(403,'Manage Knowledge Base is required.');participant(s,u);
   if(method==='POST'&&!id){keys(d,['nonce','channelId','title','summary','body','tags','published','pinned']);nonce(d);const fields=articleFields(s,u,d),request=digest(fields),duplicate=list.find(a=>a.serverId===s.id&&a.createdBy===u.id&&a.nonce===d.nonce);if(duplicate){if(duplicate.request!==request||pending.has(duplicate))fail(409,'This article request is already in use.');json(res,200,articleView(s,duplicate,u,true));return true;}if(list.filter(a=>a.serverId===s.id).length>=1000)fail(409,'This community has reached 1000 articles.');const time=Date.now(),next={...fields,id:randomUUID(),serverId:s.id,authorId:u.id,createdBy:u.id,createdAt:time,updatedAt:time,revision:0,history:[],feedback:[],nonce:d.nonce,request};list.push(next);await commit(s,u,list,next,{},'Knowledge article created',{created:true,kind:'knowledge-update'});json(res,201,articleView(s,next,u,true));return true;}
   if(!id)fail(405,'Method not allowed.');
   if(method==='PATCH'&&!action||method==='POST'&&action==='restore'){
    keys(d,action?['revision','restoreRevision']:['revision','channelId','title','summary','body','tags','published','pinned']);version(item,d);let fields;if(action){const old=item.history.find(h=>h.revision===d.restoreRevision);if(!old)fail(404,'That saved revision is unavailable.');fields=articleFields(s,u,old,item);}else fields=articleFields(s,u,d,item);
    const old={channelId:item.channelId,title:item.title,summary:item.summary,body:item.body,tags:item.tags,published:item.published,pinned:item.pinned,revision:item.revision,updatedAt:item.updatedAt,authorId:item.authorId};const changes={...fields,revision:item.revision+1,updatedAt:Date.now(),authorId:u.id,history:[old,...item.history].slice(0,10),feedback:fields.body!==item.body?[]:item.feedback};await commit(s,u,list,item,changes,action?'Knowledge article restored':'Knowledge article updated',{kind:'knowledge-update'});json(res,200,articleView(s,item,u,true));return true;
   }
   fail(405,'Method not allowed.');
  }
  fail(405,'Method not allowed.');
 }
 function home(u){const tickets=[],articles=[];for(const s of state.servers.filter(s=>s.members.includes(u.id))){for(const t of records(state.supportTickets).filter(t=>t.serverId===s.id&&!['resolved','archived'].includes(t.status)&&(t.createdBy===u.id||staff(s,u)&&t.assigneeId===u.id)))tickets.push({...ticketView(s,t,u),serverName:s.name});for(const a of records(state.knowledgeArticles).filter(a=>a.serverId===s.id&&a.published&&a.pinned&&articleVisible(s,a,u)))articles.push({...articleView(s,a,u),serverName:s.name});}return {tickets:tickets.sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,6),articles:articles.sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,4)};}
 let previous=new Map();function sweep(){let changed=false;for(const s of state.servers){const active=!!activeLockdown(s);if(previous.has(s.id)&&previous.get(s.id)!==active)changed=true;previous.set(s.id,active);}if(changed)refresh();}
 return {handle,home,overview,staff,articleVisible,sweep};
}
