import {serverMark,serverBanner} from './pictures-ui.js';
export function inviteCard(server){
 const card=document.createElement('article');card.className='invite-preview';card.append(serverBanner(server,'invite-preview-banner'));const body=document.createElement('div');body.className='invite-preview-body';const title=document.createElement('h3');title.textContent=server.name;const description=document.createElement('p');description.textContent=server.description||'A place for your people.';const count=document.createElement('small');count.textContent=server.memberCount+(server.memberCount===1?' member':' members');body.append(serverMark(server,'invite-preview-icon'),title,description,count);if(server.joinPaused){const notice=document.createElement('p');notice.className='form-error';notice.textContent='New members are temporarily paused. Try this invite again after the safety pause.';body.append(notice);}card.append(body);return card;
}
export function inviteCode(value){return String(value||'').trim().split(/[?#]/)[0].split('/').filter(Boolean).pop()||'';}
export function invitePreview(value,target){
 let generation=0;
 return async()=>{const current=++generation,code=inviteCode(typeof value==='function'?value():value);if(!code){target.replaceChildren();return;}
  try{const response=await fetch('/api/invite-preview/'+encodeURIComponent(code)),data=await response.json();if(current!==generation||!target.isConnected)return;if(!response.ok)throw Error(data.error||'Invite unavailable.');target.replaceChildren(inviteCard(data));}
  catch(e){if(current===generation&&target.isConnected){const p=document.createElement('p');p.className='muted';p.textContent=e.message;target.replaceChildren(p);}}
 };
}
function inviteSettingsForm({slot=1,server,node,input,button,field,api,refreshState,getState,copy,pictureControl}){
 const inviteKey=slot===2?'customInviteSecondary':'customInvite',suffix=slot===2?'/secondary':'';
 const root=node('section','custom-invite-settings'),summary=node('p','muted'),code=input(server[inviteKey]?.code||'','your-community'),error=node('p','form-error'),status=node('p','invite-current-link');code.maxLength=32;code.pattern='[a-zA-Z0-9](?:[a-zA-Z0-9]|-){1,30}[a-zA-Z0-9]';
 const account=getState().me.id;let version=server[inviteKey]?.version||0;
 const current=()=>getState()?.me?.id===account?getState().servers.find(s=>s.id===server.id):null;
 function paint(){const s=current();if(!s)return;const eligible=s.boosts?.level>=3;summary.textContent='Boost level '+(s.boosts?.level||0)+' · Custom invite links unlock at level 3 (14 active boosts or a platform grant).'+(s.boosts?.grant?.expiresAt?' Grant ends '+new Date(s.boosts.grant.expiresAt).toLocaleString()+'.':'');save.disabled=!eligible;code.disabled=!eligible;remove.hidden=!s[inviteKey]?.code;status.textContent=s[inviteKey]?.code?location.origin+'/invite/'+s[inviteKey].code+(eligible?'':' · Paused until level 3 returns; this name stays reserved.'):'Choose a memorable invite name for your community.';copyLink.disabled=!s[inviteKey]?.active;}
 async function update(value){error.textContent='';const s=current();if(!s?.permissions.includes('manageServer')){error.textContent='Manage Server is required.';return;}save.disabled=true;remove.disabled=true;try{const data=await api('/servers/'+s.id+'/custom-invite'+suffix,'PATCH',{version,code:value});version=data.version;await refreshState();paint();}catch(e){error.textContent=e.message;paint();}finally{remove.disabled=false;}}
 const save=button(slot===2?'Save Second Custom Invite':'Save Custom Invite',()=>{if(!code.reportValidity())return;return update(code.value);},'primary'),remove=button(slot===2?'Remove Second Custom Invite':'Remove Custom Invite',()=>update(null),'text-button danger'),copyLink=button(slot===2?'Copy Second Custom Invite':'Copy Custom Invite',()=>{const s=current();if(s?.[inviteKey]?.active)return copy(location.origin+'/invite/'+s[inviteKey].code);},'secondary');
 root.append(node('h3','',slot===2?'SECOND CUSTOM INVITE LINK':'CUSTOM INVITE LINK'),summary,field(slot===2?'SECOND CUSTOM INVITE NAME':'CUSTOM INVITE NAME',code),status,node('div','picture-actions',[save,copyLink,remove]),error,...(slot===1?[pictureControl({kind:'inviteBanner',serverId:server.id}),node('p','muted','The invite banner appears on regular and both custom invite previews. It is separate from your server banner.')]:[]));
 paint();return {root,refresh:paint};
}

export function customInviteSettings(options){const first=inviteSettingsForm(options),second=inviteSettingsForm({...options,slot:2}),root=options.node('div','custom-invite-group',[first.root,second.root]);return {root,refresh:()=>{first.refresh();second.refresh();}};}
