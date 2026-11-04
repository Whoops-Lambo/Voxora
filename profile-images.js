import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';
import {isSuspended} from './platform.js';
const UUID=/^[a-f0-9-]{36}$/;
export function pictureURL(entity,kind){const id=entity?.[kind+'Image']?.id;return typeof id==='string'&&UUID.test(id)?'/api/profile-images/'+id:null;}
export function normalizePicture(content,kind,fail){
 const banner=kind==='banner'||kind==='inviteBanner',maxWidth=banner?1024:512,maxHeight=banner?576:512;
 if(content.length<33||!content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||content.readUInt32BE(8)!==13||content.toString('ascii',12,16)!=='IHDR')fail(400,'Choose an image in the picture editor. The upload must be a valid PNG.');
 const width=content.readUInt32BE(16),height=content.readUInt32BE(20);
 if(!width||!height||width>maxWidth||height>maxHeight||!banner&&width!==height)fail(400,banner?'Use a banner up to 1024×576 pixels.':'Use a square picture up to 512×512 pixels.');
 try{const decoded=PNG.sync.read(content,{checkCRC:true});return {bytes:PNG.sync.write(decoded,{colorType:6,bitDepth:8,deflateLevel:6}),width:decoded.width,height:decoded.height};}
 catch{fail(400,'This picture could not be decoded. Choose another image.');}
}
export function profileImageService({state,dataDir,bytes,json,fail,save,refresh,management,userById}){
 const directory=path.join(dataDir,'profile-images'),pending=new Set();
 const active=me=>me&&state.users.includes(me)&&!me.bot&&!isSuspended(me);
 function related(me,user){return me.id===user.id||state.servers.some(s=>s.members.includes(me.id)&&s.members.includes(user.id))||state.conversations.some(c=>c.members.includes(me.id)&&c.members.includes(user.id))||state.friendships.some(f=>[f.from,f.to].includes(me.id)&&[f.from,f.to].includes(user.id))||me.blocked?.includes(user.id)||user.blocked?.includes(me.id);}
 function asset(id,me){
  const user=state.users.find(u=>u.avatarImage?.id===id);if(user&&related(me,user))return user.avatarImage;
  const server=state.servers.find(s=>s.iconImage?.id===id||s.bannerImage?.id===id||s.inviteBannerImage?.id===id);
  if(server&&(server.members.includes(me.id)||server.discovery?.enabled&&!isSuspended(userById(server.ownerId))))return server.iconImage?.id===id?server.iconImage:server.bannerImage?.id===id?server.bannerImage:server.inviteBannerImage;
  return null;
 }
 function authorize(me,target,kind){
  if(!active(me))fail(403,'An active user account is required.');
  if(kind==='avatar'){if(me!==target)fail(403,'You can change only your own avatar.');}
  else{if(!state.servers.includes(target)||!target.members.includes(me.id))fail(404,'Server not found.');management.requirePermission(target,me,'manageServer');}
 }
 async function handle(req,res,url,me){
  const image=url.pathname.match(/^\/api\/profile-images\/([a-f0-9-]{36})$/),own=url.pathname==='/api/profile/avatar',server=url.pathname.match(/^\/api\/servers\/([\w-]+)\/(icon|banner|invite-banner)$/);
  if(!image&&!own&&!server)return false;
  if(image){if(req.method!=='GET')fail(405,'Method not allowed.');let descriptor=asset(image[1],me);if(!descriptor)fail(404,'Picture not found.');let content;try{content=await readFile(path.join(directory,image[1]));}catch(e){if(e.code==='ENOENT')fail(404,'Picture not found.');throw e;}if(!asset(image[1],me)||isSuspended(me))fail(404,'Picture not found.');res.writeHead(200,{'Content-Type':'image/png','Content-Length':content.length,'Cache-Control':'private, max-age=300','Vary':'Cookie','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'});res.end(content);return true;}
  const kind=own?'avatar':server[2]==='invite-banner'?'inviteBanner':server[2],target=own?me:state.servers.find(s=>s.id===server[1]);
  if(!target)fail(404,'Server not found.');authorize(me,target,kind);
  if(!['POST','DELETE'].includes(req.method))fail(405,'Method not allowed.');
  if([...url.searchParams.keys()].some(k=>k!=='version'))fail(400,'Unknown picture option.');
  const value=url.searchParams.get('version'),version=Number(value),versionKey=kind+'Version',imageKey=kind+'Image',key=(own?'user:':'server:')+target.id+':'+kind;
  const currentVersion=()=>target[versionKey]||0;
  const check=()=>{authorize(me,target,kind);if(!value||!/^\d+$/.test(value)||!Number.isSafeInteger(version)||version!==currentVersion()||pending.has(key))fail(409,'This picture changed. Refresh before trying again.');};check();
  const content=req.method==='POST'?await bytes(req,3*1024*1024):null;check();
  const normalized=content?normalizePicture(content,kind,fail):null;
  pending.add(key);const previous=target[imageKey]||null;let descriptor=null,temporary=null,attached=false,committed=false;
  try{
   if(normalized){descriptor={id:randomUUID(),mime:'image/png',width:normalized.width,height:normalized.height,size:normalized.bytes.length,updatedAt:Date.now()};await mkdir(directory,{recursive:true});temporary=path.join(directory,descriptor.id+'.tmp');await writeFile(temporary,normalized.bytes,{flag:'wx',mode:0o600});authorize(me,target,kind);if(currentVersion()!==version)fail(409,'This picture changed during upload. Refresh before retrying.');await rename(temporary,path.join(directory,descriptor.id));temporary=null;}
   authorize(me,target,kind);if(currentVersion()!==version)fail(409,'This picture changed. Refresh and try again.');
   target[imageKey]=descriptor;target[versionKey]=version+1;attached=true;
   let auditId=null;if(!own){management.log(target,me,descriptor?'Server '+kind+' updated':'Server '+kind+' removed',target.name);auditId=target.auditLog[0]?.id;}
   try{await save();committed=true;}catch(error){target[imageKey]=previous;target[versionKey]=version;if(auditId)target.auditLog=target.auditLog.filter(a=>a.id!==auditId);throw error;}
   // The image reference is saved before retiring the old bytes.
   if(previous)await unlink(path.join(directory,previous.id)).catch(()=>{});
   refresh();json(res,200,{url:pictureURL(target,kind),version:target[versionKey]});return true;
  }finally{
   pending.delete(key);if(temporary)await unlink(temporary).catch(()=>{});
   // A queued state write may still reference an attached image after an IO
   // failure. Keep its bytes until startup cleanup can check persisted state.
   if(descriptor&&!committed&&!attached)await unlink(path.join(directory,descriptor.id)).catch(()=>{});
  }
 }
 async function cleanup(){const referenced=new Set([...state.users.map(u=>u.avatarImage?.id),...state.servers.flatMap(s=>[s.iconImage?.id,s.bannerImage?.id,s.inviteBannerImage?.id])].filter(Boolean));for(const file of await readdir(directory).catch(()=>[])){const id=file.replace(/\.tmp$/,'');if(UUID.test(id)&&(!referenced.has(id)||file.endsWith('.tmp')))await unlink(path.join(directory,file)).catch(()=>{});}}
 async function serveInvite(server,id,res,valid){
  const image=()=>[server.iconImage,server.inviteBannerImage,server.bannerImage].some(i=>i?.id===id);if(!image()||!UUID.test(id)||!valid())fail(404,'Invite image not found.');let content;try{content=await readFile(path.join(directory,id));}catch(e){if(e.code==='ENOENT')fail(404,'Invite image not found.');throw e;}if(!valid()||!image())fail(404,'Invite image not found.');res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'});res.end(content);
 }
 return {handle,cleanup,serveInvite};
}
