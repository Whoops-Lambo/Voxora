export function createScheduledUI({node,button,input,field,formDialog,modal,api,getState,getRoute,getDrafts,writeDraft,navigate,openMessage,toast,onChange}){
  let account=null,current=null,generation=0,dialog=null,ownedField=null,editorSelect=null,filter='queued',request=0;
  const who=()=>getState()?.me?.id,date=t=>new Date(t).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const local=t=>{const d=new Date(t);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19);};
  function reset(){generation++;account=null;current=null;if(dialog?.isConnected||ownedField?.isConnected)document.getElementById('modal')?.close();dialog=null;ownedField=null;editorSelect=null;}
  function destination(id){
    const s=getState()?.servers.find(s=>s.channels.some(c=>c.id===id)),c=s?.channels.find(c=>c.id===id);
    if(c)return {name:c.name,serverName:s.name,serverId:s.id,kind:'channel',writable:c.type==='text'&&!c.forum&&c.permissions.includes('sendMessages')};
    const dm=getState()?.conversations.find(c=>c.id===id),other=dm&&getState().users.find(u=>dm.members.includes(u.id)&&u.id!==who());
    return other&&!getState().blocked.includes(other.id)?{name:other.displayName,kind:'dm',writable:true}:null;
  }
  const label=d=>d?[d.serverName,d.name].filter(Boolean).join(' / '):'Destination unavailable';
  function apply(value){if(!who()||!value)return;if(account!==who()){generation++;account=who();}current=value;getState().scheduled=value;if(ownedField?.isConnected&&editorSelect?.isConnected)for(const option of editorSelect.options){const d=destination(option.value);option.textContent=label(d);option.disabled=!d?.writable;}onChange?.();if(dialog?.isConnected&&dialog.classList.contains('drafts-view'))renderDraftList(dialog);if(dialog?.isConnected&&dialog.classList.contains('outbox-view')){dialog.querySelectorAll('.outbox-destination').forEach(e=>{e.textContent='Checking destination…';});load().catch(e=>toast(e.message,true));}}
  async function refresh(){const id=who(),epoch=generation;const result=await api('/me/scheduled-messages');if(id===who()&&epoch===generation)apply(result.summary);}
  function editor(options={},r=null){
    const id=who(),epoch=generation,select=node('select');select.setAttribute('aria-label','Destination channel');
    const choices=[];for(const s of getState().servers)for(const c of s.channels){const d=destination(c.id);if(d?.writable)choices.push([c.id,label(d)]);}for(const dm of getState().conversations){const d=destination(dm.id);if(d?.writable)choices.push([dm.id,label(d)]);}
    for(const [value,text]of choices)select.append(new Option(text,value));
    if(r){if(!choices.some(([value])=>value===r.channel))select.append(new Option(label(r.destination),r.channel));select.value=r.channel;select.disabled=true;}else if(options.channel){select.value=options.channel;select.disabled=true;}
    const text=node('textarea','scheduled-text');text.value=r?.text??options.text??'';text.maxLength=getState().premium?.perks.messageCharacters||2000;text.required=true;
    const sendAt=input(local(r&&r.sendAt>Date.now()?r.sendAt:Date.now()+3600000),'','datetime-local');sendAt.required=true;sendAt.step='1';
    const quick=node('div','thread-actions');for(const [name,ms]of [['In 1 minute',60000],['In 1 hour',3600000],['Tomorrow',86400000]])quick.append(button(name,()=>{sendAt.value=local(Date.now()+ms);},'secondary'));
    const nonce=crypto.randomUUID();formDialog({title:r?'Edit Scheduled Message':'Schedule Message',description:'Text messages are sent by this Voxora server at the selected time. Permissions and moderation are checked again when sending. A local workspace must be running.',fields:[field('DESTINATION',select),field('MESSAGE TO SEND',text),field('SEND AT',sendAt),quick,...(r?.replyTo||options.replyTo?[node('p','muted','This message replies to the original message in this channel.')]:[])],submitLabel:r?'Save Scheduled Message':'Schedule Message',submit:async()=>{
      if(id!==who()||epoch!==generation)throw Error('Sign in again before scheduling.');
      const data={text:text.value,sendAt:new Date(sendAt.value).getTime()};
      if(r)data.revision=r.revision;else Object.assign(data,{nonce,channel:select.value,replyTo:options.replyTo??null});
      await api('/me/scheduled-messages'+(r?'/'+r.id:''),r?'PATCH':'POST',data);
      if(id!==who()||epoch!==generation)return;options.onScheduled?.();await refresh();toast(r?'Scheduled message updated.':'Message added to your outbox.');
    }});ownedField=text;editorSelect=select;
  }
  async function action(r,value){try{await api('/me/scheduled-messages/'+r.id,'PATCH',{revision:r.revision,action:value});await refresh();toast(value==='cancel'?'Scheduled message cancelled.':'Message queued to send now.');}catch(e){await refresh();throw e;}}
  function card(r,compact=false){
    const row=node('article','outbox-card');row.dataset.scheduledId=r.id;row.append(node('div','outbox-status '+r.status,r.status==='queued'?'SENDS '+date(r.sendAt):r.status.toUpperCase()+' · '+date(r.updatedAt)),node('strong','outbox-destination',label(r.destination)),node('p','outbox-text',compact?r.text.slice(0,180):r.text));
    if(r.error)row.append(node('p','form-error',r.error));const actions=node('div','thread-actions');
    if(['queued','failed'].includes(r.status)){
      actions.append(button(r.status==='failed'?'Reschedule Message':'Edit Scheduled Message',()=>editor({},r),'secondary'),button('Send Now',()=>action(r,'send-now'),'secondary'),button('Cancel Scheduled Message',()=>action(r,'cancel'),'text-button danger'));
    }else{
      if(r.status==='sent'&&r.messageId&&r.destination)actions.append(button('View Sent Message',()=>{document.getElementById('modal')?.close();openMessage({id:r.messageId,channel:r.channel});},'text-button'));
      actions.append(button('Remove Outbox History',async()=>{await api('/me/scheduled-messages/'+r.id,'DELETE');await refresh();},'text-button danger'));
    }
    if(r.delivering)for(const b of actions.querySelectorAll('button'))b.disabled=true;row.append(actions);return row;
  }
  async function load(offset=0){
    if(!dialog?.isConnected)return;const target=dialog,id=who(),epoch=generation,token=++request;
    const result=await api('/me/scheduled-messages?status='+filter+'&offset='+offset);if(!target.isConnected||id!==who()||epoch!==generation||token!==request)return;
    const list=target.querySelector('.outbox-list');if(!offset)list.replaceChildren();for(const r of result.items)list.append(card(r));if(!result.items.length&&!offset)list.append(node('p','hub-empty','No messages in this view.'));
    target.querySelector('.outbox-more')?.remove();if(result.hasMore)target.append(button('More Scheduled Messages',()=>load(offset+50),'secondary outbox-more'));
  }
  function openOutbox(){
    const target=node('section','outbox-view'),select=node('select');select.setAttribute('aria-label','Outbox status');for(const [value,text]of [['queued','Queued'],['failed','Needs attention'],['sent','Sent'],['cancelled','Cancelled'],['all','All']])select.append(new Option(text,value));select.value=filter;select.onchange=()=>{filter=select.value;load().catch(e=>toast(e.message,true));};
    target.append(node('div','hub-section-heading',[node('h2','','Your outbox'),button('Schedule Message',()=>editor(),'primary')]),node('p','muted','Only you can see messages before they are sent. Local workspaces send while Voxora is running.'),select,node('div','outbox-list'));modal([target],'outbox-dialog');dialog=target;load().catch(e=>toast(e.message,true));
  }
  function draftItems(){return Object.entries(getDrafts()).filter(([,text])=>typeof text==='string'&&text.trim()).map(([channel,text])=>({channel,text,destination:destination(channel)})).filter(r=>r.destination);}
  function draftCard(r){
    const row=node('article','outbox-card draft-card');row.append(node('strong','outbox-destination',label(r.destination)),node('p','outbox-text',r.text.slice(0,220)));
    const actions=node('div','thread-actions');actions.append(button('Continue Writing',()=>{document.getElementById('modal')?.close();navigate(r.destination.kind==='dm'?{kind:'dm',channel:r.channel}:{kind:'channel',server:r.destination.serverId,channel:r.channel});},'secondary'));
    const schedule=button('Schedule Draft',()=>editor({channel:r.channel,text:r.text,onScheduled:()=>{if(getDrafts()[r.channel]===r.text)writeDraft(r.channel,'');}}),'text-button');schedule.disabled=!r.destination.writable;actions.append(schedule,button('Clear Draft',()=>{writeDraft(r.channel,'');onChange?.();if(dialog?.isConnected&&dialog.classList.contains('drafts-view'))renderDraftList(dialog);},'text-button danger'));row.append(actions);return row;
  }
  function renderDraftList(target){const list=target.querySelector('.draft-list');list.replaceChildren();const items=draftItems();for(const r of items)list.append(draftCard(r));if(!items.length)list.append(node('p','hub-empty','Unsent text from this device appears here. Attachments are not saved in drafts.'));}
  function openDrafts(){const target=node('section','drafts-view',[node('h2','','Drafts on this device'),node('p','muted','Drafts stay in this browser or desktop profile. They are private to the signed-in account and are not synced to other devices.'),node('div','draft-list')]);modal([target],'outbox-dialog');dialog=target;renderDraftList(target);}
  function renderHome(main,side){
    const summary=current||getState()?.scheduled;if(!summary)return;
    const section=node('section','hub-section outbox-home',[node('div','hub-section-heading',[node('h2','','Send it later'),button('Open Outbox',openOutbox,'text-button')]),node('p','muted',summary.queuedCount+' queued'+(summary.failedCount?' · '+summary.failedCount+' need attention':''))]);
    for(const r of summary.next)section.append(card(r,true));if(!summary.next.length)section.append(node('p','hub-empty','Write when inspiration strikes. Schedule a message for the right moment.'));section.append(button('Schedule Message',()=>editor(),'secondary'));side.prepend(section);
    const drafts=node('section','hub-section drafts-home',[node('div','hub-section-heading',[node('h2','','Drafts on this device'),button('All Drafts',openDrafts,'text-button')])]),items=draftItems();for(const r of items.slice(0,3))drafts.append(draftCard(r));if(!items.length)drafts.append(node('p','hub-empty','Unsent text from this device appears here.'));main.append(drafts);
  }
  return{apply,reset,refresh,editor,openOutbox,openDrafts,renderHome};
}
