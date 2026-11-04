import {serverMark,serverBanner} from './pictures-ui.js';
export function inviteCard(server){
 const card=document.createElement('article');card.className='invite-preview';card.append(serverBanner(server,'invite-preview-banner'));const body=document.createElement('div');body.className='invite-preview-body';const title=document.createElement('h3');title.textContent=server.name;const description=document.createElement('p');description.textContent=server.description||'A place for your people.';const count=document.createElement('small');count.textContent=server.memberCount+' members';body.append(serverMark(server,'invite-preview-icon'),title,description,count);card.append(body);return card;
}
export function inviteCode(value){return String(value||'').trim().split(/[?#]/)[0].split('/').filter(Boolean).pop()||'';}
export function invitePreview(value,target){
 let generation=0;
 return async()=>{const current=++generation,code=inviteCode(typeof value==='function'?value():value);if(!code){target.replaceChildren();return;}
  try{const response=await fetch('/api/invite-preview/'+encodeURIComponent(code)),data=await response.json();if(current!==generation||!target.isConnected)return;if(!response.ok)throw Error(data.error||'Invite unavailable.');target.replaceChildren(inviteCard(data));}
  catch(e){if(current===generation&&target.isConnected){const p=document.createElement('p');p.className='muted';p.textContent=e.message;target.replaceChildren(p);}}
 };
}
export function customInviteSettings({server,node,input,button,field,api,refreshState,getState,copy,pictureControl}){
 const root=node('section','custom-invite-settings'),summary=node('p','muted'),code=input(server.customInvite?.code||'','your-community'),error=node('p','form-error'),status=node('p','invite-current-link');code.maxLength=32;code.pattern='[a-zA-Z0-9][a-zA-Z0-9-]{1,30}[a-zA-Z0-9]';
 const account=getState().me.id;let version=server.customInvite?.version||0;
 const current=()=>getState().me.id===account?getState().servers.find(s=>s.id===server.id):null;
 function paint(){const s=current();if(!s)return;const eligible=s.boosts?.level>=3;summary.textContent='Boost level '+(s.boosts?.level||0)+' · Custom invite links unlock at level 3 (14 active boosts or a platform grant).'+(s.boosts?.grant?.expiresAt?' Grant ends '+new Date(s.boosts.grant.expiresAt).toLocaleString()+'.':'');save.disabled=!eligible;code.disabled=!eligible;remove.hidden=!s.customInvite?.code;status.textContent=s.customInvite?.code?location.origin+'/invite/'+s.customInvite.code+(eligible?'':' · Paused until level 3 returns; this name stays reserved.'):'Choose a memorable invite name for your community.';copyLink.disabled=!s.customInvite?.active;}
 async function update(value){error.textContent='';const s=current();if(!s?.permissions.includes('manageServer')){error.textContent='Manage Server is required.';return;}save.disabled=true;remove.disabled=true;try{const data=await api('/servers/'+s.id+'/custom-invite','PATCH',{version,code:value});version=data.version;await refreshState();paint();}catch(e){error.textContent=e.message;paint();}finally{remove.disabled=false;}}
 const save=button('Save Custom Invite',()=>{if(!code.reportValidity())return;return update(code.value);},'primary'),remove=button('Remove Custom Invite',()=>update(null),'text-button danger'),copyLink=button('Copy Custom Invite',()=>{const s=current();if(s?.customInvite?.active)return copy(location.origin+'/invite/'+s.customInvite.code);},'secondary');
 root.append(node('h3','','CUSTOM INVITE LINK'),summary,field('CUSTOM INVITE NAME',code),status,node('div','picture-actions',[save,copyLink,remove]),error,pictureControl({kind:'inviteBanner',serverId:server.id}),node('p','muted','The invite banner appears on both regular and custom invite previews. It is separate from your server banner.'));
 paint();return {root,refresh:paint};
}
