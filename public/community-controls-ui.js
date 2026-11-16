export function createCommunityControls({node,button,input,field,formDialog,confirmDialog,api,getState,refreshState,toast,modal}){
 const safe=fn=>async()=>{try{await fn();}catch(e){toast(e.message,true);}};
 async function recovery(s,content){
  const load=async()=>{const data=await api('/servers/'+s.id+'/recovery');if(!content.isConnected)return;content.replaceChildren(node('h2','','Server Management'),node('p','management-help','Restore deleted channels, messages, threads and roles. Only server owners and administrators can access recovery. Expired records and permanently deleted records cannot be recovered.'));
   if(!data.items.length)content.append(node('p','','No recoverable content.'));
   for(const item of data.items)content.append(node('article','plus-card',[node('strong','',item.kind+' · '+item.name),node('p','muted','Deleted '+new Date(item.deletedAt).toLocaleString()+' · Retained until '+new Date(item.expiresAt).toLocaleString()),button('Restore',safe(async()=>{await api('/servers/'+s.id+'/recovery/'+item.id,'POST',{action:'restore'});await refreshState();await load();}),'primary'),button('Delete Permanently',()=>confirmDialog('Permanently Delete','This cannot be undone.',async()=>{await api('/servers/'+s.id+'/recovery/'+item.id,'DELETE');await load();}),'danger')]));
  };await load();
 }
 async function accounts(content){
  const data=await api('/accounts');
  content.append(node('h3','','Account Switcher'),node('p','muted','Accounts are remembered only on this browser and Voxora backend. Signing out everywhere revokes their switch access.'));
  for(const u of data.items)content.append(node('div','bot-actions',[node('strong','',u.displayName+' · @'+u.username),...(u.active?[node('small','','Current account')]:[button('Switch',safe(async()=>{await api('/accounts','POST',{userId:u.id});location.reload();}))])]));
  content.append(button('Add Account',()=>{
   const username=input('','Username'),password=input('','','password');password.autocomplete='current-password';
   formDialog({title:'Add Account',description:'Sign in to another account on this same Voxora backend.',fields:[field('USERNAME',username),field('PASSWORD',password)],submitLabel:'Sign In and Add',submit:async()=>{await api('/auth/login','POST',{username:username.value,password:password.value});password.value='';location.reload();}});
  },'primary'));
 }
 async function themes(content){
  const load=async()=>{
   const data=await api('/personal-workspace');if(!content.isConnected)return;content.replaceChildren(node('h2','','Custom App Themes'),node('p','muted',data.themes.length+' saved / '+data.themeLimit+' creation slots. Plus can create two themes; Max can create ten. Shared theme codes can be applied by other members.'));
   const name=input('','My theme'),colors={};for(const [key,value] of Object.entries({background:'#0c141e',panel:'#18222e',text:'#e6edf3',accent:'#55e6bc'}))colors[key]=input(value,'','color');
   content.append(field('THEME NAME',name),...Object.entries(colors).map(([key,value])=>field(key.toUpperCase(),value)),button('Save Custom Theme',safe(async()=>{await api('/personal-workspace/themes','POST',{name:name.value,palette:Object.fromEntries(Object.entries(colors).map(([k,e])=>[k,e.value]))});await refreshState();await load();}),'primary'));
   for(const t of data.themes){const share=data.shares.find(s=>s.themeId===t.id);content.append(node('article','plus-card',[node('strong','',t.name),button('Apply Theme',safe(async()=>{await api('/personal-workspace/apply','POST',{themeId:t.id});await refreshState();})),button('Share Theme',safe(async()=>{await api('/personal-workspace/share','POST',{themeId:t.id});await load();})),...(share?[node('code','',share.code),button('Revoke Share',safe(async()=>{await api('/personal-workspace/share/'+share.code,'DELETE');await load();}))]:[]),button('Delete Theme',safe(async()=>{await api('/personal-workspace/themes/'+t.id,'DELETE');await refreshState();await load();}),'danger')]));}
   const sceneName=input('','Gaming, Work, Quiet…');content.append(node('h3','','Workspace Scenes · Max'),node('p','muted','Save and switch between your current theme, private channel lists and DM folders.'),field('SCENE NAME',sceneName),button('Save Current Workspace as Scene',safe(async()=>{await api('/personal-workspace/scenes','POST',{name:sceneName.value});await load();}),'primary'));
   for(const scene of data.scenes||[])content.append(node('div','bot-actions',[node('strong','',scene.name),button('Apply Scene',safe(async()=>{await api('/personal-workspace/scenes/'+scene.id,'POST',{});await refreshState();})),button('Delete Scene',safe(async()=>{await api('/personal-workspace/scenes/'+scene.id,'DELETE');await load();}))]));
   const code=input('','Theme share code');content.append(field('SHARED THEME CODE',code),button('Apply Shared Theme',safe(async()=>{await api('/personal-workspace/apply','POST',{code:code.value});await refreshState();})),button('Reset App Theme',safe(async()=>{await api('/personal-workspace/apply','POST',{reset:true});await refreshState();})));
  };await load();
 }
 function channelList(s){
  const existing=getState().personalWorkspace?.channelLists?.[s.id]||{order:[],hidden:[]},order=s.channels.slice().sort((a,b)=>{const rank=id=>existing.order.includes(id)?existing.order.indexOf(id):10000;return rank(a.id)-rank(b.id);}),hidden=new Set(existing.hidden),root=node('div');
  const draw=()=>{root.replaceChildren();for(const [index,c] of order.entries()){const show=input('','','checkbox');show.checked=!hidden.has(c.id);show.onchange=()=>show.checked?hidden.delete(c.id):hidden.add(c.id);root.append(node('div','bot-actions',[field(c.name,show),button('Move '+c.name+' Up',()=>{if(index){[order[index-1],order[index]]=[order[index],order[index-1]];draw();}})]));}};draw();
  formDialog({title:'Customize Channel List',description:'This changes your sidebar only. Server permissions and other members’ lists are unchanged.',fields:[root],submitLabel:'Save My Channel List',submit:async()=>{await api('/personal-workspace/channel-lists/'+s.id,'PUT',{order:order.map(c=>c.id),hidden:[...hidden]});await refreshState();}});
 }
 function dmFolders(){
  const data=getState().personalWorkspace?.dmFolders||[],name=input('','Folder name'),root=node('div'),checks=[];
  for(const c of getState().conversations){const check=input('','','checkbox');checks.push([c.id,check]);root.append(field(c.name||getState().users.find(u=>c.members.includes(u.id)&&u.id!==getState().me.id)?.displayName||'Conversation',check));}
  formDialog({title:'Organize DMs',fields:[field('NEW FOLDER NAME',name),root,...data.map(f=>button('Remove folder: '+f.name,safe(async()=>{await api('/personal-workspace/dm-folders','PUT',{folders:data.filter(x=>x.id!==f.id)});await refreshState();document.getElementById('modal').close();}),'secondary'))],submitLabel:'Create Folder',submit:async()=>{const ids=checks.filter(([,c])=>c.checked).map(([id])=>id);await api('/personal-workspace/dm-folders','PUT',{folders:[...data.map(f=>({...f,conversationIds:f.conversationIds.filter(id=>!ids.includes(id))})),{name:name.value,conversationIds:ids}]});await refreshState();}});
 }
 async function integrations(s,content){
  const load=async()=>{const [hooks,widgets]=await Promise.all([api('/servers/'+s.id+'/webhooks'),api('/servers/'+s.id+'/widgets')]);content.replaceChildren(node('h2','','Webhooks & Live Chat Widgets'),node('p','muted','Incoming webhooks post to their assigned channel. A widget intentionally makes its selected public channel readable by website visitors. Widgets require an administrator and an allowed website origin.'));
   for(const [kind,label,items] of [['webhooks','Webhook',hooks.items],['widgets','Widget',widgets.items]]){
    content.append(button('Create '+label,()=>{const name=input('',label+' name'),channel=node('select'),origin=input('','https://your-site.example'),confirm=input('','','checkbox');for(const c of s.channels.filter(c=>c.type==='text'&&!c.forum&&!c.rules&&!c.links&&!c.bulletin))channel.append(new Option(c.name,c.id));formDialog({title:'Create '+label,fields:[field('NAME',name),field('CHANNEL',channel),...(kind==='widgets'?[field('ALLOWED WEBSITE ORIGIN',origin),field('I understand this channel will be public on my website',confirm)]:[])],submitLabel:'Create '+label,submit:async()=>{const result=await api('/servers/'+s.id+'/'+kind,'POST',{name:name.value,channelId:channel.value,...(kind==='widgets'?{origins:[origin.value],confirmPublic:confirm.checked}:{})});const value=input(result.url||result.embed);value.readOnly=true;value.setAttribute('aria-label',label+' configuration');document.getElementById('modal-content').replaceChildren(node('h2','',label+' Created'),node('p','','Copy this now. Webhook URLs contain a secret and are shown only once.'),field('COPY CONFIGURATION',value));await refreshState();await load();}});},'primary'));
    for(const item of items)content.append(node('article','plus-card',[node('strong','',item.name),button('Revoke '+label,safe(async()=>{await api('/servers/'+s.id+'/'+kind+'/'+item.id,'DELETE');await load();}),'danger')]));
   }
  };await load();
 }
 async function engagement(s,content){
  const load=async()=>{const data=await api('/servers/'+s.id+'/engagement');content.replaceChildren(node('h2','','Reaction Roles & Leveling'),node('p','muted','Reaction roles and level rewards cannot grant staff permissions or increase moderation rank. XP awards 20 points for a non-repeated message, at most once per minute.'));
   content.append(button('Add Reaction Role',()=>{
    const channel=node('select'),message=node('select'),emoji=input('✅','Emoji'),role=node('select');for(const c of s.channels.filter(c=>c.type==='text'))channel.append(new Option(c.name,c.id));for(const r of data.candidates)role.append(new Option(r.name,r.id));
    const messages=async()=>{const rows=await api('/messages?channel='+channel.value);message.replaceChildren(...rows.slice(-100).map(m=>new Option(m.author+': '+m.text.slice(0,90),m.id)));};channel.onchange=()=>messages().catch(e=>toast(e.message,true));messages().catch(e=>toast(e.message,true));
    formDialog({title:'Add Reaction Role',fields:[field('CHANNEL',channel),field('MESSAGE',message),field('EMOJI',emoji),field('ROLE',role)],submitLabel:'Save Reaction Role',submit:async()=>{await api('/servers/'+s.id+'/engagement/rules','POST',{messageId:message.value,emoji:emoji.value,roleId:role.value});await refreshState();await load();}});
   },'primary'));
   for(const rule of data.rules)content.append(node('div','bot-actions',[node('span','',rule.emoji+' → '+(s.roles.find(r=>r.id===rule.roleId)?.name||'Removed role')),button('Remove Mapping',safe(async()=>{await api('/servers/'+s.id+'/engagement/rules/'+rule.id,'DELETE');await refreshState();await load();}),'secondary')]));
   const enabled=input('','','checkbox');enabled.checked=data.leveling.enabled;const level=input('1','','number');level.min=1;level.max=100;const role=node('select');for(const r of data.candidates)role.append(new Option(r.name,r.id));
   let rewards=[...data.leveling.rewards];const rows=node('div'),draw=()=>{rows.replaceChildren();for(const r of rewards)rows.append(node('div','bot-actions',[node('span','','Level '+r.level+' → '+(s.roles.find(x=>x.id===r.roleId)?.name||r.roleId)),button('Remove Reward',()=>{rewards=rewards.filter(x=>x!==r);draw();})]));};draw();
   content.append(node('h3','','Leveling'),field('ENABLE LEVELING',enabled),rows,field('REWARD LEVEL',level),field('REWARD ROLE',role),button('Add Reward',()=>{if(rewards.some(r=>r.level===Number(level.value))){toast('That level already has a reward.',true);return;}rewards.push({level:Number(level.value),roleId:role.value});draw();}),button('Save Leveling Settings',safe(async()=>{await api('/servers/'+s.id+'/engagement/leveling','PUT',{enabled:enabled.checked,rewards});await refreshState();await load();}),'primary'));
  };await load();
 }
 async function transferThread(t){
  const s=getState().servers.find(s=>s.channels.some(c=>c.id===t.channelId));if(!s)return;
  const action=node('select'),channel=node('select'),target=node('select'),consent=input('','','checkbox'),tags=node('div');action.append(new Option('Move to another channel','move'),new Option('Merge into another thread or forum post','merge'));
  for(const c of s.channels.filter(c=>c.type==='text'&&c.permissions.includes('manageThreads')&&!c.archived))channel.append(new Option(c.name,c.id));
  const tagChecks=[];const update=async()=>{const c=s.channels.find(c=>c.id===channel.value);tags.replaceChildren();tagChecks.length=0;for(const tag of c?.forum?.tags||[]){const check=input('','','checkbox');tagChecks.push([tag.id,check]);tags.append(field(tag.name,check));}const data=await api('/threads?channel='+channel.value);target.replaceChildren(...data.filter(x=>x.id!==t.id).map(x=>new Option(x.name,x.id)));target.disabled=action.value!=='merge';};channel.onchange=()=>update().catch(e=>toast(e.message,true));action.onchange=()=>{target.disabled=action.value!=='merge';};await update();
  formDialog({title:'Move or Merge Discussion',description:'History and attachments will become visible under the destination channel’s permissions. Expanding the audience requires an administrator and explicit confirmation. Original attachment copies remain protected.',fields:[field('ACTION',action),field('DESTINATION CHANNEL',channel),field('MERGE TARGET',target),tags,field('I reviewed and approve the destination audience',consent)],submitLabel:'Transfer Discussion',submit:async()=>{const result=await api('/threads/'+t.id+'/transfer','POST',{action:action.value,channelId:channel.value,targetId:target.value,tagIds:tagChecks.filter(([,c])=>c.checked).map(([id])=>id),confirmAudienceChange:consent.checked});await refreshState();toast('Discussion transferred.');}});
 }
 async function leaderboard(s){
  const root=node('section');modal([root]);const data=await api('/servers/'+s.id+'/engagement/leaderboard');if(!root.isConnected)return;
  root.append(node('h2','',s.name+' · Leaderboard'),node('p','muted','Levels reflect eligible server messages.'));
  data.items.forEach((u,i)=>root.append(node('article','plus-card',[node('strong','',(i+1)+'. '+u.name),node('span','',' · Level '+u.level+' · '+u.xp+' XP')])));
 }
 async function stageChat(c){
  const log=node('div','thread-message-list'),text=input('','Message the Stage'),form=node('form'),send=node('button','primary','Send'),status=node('p','muted');send.type='submit';text.maxLength=getState().premium?.perks.messageCharacters||2000;form.append(field('STAGE CHAT MESSAGE',text),send);const root=node('section','',[node('h2','',c.name+' · Stage Chat'),log,form,status]);modal([root]);
  const load=async()=>{try{const messages=await api('/messages?channel='+c.id);if(!root.isConnected)return;log.replaceChildren(...messages.slice(-50).map(m=>node('p','',[node('strong','',m.author+': '),document.createTextNode(m.text)])));}catch(e){status.textContent=e.message;send.disabled=true;}};
  form.onsubmit=async e=>{e.preventDefault();send.disabled=true;try{await api('/messages','POST',{channel:c.id,text:text.value});text.value='';await load();}catch(e){status.textContent=e.message;}finally{send.disabled=false;}};
  await load();const timer=setInterval(()=>{if(!root.isConnected||!document.getElementById('modal').open){clearInterval(timer);return;}load();},2500);
 }
 async function management(s,content,shopUI){
  const nav=node('div','bot-actions'),body=node('section');content.replaceChildren(nav,body);
  nav.append(button('Recovery',()=>recovery(s,body)),...(s.permissions.includes('manageIntegrations')?[button('Webhooks & Widgets',()=>integrations(s,body))]:[]),...(s.permissions.includes('manageEngagement')?[button('Reaction Roles & Leveling',()=>engagement(s,body))]:[]),button('Server Store',()=>shopUI.store(s,body)));
  await recovery(s,body);
 }
 function applyPalette(){
  const colors=getState()?.personalWorkspace?.active?.palette||{};for(const [key,css] of Object.entries({background:'--chat',panel:'--panel',text:'--text',accent:'--accent'})){if(colors[key])document.documentElement.style.setProperty(css,colors[key]);else document.documentElement.style.removeProperty(css);}
  for(const css of ['--rail','--sidebar','--input']){if(colors.panel)document.documentElement.style.setProperty(css,colors.panel);else document.documentElement.style.removeProperty(css);}
 }
 return {leaderboard,engagement,transferThread,stageChat,management,recovery,integrations,accounts,themes,channelList,dmFolders,applyPalette};
}
