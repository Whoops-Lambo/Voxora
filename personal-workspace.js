import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {premiumPerks} from './premium.js';
import {channelPermissions} from './public/permissions.js';
import {isSuspended} from './platform.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function personalWorkspaceService({state,body,json,fail,save,refresh,sessionFor,cookie,userById}){
 state.themeShares||=[];state.accountSwitchers||=[];
 const exportedKeys=['background','panel','text','accent'];
 const palette=d=>{if(!d||Object.keys(d).length!==4||exportedKeys.some(k=>!/^#[a-f0-9]{6}$/i.test(d[k]||'')))fail(400,'Choose four six-digit theme colors.');return Object.fromEntries(exportedKeys.map(k=>[k,d[k]]));};
 const init=me=>{me.personalWorkspace||={themes:[],active:null,dmFolders:[],channelLists:{}};me.personalWorkspace.scenes||=[];return me.personalWorkspace;};
 function view(me){const p=init(me),active=p.active&&(p.active.ownerId!==me.id||p.themes.findIndex(t=>t.id===p.active.themeId)>=0&&p.themes.findIndex(t=>t.id===p.active.themeId)<premiumPerks(me).customThemes&&premiumPerks(me).customThemes>0)?p.active:null;return{...p,active,themeLimit:premiumPerks(me).customThemes,shares:state.themeShares.filter(s=>s.ownerId===me.id).map(({code,themeId})=>({code,themeId}))};}
 const switchToken=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('voxora_accounts='))?.slice(16);
 const switcher=req=>{const token=switchToken(req),group=token&&state.accountSwitchers.find(s=>s.hash===hash(token)&&s.expiresAt>Date.now());if(group)group.userIds=group.userIds.filter(id=>state.sessions.some(s=>s.userId===id&&s.hash===group.proofs?.[id]&&s.expires>Date.now()));return group;};
 function enroll(req,user,sessionToken){
  let group=switcher(req),token;
  if(!group){token=randomBytes(32).toString('hex');group={hash:hash(token),userIds:[],expiresAt:Date.now()+2592000000};state.accountSwitchers.push(group);}
  if(!group.userIds.includes(user.id)){if(group.userIds.length>=10)group.userIds.shift();group.userIds.push(user.id);}
  group.proofs||={};group.proofs[user.id]=hash(sessionToken);
  group.expiresAt=Date.now()+2592000000;
  return token?cookie(req,token).replace('voxora_session=','voxora_accounts='):null;
 }
 function forget(req,user){const group=switcher(req);if(group)group.userIds=group.userIds.filter(id=>id!==user.id);}
 async function handle(req,res,url,me){
  const path=url.pathname,m=path.match(/^\/api\/personal-workspace(?:\/(themes|apply|share|dm-folders|channel-lists|activity|scenes)(?:\/([\w-]+))?)?$/),accounts=path==='/api/accounts';
  if(!m&&!accounts)return false;
  const d=(['POST','PATCH','PUT'].includes(req.method)||accounts&&req.method==='DELETE')?await body(req,128000):{};
  if(accounts){
   const group=switcher(req);
   if(req.method==='GET'){json(res,200,{items:(group?.userIds||[me.id]).map(userById).filter(u=>u&&!u.bot&&!isSuspended(u)).map(u=>({id:u.id,username:u.username,displayName:u.displayName,active:u.id===me.id}))});return true;}
   if(!group||!group.userIds.includes(d.userId))fail(403,'Sign in to this account before switching to it.');
   const u=userById(d.userId);if(!u||isSuspended(u))fail(403,'This account is unavailable.');
   if(req.method==='DELETE'){group.userIds=group.userIds.filter(id=>id!==d.userId);await save();json(res,200,{ok:true});return true;}
   if(req.method!=='POST')fail(405,'Method not allowed.');
   const token=randomBytes(32).toString('hex');state.sessions.push({id:randomUUID(),agent:String(req.headers['user-agent']||'Account switcher').slice(0,160),createdAt:Date.now(),hash:hash(token),userId:u.id,expires:Date.now()+2592000000});group.proofs[u.id]=hash(token);await save();json(res,200,{ok:true},{'Set-Cookie':cookie(req,token)});return true;
  }
  const p=init(me),[,kind,id]=m;
  if(req.method==='GET'){json(res,200,view(me));return true;}
  if(kind==='themes'){
   if(req.method==='POST'){
    if(p.themes.length>=premiumPerks(me).customThemes)fail(403,'Your plan does not have a free custom-theme slot.');
    if(typeof d.name!=='string'||!d.name.trim()||d.name.length>60)fail(400,'Choose a theme name.');
    const t={id:randomUUID(),name:d.name.trim(),palette:palette(d.palette)};p.themes.push(t);
   }else if(req.method==='DELETE'){p.themes=p.themes.filter(t=>t.id!==id);state.themeShares=state.themeShares.filter(s=>s.ownerId!==me.id||s.themeId!==id);if(p.active?.themeId===id&&p.active.ownerId===me.id)p.active=null;}
   else fail(405,'Method not allowed.');
  }else if(kind==='apply'){
   if(d.reset===true)p.active=null;
   else{
    const shared=d.code&&state.themeShares.find(s=>s.code===d.code),owner=shared?userById(shared.ownerId):me,ownerState=owner&&init(owner);
    const theme=ownerState?.themes.find(t=>t.id===(shared?.themeId||d.themeId));
    if(!theme||owner.id===me.id&&(premiumPerks(me).customThemes===0||p.themes.indexOf(theme)>=premiumPerks(me).customThemes))fail(403,'Theme is unavailable for this account.');
    p.active={themeId:theme.id,ownerId:owner.id,name:theme.name,palette:theme.palette};
   }
  }else if(kind==='share'){
   if(req.method==='DELETE'){state.themeShares=state.themeShares.filter(s=>s.code!==id||s.ownerId!==me.id);}
   else{if(!p.themes.slice(0,premiumPerks(me).customThemes).some(t=>t.id===d.themeId))fail(403,'Choose one of your available custom themes.');const existing=state.themeShares.find(s=>s.ownerId===me.id&&s.themeId===d.themeId);if(!existing)state.themeShares.push({code:randomBytes(16).toString('hex'),themeId:d.themeId,ownerId:me.id});}
  }else if(kind==='dm-folders'){
   if(!Array.isArray(d.folders)||d.folders.length>20)fail(400,'Use up to 20 DM folders.');const seen=new Set();
   p.dmFolders=d.folders.map(f=>{if(typeof f.name!=='string'||!f.name.trim()||f.name.length>40||!Array.isArray(f.conversationIds))fail(400,'Choose a folder name and conversations.');for(const id of f.conversationIds){if(seen.has(id)||!state.conversations.some(c=>c.id===id&&c.members.includes(me.id)))fail(400,'Each accessible conversation can belong to one folder.');seen.add(id);}return{id:f.id&&/^[\w-]{1,80}$/.test(f.id)?f.id:randomUUID(),name:f.name.trim(),conversationIds:f.conversationIds};});
  }else if(kind==='channel-lists'){
   const s=state.servers.find(s=>s.id===id&&s.members.includes(me.id));if(!s)fail(404,'Server not found.');
   const values=['order','hidden'];for(const key of values)if(!Array.isArray(d[key])||new Set(d[key]).size!==d[key].length||d[key].some(id=>!channelPermissions(s,me.id,id).includes('viewChannel')))fail(400,'Choose channels you can view, once each.');
   p.channelLists[s.id]={order:d.order,hidden:d.hidden};
  }else if(kind==='scenes'){
   if(req.method==='DELETE')p.scenes=p.scenes.filter(s=>s.id!==id);
   else{
    if(!premiumPerks(me).workspaceScenes)fail(403,'Workspace Scenes require Voxora Max.');
    if(id){const scene=p.scenes.find(s=>s.id===id);if(!scene)fail(404,'Scene not found.');p.active=structuredClone(scene.active);p.dmFolders=scene.dmFolders.map(f=>({...f,conversationIds:f.conversationIds.filter(id=>state.conversations.some(c=>c.id===id&&c.members.includes(me.id)))}));p.channelLists=Object.fromEntries(Object.entries(scene.channelLists).filter(([id])=>state.servers.some(s=>s.id===id&&s.members.includes(me.id))).map(([id,value])=>{const server=state.servers.find(s=>s.id===id),allowed=x=>channelPermissions(server,me.id,x).includes('viewChannel');return[id,{order:value.order.filter(allowed),hidden:value.hidden.filter(allowed)}];}));}
    else{if(typeof d.name!=='string'||!d.name.trim()||d.name.length>60||p.scenes.length>=premiumPerks(me).workspaceScenes)fail(400,'Choose a scene name and an available Max scene slot.');p.scenes.push({id:randomUUID(),name:d.name.trim(),active:structuredClone(p.active),channelLists:structuredClone(p.channelLists),dmFolders:structuredClone(p.dmFolders)});}
   }
  }else if(kind==='activity'){
   if(d.game!==null&&(typeof d.game!=='string'||!d.game.trim()||d.game.length>80))fail(400,'Game activity must be up to 80 characters.');me.gameActivity=d.game?{name:d.game.trim(),startedAt:Date.now(),expiresAt:d.automatic===true?Date.now()+90000:null}:null;
  }else fail(405,'Method not allowed.');
  await save();refresh();json(res,200,view(me));return true;
 }
 return {handle,view,enroll,forget};
}
