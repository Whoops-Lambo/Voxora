import {boostSummary} from './premium.js';
import {isSuspended} from './platform.js';
export function resolveInvite(state,value,now=Date.now()){
 const code=String(value||'').trim().split(/[?#]/)[0].split('/').filter(Boolean).pop()?.toLowerCase();if(!code)return null;
 for(const server of state.servers){
  if(server.customInvite?.code===code&&boostSummary(state,server,now).level>=3)return {server,invite:server.customInvite,custom:true};
  const invite=server.invites.find(i=>i.code===code&&(!i.expiresAt||i.expiresAt>now)&&(!i.maxUses||i.uses<i.maxUses));if(invite)return {server,invite,custom:false};
 }return null;
}
export function customInviteView(state,server){const item=server.customInvite;return {code:item?.code||null,version:item?.version||0,uses:item?.uses||0,eligible:boostSummary(state,server).level>=3,active:!!item?.code&&boostSummary(state,server).level>=3};}
export function inviteService({state,body,json,fail,save,refresh,management,serveImage}){
 const preview=(server,code)=>{const url=image=>image?.id?'/api/invite-images/'+encodeURIComponent(code)+'/'+image.id:null;return {id:server.id,name:server.name,description:server.description||'',memberCount:server.members.filter(id=>!state.users.find(u=>u.id===id)?.bot).length,iconUrl:url(server.iconImage),bannerUrl:url(server.inviteBannerImage||server.bannerImage),boostLevel:boostSummary(state,server).level};};
 async function handlePublic(req,res,url){
  const image=url.pathname.match(/^\/api\/invite-images\/([\w-]+)\/([a-f0-9-]{36})$/),info=url.pathname.match(/^\/api\/invite-preview\/([\w-]+)$/);if(!image&&!info)return false;if(req.method!=='GET')fail(405,'Method not allowed.');const code=(image||info)[1],resolved=resolveInvite(state,code);if(!resolved)fail(404,'This invite is unavailable or has expired.');
  if(info){res.setHeader('Cache-Control','no-store');json(res,200,preview(resolved.server,code));return true;}
  await serveImage(resolved.server,image[2],res,()=>resolveInvite(state,code)?.server.id===resolved.server.id);return true;
 }
 async function handle(req,res,url,me){const m=url.pathname.match(/^\/api\/servers\/([\w-]+)\/custom-invite$/);if(!m)return false;const d=req.method==='PATCH'?await body(req):{},s=state.servers.find(s=>s.id===m[1]&&s.members.includes(me.id));if(!s||isSuspended(me))fail(404,'Server not found.');management.requirePermission(s,me,'manageServer');
  if(req.method==='GET'){json(res,200,customInviteView(state,s));return true;}if(req.method!=='PATCH')fail(405,'Method not allowed.');
  if(Object.keys(d).some(k=>!['version','code'].includes(k))||!Number.isSafeInteger(d.version)||d.version!==(s.customInvite?.version||0))fail(409,'The custom invite changed. Refresh before saving.');
  const code=d.code===null?'':typeof d.code==='string'?d.code.trim().toLowerCase():null;if(code===null||code&&!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(code))fail(400,'Use 3–32 letters, numbers or hyphens, starting and ending with a letter or number.');
  if(code&&boostSummary(state,s).level<3)fail(403,'Boost level 3 is required for a custom invite link.');
  if(code&&state.servers.some(other=>other.invites.some(i=>i.code===code)||other!==s&&other.customInvite?.code===code))fail(409,'That invite name is already reserved.');
  const previous=s.customInvite;s.customInvite={code:code||null,version:(previous?.version||0)+1,uses:previous?.code===code?previous.uses||0:0};management.log(s,me,code?'Custom invite updated':'Custom invite removed',code||s.name);await save();refresh();json(res,200,customInviteView(state,s));return true;
 }
 return {handle,handlePublic};
}
