import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {boostSummary} from './premium.js';
import {roleRank,serverPermissions} from './public/permissions.js';
export async function richImage(content,{width=512,height=512,animated=false}={},fail){
 try{
  const {default:sharp}=await import('sharp'),image=sharp(content,{animated:true,limitInputPixels:60*1024*1024}),metadata=await image.metadata();
  if(!['png','gif','webp','jpeg'].includes(metadata.format)||!metadata.width||!metadata.height||(metadata.pages||1)>120)fail(400,'Choose a PNG, GIF, WebP or JPEG with at most 120 frames.');
  const moving=(metadata.pages||1)>1;if(moving&&!animated)fail(403,'This boost level does not allow an animated image here.');
  const bytes=await image.resize(width,height,{fit:'inside',withoutEnlargement:true}).webp({quality:85,effort:3}).toBuffer();
  if(bytes.length>8*1024*1024)fail(400,'The normalized image is too large.');
  return{bytes,mime:'image/webp',animated:moving,width:Math.min(metadata.width,width),height:Math.min(metadata.pageHeight||metadata.height,height)};
 }catch(e){if(e.status)throw e;fail(400,'This image could not be decoded.');}
}
export function roleIconService({state,dataDir,bytes,json,fail,save,refresh,management}){
 const dir=path.join(dataDir,'role-icons'),pending=new Set();
 async function handle(req,res,url,me){
  const m=url.pathname.match(/^\/api\/servers\/([\w-]+)\/roles\/([\w-]+)\/icon$/),asset=url.pathname.match(/^\/api\/role-icons\/([\w-]+)$/);if(!m&&!asset)return false;
  if(asset){const s=state.servers.find(s=>s.roles.some(r=>r.icon?.id===asset[1]));if(!s||!s.members.includes(me.id)||!boostSummary(state,s).roleIcons)fail(404,'Role icon unavailable.');const r=s.roles.find(r=>r.icon?.id===asset[1]);if(r.icon.animated&&!boostSummary(state,s).animatedRoleIcons)fail(404,'Animated role icon unavailable.');const data=await readFile(path.join(dir,asset[1])).catch(()=>null);if(!data||!s.members.includes(me.id)||r.icon?.id!==asset[1]||!boostSummary(state,s).roleIcons||r.icon.animated&&!boostSummary(state,s).animatedRoleIcons)fail(404,'Role icon not found.');res.writeHead(200,{'Content-Type':r.icon.mime,'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'});res.end(data);return true;}
  const s=state.servers.find(s=>s.id===m[1]),r=s?.roles.find(r=>r.id===m[2]);
  const check=()=>{if(!s||!r||!state.servers.includes(s)||!s.roles.includes(r)||!s.members.includes(me.id)||!serverPermissions(s,me.id).includes('manageRoles')||me.id!==s.ownerId&&r.position>=roleRank(s,me.id))fail(403,'You can manage icons only for roles below your own.');if(req.method==='POST'&&!boostSummary(state,s).roleIcons)fail(403,'Custom role icons require boost level 2.');};check();
  const key=s.id+':'+r.id;if(pending.has(key))fail(409,'This role icon is being updated. Try again.');pending.add(key);try{
  if(req.method==='DELETE'){const old=r.icon;r.icon=null;management.log(s,me,'Role icon removed',r.name);await save();if(old)await unlink(path.join(dir,old.id)).catch(()=>{});refresh();json(res,200,{ok:true});return true;}
  if(req.method!=='POST')fail(405,'Method not allowed.');
  const content=await bytes(req,8*1024*1024);check();const normalized=await richImage(content,{width:64,height:64,animated:boostSummary(state,s).animatedRoleIcons},fail);check();if(normalized.animated&&!boostSummary(state,s).animatedRoleIcons)fail(403,'Animated role icons require boost level 3.');
  const descriptor={id:randomUUID(),mime:normalized.mime,animated:normalized.animated};await mkdir(dir,{recursive:true});await writeFile(path.join(dir,descriptor.id),normalized.bytes);try{check();}catch(e){await unlink(path.join(dir,descriptor.id)).catch(()=>{});throw e;}const old=r.icon;r.icon=descriptor;management.log(s,me,'Role icon updated',r.name);try{await save();}catch(e){r.icon=old;await unlink(path.join(dir,descriptor.id)).catch(()=>{});throw e;}if(old)await unlink(path.join(dir,old.id)).catch(()=>{});refresh();json(res,201,{url:'/api/role-icons/'+descriptor.id});return true;
 }finally{pending.delete(key);}
 }return {handle};
}
