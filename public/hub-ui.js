import {serverMark,serverBanner,verificationBadge} from "./pictures-ui.js";
export function createHubUI({node,button,ib,input,field,formDialog,modal,api,getState,getRoute,navigate,openMessage,toast,notifyReminder,onChange,renderExtras}){
  let account=null,current=null,generation=0,root=null,dialog=null,filter='active',loading=false,again=false;const alerts=new Set();
  const who=()=>getState()?.me?.id;
  const date=value=>new Date(value).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const localTime=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  function reset(){generation++;account=null;current=null;alerts.clear();root?.replaceChildren();if(dialog?.isConnected)document.getElementById('modal')?.close();dialog=null;}
  function apply(value){
    if(!who()||!value)return;if(account!==who()){generation++;account=who();}
    current=value;getState().hub=value;if(root?.isConnected&&getRoute().kind==='home')render(root);
    if(dialog?.isConnected){dialog.querySelectorAll('.reminder-source').forEach(e=>e.remove());loadDialog().catch(e=>toast(e.message,true));}
    onChange?.(value);
  }
  async function refresh(){
    again=true;if(loading)return;loading=true;const id=who(),epoch=generation;
    try{do{again=false;const next=await api('/me/hub');if(id!==who()||epoch!==generation)return;apply(next);}while(again);}finally{loading=false;if(again&&id!==who()&&who())refresh().catch(e=>toast(e.message,true));}
  }
  function openChannel(c){return navigate(c.kind==='dm'?{kind:'dm',channel:c.id}:{kind:'channel',server:c.serverId,channel:c.id});}
  async function toggleStar(id){
    const mine=current||getState().hub,stars=mine.stars.map(c=>c.id),next=stars.includes(id)?stars.filter(c=>c!==id):[...stars,id];
    try{apply(await api('/me/hub','PATCH',{version:mine.version,stars:next}));toast(next.includes(id)?'Added to your starred channels.':'Removed from starred channels.');}
    catch(error){await refresh();throw error;}
  }
  function sidebar(target){
    const stars=(current||getState()?.hub)?.stars||[];if(!stars.length)return;
    const section=node('section','starred-channels',[node('h3','section-label','STARRED')]);
    for(const c of stars){const b=button(c.name,()=>openChannel(c),'channel-row starred-channel');b.setAttribute('aria-label','Open starred '+c.name);b.prepend(node('span','starred-glyph','✦'));section.append(b);}target.append(section);
  }
  function editor(source=null,r=null){
    const title=input(r?.title||(source?'Follow up on a message':''),'What would you like to remember?');title.maxLength=120;title.required=true;
    const note=node('textarea','reminder-note');note.value=r?.note||'';note.maxLength=2000;note.placeholder='Add a private note';
    const due=input(localTime(r?.dueAt||Date.now()+3600000),'','datetime-local');due.required=true;const initial=due.value;
    const recurrence=node('select');recurrence.setAttribute('aria-label','REPEAT');recurrence.append(new Option('Does not repeat','none'),new Option('Daily (24 hours)','daily'),new Option('Weekly (7 days)','weekly'));recurrence.value=r?.recurrence||'none';
    const presets=node('div','thread-actions');for(const [label,ms]of [['In 5 minutes',300000],['In 1 hour',3600000],['Tomorrow',86400000]])presets.append(button(label,()=>{due.value=localTime(Date.now()+ms);},'secondary'));
    formDialog({title:r?'Edit Reminder':'New Reminder',description:'Only you can see your reminders. Due items stay in Home until you complete or snooze them.',fields:[field('REMINDER TITLE',title),field('PRIVATE NOTE',note),field('REMIND ME AT',due),field('REPEAT',recurrence),presets],submitLabel:r?'Save Reminder':'Create Reminder',submit:async()=>{
      const data={title:title.value,note:note.value,recurrence:recurrence.value};if(!r||due.value!==initial)data.dueAt=new Date(due.value).getTime();
      if(r)data.revision=r.revision;else if(source)data.source=source;
      await api('/me/reminders'+(r?'/'+r.id:''),r?'PATCH':'POST',data);await refresh();toast(r?'Reminder updated.':'Reminder created.');
    }});
  }
  async function change(r,data){try{await api('/me/reminders/'+r.id,'PATCH',{revision:r.revision,...data});await refresh();}catch(error){await refresh();throw error;}}
  function card(r){
    const el=node('article','reminder-card'+(r.due?' is-due':''));el.dataset.reminderId=r.id;
    el.append(node('div','reminder-time',r.completedAt?'COMPLETED · '+date(r.completedAt):r.due?'DUE · '+date(r.dueAt):date(r.dueAt)),node('h3','',r.title));
    if(r.recurrence&&r.recurrence!=='none')el.append(node('small','muted','Repeats '+r.recurrence+' · completing schedules the next occurrence.'));
    if(r.note)el.append(node('p','reminder-private-note',r.note));
    if(r.source){
      const source=node('div','reminder-source');
      if(r.source.available){const p=r.source.preview;source.append(node('small','',p.serverName?[p.serverName,p.channelName].join(' / '):'Direct message'),node('p','',p.text||'Message attachment'));
        source.append(button('Open Original Message',()=>{document.getElementById('modal')?.close();openMessage({id:p.id,channel:p.channel,threadId:p.threadId});},'text-button'));
      }else source.append(node('p','muted','This message is no longer available.'));
      el.append(source);
    }
    const actions=node('div','thread-actions');
    actions.append(button(r.completedAt?'Restore Reminder':'Complete Reminder',()=>change(r,{completed:!r.completedAt}),'secondary'));
    if(!r.completedAt)actions.append(button('Snooze 15 Minutes',()=>change(r,{dueAt:Date.now()+900000,completed:false}),'secondary'));
    actions.append(button('Edit Reminder',()=>editor(null,r),'text-button'),button('Delete Reminder',async()=>{await api('/me/reminders/'+r.id,'DELETE');await refresh();},'text-button danger'));
    el.append(actions);return el;
  }
  function render(target){
    root=target;const state=getState(),h=current||state?.hub;if(!state||!h)return;
    target.replaceChildren();target.className='home-hub';
    const hero=node('header','hub-hero',[node('div','',[node('span','hub-eyebrow','VOXORA 3.2 / YOUR LAUNCHPAD'),node('h1','','Your community, in motion.'),node('p','','Hello '+state.me.displayName+'. Make a plan, find your people, and turn a good conversation into what comes next.')]),button('New Reminder',()=>editor(),'primary')]);
    const stats=node('div','hub-stats');
    const unread=Object.values(state.activity?.channels||{}).reduce((n,c)=>n+(c.muted?0:c.unread),0);
    for(const [value,label]of [[state.servers.length,state.servers.length===1?'community':'communities'],[unread,'unread messages'],[h.dueCount,'reminders due']])stats.append(node('div','hub-stat',[node('strong','',String(value)),node('span','',label)]));
    const columns=node('div','hub-columns'),main=node('div','hub-main'),side=node('div','hub-side');
    const stars=node('section','hub-section',[node('div','hub-section-heading',[node('h2','','Your shortcuts'),node('span','muted','Star a channel to keep it close')])]);
    const shortcuts=node('div','hub-shortcuts');for(const c of h.stars){const b=button('',()=>openChannel(c),'hub-shortcut');b.append(node('span','shortcut-mark','✦'),node('strong','',c.name),node('small','',c.serverName||'Direct message'));shortcuts.append(b);}if(!h.stars.length)shortcuts.append(node('p','hub-empty','Open a channel and select Star Channel. Your shortcuts follow your account.'));stars.append(shortcuts);
    const communities=node('section','hub-section',[node('h2','','Your communities')]),grid=node('div','hub-community-grid');
    for(const s of state.servers){const b=button('',()=>{const c=s.channels.find(c=>c.type==='text')||s.channels[0];if(c)navigate({kind:'channel',server:s.id,channel:c.id});},'hub-community');if(s.bannerUrl)b.append(serverBanner(s));b.append(serverMark(s,'community-monogram'),node('strong','',s.name),node('small','',s.members.length+(s.members.length===1?' person · ':' people · ')+s.channels.length+' channels'));const verified=verificationBadge(s);if(verified)b.querySelector('strong').append(' ',verified);grid.append(b);}communities.append(grid);main.append(stars,communities);
    const reminders=node('section','hub-section',[node('div','hub-section-heading',[node('h2','','On your horizon'),button('All Reminders',openReminders,'text-button')])]);
    if(!h.reminders.length)reminders.append(node('p','hub-empty','A little space for your next step. Create a reminder or save one from a message.'));
    else for(const r of h.reminders)reminders.append(card(r));side.append(reminders);renderExtras?.(main,side);columns.append(main,side);target.append(hero,stats,columns);
  }
  let dialogRequest=0;
  async function loadDialog(offset=0){
    if(!dialog?.isConnected)return;const target=dialog,id=who(),epoch=generation,request=++dialogRequest;
    const result=await api('/me/reminders?status='+filter+'&offset='+offset);if(!target.isConnected||id!==who()||epoch!==generation||request!==dialogRequest)return;
    const list=target.querySelector('.reminder-list');if(!offset)list.replaceChildren();for(const r of result.items)list.append(card(r));if(!result.items.length&&!offset)list.append(node('p','hub-empty','No reminders in this view.'));
    target.querySelector('.reminder-more')?.remove();if(result.hasMore)target.append(button('More Reminders',()=>loadDialog(offset+50),'secondary reminder-more'));
  }
  function openReminders(){
    const target=node('div','reminders-view'),select=node('select');select.setAttribute('aria-label','Reminder status');for(const [value,label]of [['active','Active'],['completed','Completed'],['all','All']])select.append(new Option(label,value));select.value=filter;select.onchange=()=>{filter=select.value;loadDialog().catch(e=>toast(e.message,true));};
    target.append(node('div','hub-section-heading',[node('h2','','Your reminders'),button('New Reminder',()=>editor(),'primary')]),select,node('div','reminder-list'));modal([target],'reminders-dialog');dialog=target;loadDialog().catch(e=>toast(e.message,true));
  }
  async function handleEvent(event){
    if(!['hub-update','reminder-due'].includes(event.type))return;await refresh();
    if(event.type==='reminder-due'&&who()===account){const id=account,r=current.reminders.find(r=>r.id===event.id)||await api('/me/reminders/'+event.id).catch(()=>null);if(id===who()&&r?.due&&!alerts.has(r.id+':'+r.dueAt)){alerts.add(r.id+':'+r.dueAt);if(alerts.size>500)alerts.delete(alerts.values().next().value);toast('A reminder is due. Open Home to review it.');notifyReminder?.();}}
  }
  return {apply,reset,refresh,render,sidebar,toggleStar,editor,openReminders,handleEvent,isStarred:id=>(current||getState()?.hub)?.stars.some(c=>c.id===id)};
}
