import {randomUUID} from 'node:crypto';
import {isSuspended} from './platform.js';
export function notebookService({body,json,fail,save,notify}){
 const active=me=>{if(!me||me.bot||isSuspended(me))fail(403,'Notebook requires an active human account.');me.notebook||=[];return me.notebook;};
 const keys=(d,allowed)=>{if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!allowed.includes(k)))fail(400,'Unsupported notebook field.');};
 function fields(d,old){const title=d.title===undefined?old?.title:d.title,content=d.content===undefined?old?.content||'':d.content,color=d.color===undefined?old?.color||'mint':d.color,pinned=d.pinned===undefined?old?.pinned||false:d.pinned;if(typeof title!=='string'||!title.trim()||title.length>120||typeof content!=='string'||content.length>12000||!['mint','copper','iris'].includes(color)||typeof pinned!=='boolean')fail(400,'Use a title up to 120 characters and a note up to 12,000 characters.');return{title:title.trim(),content,color,pinned};}
 async function handle(req,res,url,me){const m=url.pathname.match(/^\/api\/me\/notes(?:\/([\w-]+))?$/);if(!m)return false;const method=req.method,d=['POST','PATCH'].includes(method)?await body(req):{},notes=active(me),note=m[1]&&notes.find(n=>n.id===m[1]);if(m[1]&&!note)fail(404,'Note not found.');
  if(method==='GET'){if(note){json(res,200,note);return true;}const q=(url.searchParams.get('q')||'').toLowerCase();if(q.length>100)fail(400,'Search up to 100 characters.');const list=notes.filter(n=>(n.title+' '+n.content).toLowerCase().includes(q)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt-a.updatedAt);json(res,200,{items:list,total:list.length});return true;}
  if(method==='POST'&&!note){keys(d,['title','content','color','pinned']);if(notes.length>=200)fail(400,'Delete an old note before adding more than 200.');const next={id:randomUUID(),...fields(d),revision:0,createdAt:Date.now(),updatedAt:Date.now()};notes.push(next);await save();notify(me.id);json(res,201,next);return true;}
  if(method==='PATCH'&&note){keys(d,['revision','title','content','color','pinned']);if(note.revision!==d.revision)fail(409,'This note changed on another device. Reopen it before saving.');Object.assign(note,fields(d,note),{revision:note.revision+1,updatedAt:Date.now()});await save();notify(me.id);json(res,200,note);return true;}
  if(method==='DELETE'&&note){if(!url.searchParams.has('revision')||note.revision!==Number(url.searchParams.get('revision')))fail(409,'This note changed. Reopen it before deleting.');me.notebook=notes.filter(n=>n!==note);await save();notify(me.id);json(res,200,{ok:true});return true;}fail(405,'Method not allowed.');
 }
 return {handle};
}
