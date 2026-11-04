import {serverMark} from "./pictures-ui.js";
import {channelPermissions} from './permissions.js';
export function createStudioUI({node,button,input,field,formDialog,modal,confirmDialog,api,getState,toast,refreshState,openMessage,openCare}){
 let current=null,root=null,meta=null,epoch=0,filter={channel:'',q:'',status:'all',mine:false},items=[],editor=null;
 const who=()=>getState()?.me?.id,server=id=>getState()?.servers.find(s=>s.id===id),base=id=>'/servers/'+id+'/studio';
 const time=t=>new Date(t).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),local=t=>{const d=new Date(t);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 const select=(label,options,value)=>{const e=node('select');e.setAttribute('aria-label',label);for(const [id,name]of options)e.append(new Option(name,id));e.value=value;return e;};
 function reset(){epoch++;if(root?.isConnected||editor?.node?.isConnected)document.getElementById('modal').close();current=null;root=null;meta=null;editor=null;items=[];}
 function choose(){const cards=node('div','studio-community-picker');for(const s of getState().servers){const b=button(s.name,()=>open(s.id),'studio-community-choice');b.prepend(serverMark(s,'studio-server-picture'));cards.append(b);}modal([node('div','studio-eyebrow','COMMUNITY STUDIO'),node('h2','','Build something together.'),node('p','dialog-description','Choose a community for its project board, giveaways and insights.'),cards],'studio-picker-dialog');}
 async function open(id,tab='tasks',status=null){
  const s=server(id);if(!s)return;epoch++;editor=null;current={id,tab,account:who()};filter={channel:'',q:'',status:status||(tab==='giveaways'?'active':'all'),mine:false};root=node('section','studio-view');
  modal([root],'studio-dialog');await load();
 }
 async function refresh(){
  if(editor?.node?.isConnected){const s=server(editor.server);if(!s||!s.channels.some(c=>c.id===editor.channel)){document.getElementById('modal').close();editor=null;}return;}
  if(root?.isConnected&&current){if(!server(current.id)||current.account!==who()){reset();return;}await load();}
 }
 async function load(offset=0,append=false){
  if(!root?.isConnected||!current)return;if(current.detailId){const target=root;target.replaceChildren(node('p','muted','Loading task…'));try{await details({id:current.detailId});}catch(e){if(target.isConnected)target.replaceChildren(node('p','form-error',e.message));}return;}const target=root,scope={...current},version=++epoch;target.querySelector('.studio-content')?.replaceChildren(node('p','muted','Loading community tools…'));
  try{
   const overview=await api(base(scope.id));if(version!==epoch||scope.account!==who()||target!==root||!target.isConnected)return;meta=overview;
   if(scope.tab==='insights'&&!meta.canInsights)throw Error('You no longer have permission to view insights.');
   let data;
   if(scope.tab==='insights')data=await api(base(scope.id)+'/insights?days='+(filter.days||7));
   else data=await api(base(scope.id)+'/'+scope.tab+'?'+new URLSearchParams({q:filter.q,status:filter.status,...(filter.channel?{channel:filter.channel}:{}),...(filter.mine?{assigned:'me'}:{}),offset}));
   if(version!==epoch||scope.account!==who()||target!==root||!target.isConnected)return;
   if(scope.tab!=='insights')items=append?[...items,...data.items]:data.items;draw(data);
  }catch(error){if(version===epoch&&target.isConnected)target.replaceChildren(node('h2','','Community Studio'),node('p','form-error',error.message),button('Retry',()=>load(),'secondary'));}
 }
 function draw(data){
  const s=server(current.id);if(!s)return reset();
  const head=node('header','studio-hero',[node('div','',[node('span','studio-eyebrow','VOXORA / COMMUNITY STUDIO'),node('h1','',s.name),node('p','','A shared space for plans, celebrations and progress.')]),button('Refresh Studio',()=>load(),'secondary')]);
  const tabs=node('nav','studio-tabs');tabs.setAttribute('aria-label','Community Studio');
  for(const [id,label]of [['tasks','Project Board'],['giveaways','Giveaways'],...(meta.canInsights?[['insights','Insights']]:[])]){const b=button(label,()=>{current.tab=id;filter.status=id==='giveaways'?'active':'all';load();},id===current.tab?'active':'');b.setAttribute('aria-pressed',String(id===current.tab));tabs.append(b);}
  if(openCare)tabs.append(button('Support Desk',()=>openCare(current.id,'tickets'),'secondary'),button('Knowledge Base',()=>openCare(current.id,'articles'),'secondary'));
  const content=node('div','studio-content');root.replaceChildren(head,tabs,content);
  if(current.tab==='insights'){drawInsights(content,data);return;}
  const tools=node('div','studio-toolbar'),search=input(filter.q,'Search '+(current.tab==='tasks'?'tasks':'giveaways'));
  search.setAttribute('aria-label','Search community items');let timer;search.oninput=()=>{filter.q=search.value;clearTimeout(timer);timer=setTimeout(()=>load().catch(e=>toast(e.message,true)),300);};
  const channels=select('Community channel',[['','All channels'],...meta.channels.map(c=>[c.id,'#'+c.name])],filter.channel);channels.onchange=()=>{filter.channel=channels.value;load();};
  const statuses=current.tab==='tasks'?[['all','All active tasks'],['todo','To do'],['doing','In progress'],['done','Done'],['archived','Archived']]:[['active','Open giveaways'],['ended','Ended'],['cancelled','Cancelled'],['all','All giveaways']];
  const status=select('Community status',statuses,filter.status);status.onchange=()=>{filter.status=status.value;load();};tools.append(search,channels,status);
  if(current.tab==='tasks'){const mine=input('','','checkbox');mine.checked=filter.mine;mine.onchange=()=>{filter.mine=mine.checked;load();};tools.append(node('label','inline-check',[mine,document.createTextNode('Assigned to me')]));if(meta.channels.some(c=>c.canCreate))tools.append(button('New Task',()=>taskEditor(),'primary'));}
  else if(meta.channels.some(c=>c.canGiveaway))tools.append(button('New Giveaway',giveawayEditor,'primary'));
  content.append(tools,node('p','studio-result-count',data.total+' '+(current.tab==='tasks'?'tasks':'giveaways')));
  if(current.tab==='tasks'){
   const board=node('div','project-board');
   for(const [status,label]of [['todo','To do'],['doing','In progress'],['done','Done']]){
    const column=node('section','project-column');column.dataset.status=status;const list=items.filter(t=>t.status===status);column.append(node('h2','',[document.createTextNode(label),node('span','',String(list.length))]));
    column.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-voxora-task'))e.preventDefault();};column.ondrop=e=>{e.preventDefault();const t=items.find(t=>t.id===e.dataTransfer.getData('application/x-voxora-task'));if(t?.canMove)changeTask(t,{status});};
    for(const t of list)column.append(taskCard(t));if(!list.length)column.append(node('p','studio-empty','Nothing here yet.'));board.append(column);
   }content.append(board);
  }else{const list=node('div','giveaway-grid');for(const g of items)list.append(giveawayCard(g));if(!items.length)list.append(node('p','studio-empty','No giveaways in this view.'));content.append(list);}
  if(data.hasMore)content.append(button('Load More Community Items',()=>load(data.offset+100,true),'secondary'));
 }
 function taskCard(t){
  const card=node('article','project-card');card.dataset.taskId=t.id;card.draggable=t.canMove;card.ondragstart=e=>e.dataTransfer.setData('application/x-voxora-task',t.id);
  const top=node('div','project-card-meta',[node('span','priority-'+t.priority,t.priority.toUpperCase()),node('span','','#'+(meta.channels.find(c=>c.id===t.channelId)?.name||'channel'))]);
  card.append(top,button(t.title,()=>details(t),'project-title'));
  if(t.description)card.append(node('p','project-description',t.description.slice(0,150)));if(t.labels.length)card.append(node('div','project-labels',t.labels.map(l=>node('span','',l))));
  const detailsRow=node('div','project-card-footer',[node('span','',t.assignee?.name||'Unassigned')]);if(t.dueAt)detailsRow.append(node('span',t.status!=='done'&&t.dueAt<Date.now()?'is-overdue':'',time(t.dueAt)));card.append(detailsRow);
  if(t.canMove){const status=select('Status for '+t.title,[['todo','To do'],['doing','In progress'],['done','Done']],t.status);status.onchange=()=>changeTask(t,{status:status.value});card.append(status);}return card;
 }
 async function changeTask(t,changes){try{await api(base(current.id)+'/tasks/'+t.id,'PATCH',{revision:t.revision,...changes});await refreshState();await load();}catch(e){toast(e.message,true);await load();}}
 async function details(t){
  current.detailId=t.id;const id=current.id,account=who(),version=++epoch;
  const next=await api(base(id)+'/tasks/'+t.id);if(version!==epoch||account!==who())return;t=next;
  const content=node('section','project-detail',[node('span','studio-eyebrow','PROJECT TASK'),node('h2','',t.title),node('p','project-detail-description',t.description||'No description.'),node('p','muted',(t.assignee?.name||'Unassigned')+' · '+t.priority+' priority'+(t.dueAt?' · Due '+time(t.dueAt):''))]);
  const actions=node('div','thread-actions',[button('Back to Board',()=>open(id),'secondary')]);
  if(t.canEdit){actions.append(button('Edit Task',()=>taskEditor(t),'primary'),button(t.archived?'Restore Task':'Archive Task',()=>changeTask(t,{archived:!t.archived}),'secondary'),button('Delete Task',()=>confirmDialog('Delete Task','Delete this task and its comments?',async()=>{await api(base(id)+'/tasks/'+t.id+'?revision='+t.revision,'DELETE');await refreshState();await open(id);}), 'text-button danger'));}
  if(t.source?.available)actions.append(button('Open Source Message',()=>{document.getElementById('modal').close();openMessage({id:t.source.id,channel:t.source.channel});},'text-button'));
  content.append(actions,node('h3','','Discussion'));for(const c of t.comments)content.append(node('article','project-comment',[node('strong','',c.author),node('small','',time(c.time)),node('p','',c.text)]));
  if(meta.channels.find(c=>c.id===t.channelId)?.canCreate){const comment=node('textarea','project-comment-input');comment.maxLength=1000;comment.setAttribute('aria-label','Task comment');content.append(comment,button('Post Comment',async()=>{const updated=await api(base(id)+'/tasks/'+t.id,'PATCH',{revision:t.revision,comment:comment.value});await details(updated);},'primary'));}
  root=content;modal([content],'studio-dialog');
 }
 function taskEditor(t=null,source=null){
  const s=server(current?.id||source?.serverId);if(!s)return;const id=s.id,title=input(t?.title||source?.text?.slice(0,120)||''),description=node('textarea','studio-description');title.maxLength=120;title.required=true;description.maxLength=4000;description.value=t?.description||'';
  const channels=s.channels.filter(c=>c.type==='text'&&c.permissions.includes('sendMessages')),cid=t?.channelId||source?.channel||channels[0]?.id;if(!cid){toast('Choose a community where you can send messages.',true);return;}
  const channel=select('Task channel',channels.map(c=>[c.id,'#'+c.name]),cid);channel.disabled=!!t;
  const assignee=select('Task assignee',[['','Unassigned'],...getState().users.filter(u=>s.members.includes(u.id)).map(u=>[u.id,s.nicknames[u.id]||u.displayName])],t?.assigneeId||'');
  const priority=select('Task priority',[['low','Low'],['normal','Normal'],['high','High']],t?.priority||'normal'),due=input(t?.dueAt?local(t.dueAt):'','','datetime-local'),labels=input(t?.labels.join(', ')||'','release, design');
  editor={node:title,server:id,channel:cid};const nonce=crypto.randomUUID();
  formDialog({title:t?'Edit Project Task':'New Project Task',description:'Tasks are shared with people who can view their channel. Assignees can update progress; creators and project managers can edit details.',fields:[field('TASK TITLE',title),field('DESCRIPTION',description),field('CHANNEL',channel),field('ASSIGNEE',assignee),field('PRIORITY',priority),field('DUE DATE',due),field('LABELS',labels)],submitLabel:t?'Save Task':'Create Task',submit:async()=>{
   const data={title:title.value,description:description.value,assigneeId:assignee.value||null,priority:priority.value,dueAt:due.value?new Date(due.value).getTime():null,labels:labels.value.split(',').map(l=>l.trim()).filter(Boolean)};
   if(t)data.revision=t.revision;else Object.assign(data,{channelId:channel.value,nonce,...(source?{sourceId:source.id}:{})});
   await api(base(id)+'/tasks'+(t?'/'+t.id:''),t?'PATCH':'POST',data);editor=null;await refreshState();await open(id);toast(t?'Task updated.':'Project task created.');
  }});
 }
 function fromMessage(m){const s=getState().servers.find(s=>s.channels.some(c=>c.id===m.channel));if(s){current={id:s.id,tab:'tasks',account:who()};taskEditor(null,{id:m.id,channel:m.channel,text:m.text,serverId:s.id});}}
 function giveawayEditor(){
  const s=server(current.id),id=s.id,title=input('','A name for your giveaway'),description=node('textarea','studio-description');title.maxLength=120;title.required=true;description.maxLength=2000;
  const channels=meta.channels.filter(c=>c.canGiveaway),channel=select('Giveaway channel',channels.map(c=>[c.id,'#'+c.name]),channels[0]?.id),end=input(local(Date.now()+86400000),'','datetime-local'),winners=input(1,'','number');winners.min=1;winners.max=10;
  const role=select('Eligibility role',[['','All eligible members'],...s.roles.filter(r=>r.id!=='everyone').map(r=>[r.id,r.name])],'');editor={node:title,server:id,channel:channel.value};const nonce=crypto.randomUUID();
  const presets=node('div','thread-actions');for(const [label,ms]of[['15 minutes',900000],['1 hour',3600000],['1 day',86400000]])presets.append(button(label,()=>{end.value=local(Date.now()+ms);},'secondary'));
  formDialog({title:'New Giveaway',description:'Free entry. Winners are drawn automatically from members who still meet the channel and role requirements when it ends.',fields:[field('GIVEAWAY TITLE',title),field('DESCRIPTION',description),field('CHANNEL',channel),field('ENDS AT',end),presets,field('WINNERS',winners),field('REQUIRED ROLE',role)],submitLabel:'Create Giveaway',submit:async()=>{await api(base(id)+'/giveaways','POST',{title:title.value,description:description.value,channelId:channel.value,endsAt:new Date(end.value).getTime(),winnerCount:Number(winners.value),requiredRoleId:role.value||null,nonce});editor=null;await refreshState();await open(id,'giveaways');toast('Giveaway opened.');}});
 }
 function giveawayCard(g){
  const card=node('article','giveaway-card');card.dataset.giveawayId=g.id;card.append(node('span','studio-eyebrow',g.status==='active'?'FREE ENTRY / COMMUNITY GIVEAWAY':g.status.toUpperCase()),node('h2','',g.title));if(g.description)card.append(node('p','',g.description));
  card.append(node('div','giveaway-numbers',[node('strong','',String(g.entryCount)),node('span','','entries · '+g.winnerCount+' winner'+(g.winnerCount===1?'':'s'))]),node('p','muted',(g.status==='active'?'Ends ':'Ended ')+time(g.endedAt||g.endsAt)));
  if(g.requiredRoleId)card.append(node('p','muted','Required role: '+(server(current.id)?.roles.find(r=>r.id===g.requiredRoleId)?.name||'Removed role')));
  if(g.status==='ended')card.append(node('div','giveaway-winners',[node('strong','','WINNERS'),node('p','',g.winners.map(w=>w.name).join(', ')||'No eligible entries.') ]));
  const actions=node('div','thread-actions'),id=current.id;
  if(g.canEnter||g.entered&&g.status==='active')actions.append(button(g.entered?'Leave Giveaway':'Enter Giveaway',async()=>{await api(base(id)+'/giveaways/'+g.id+(g.entered?'/leave':'/enter'),'POST',{});await load();},g.entered?'secondary':'primary'));
  else if(g.status==='active')actions.append(node('small','muted','Entries require an active account with channel access and any required role.'));
  if(g.canManage&&g.status==='active')for(const [action,label]of[['end','Draw Winners Now'],['cancel','Cancel Giveaway']])actions.append(button(label,()=>confirmDialog(label,action==='end'?'Draw and save the winners now? This draw cannot be rerun.':'Cancel this giveaway without drawing winners?',async()=>{await api(base(id)+'/giveaways/'+g.id+'/'+action,'POST',{revision:g.revision});await refreshState();await open(id,'giveaways',action==='end'?'ended':'cancelled');}), 'secondary'));
  if(g.canManage&&g.status!=='active')actions.append(button('Delete Giveaway History',()=>confirmDialog('Delete Giveaway History','Remove this closed giveaway from the community archive?',async()=>{await api(base(id)+'/giveaways/'+g.id+'?revision='+g.revision,'DELETE');await open(id,'giveaways');}),'text-button danger'));
  card.append(actions);return card;
 }
 function drawInsights(target,data){
  const period=select('Insights period',[['7','Last 7 days'],['30','Last 30 days']],String(data.days));period.onchange=()=>{filter.days=Number(period.value);load();};target.append(period);
  const metrics=node('div','studio-metrics');for(const [key,label]of[['messages','Messages'],['activePeople','Active people'],['members','Members'],['bots','Bots'],['threads','Threads'],['completedTasks','Completed tasks']])metrics.append(node('div','studio-metric',[node('strong','',String(data.totals[key])),node('span','',label)]));
  const graph=node('div','studio-chart');graph.setAttribute('role','img');graph.setAttribute('aria-label','Messages per day in UTC');const max=Math.max(1,...data.daily.map(d=>d.messages));for(const d of data.daily){const bar=node('div','studio-chart-day');bar.title=d.date+': '+d.messages+' messages';const fill=node('span');fill.style.height=Math.max(2,d.messages/max*130)+'px';bar.append(node('small','',String(d.messages)),fill,node('small','',d.date.slice(5)));graph.append(bar);}
  const table=node('table','studio-table');table.append(node('thead','',[node('tr','',[node('th','','Channel'),node('th','','Messages')])]));const body=node('tbody');for(const c of data.channels)body.append(node('tr','',[node('td','','#'+c.name),node('td','',String(c.messages))]));table.append(body);
  target.append(node('p','muted','Activity totals cover only channels you can view. Daily buckets use UTC.'),metrics,node('h2','','Conversation rhythm'),graph,node('h2','','Most active channels'),table);
 }
 function renderHome(main,side){
  const data=getState()?.studio;if(!data)return;
  const section=node('section','hub-section studio-home',[node('div','hub-section-heading',[node('h2','','Your next move'),button('Community Studio',choose,'text-button')]),node('p','muted',data.assignedCount+' open assigned tasks across your communities')]);
  for(const t of data.assigned){const b=button('',()=>open(t.serverId),'studio-home-task');b.append(node('span','priority-'+t.priority,'●'),node('strong','',t.title),node('small','',t.serverName+(t.dueAt?' · '+time(t.dueAt):'')));section.append(b);}
  if(!data.assigned.length)section.append(node('p','hub-empty','Plans are better together. Open Community Studio to start a project board.'));main.prepend(section);
  if(data.giveaways.length){const giveaways=node('section','hub-section',[node('h2','','Happening in your communities')]);for(const g of data.giveaways){const b=button('',()=>open(g.serverId,'giveaways'),'studio-home-giveaway');b.append(node('strong','',g.title),node('small','',g.serverName+' · Ends '+time(g.endsAt)));giveaways.append(b);}side.prepend(giveaways);}
 }
 return {open,choose,refresh,reset,fromMessage,renderHome};
}
