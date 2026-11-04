import {boostSummary} from './premium.js';
export function serverBoostService({state,body,json,fail,save,refresh,platform}){
 const view=s=>({id:s.id,name:s.name,owner:state.users.find(u=>u.id===s.ownerId)?.displayName||'Unknown',memberCount:s.members.length,boosts:boostSummary(state,s),version:s.boostGrant?.version||0,grant:s.boostGrant?{level:s.boostGrant.level,expiresAt:s.boostGrant.expiresAt,reason:s.boostGrant.reason,grantedAt:s.boostGrant.grantedAt}:null});
 function authorize(me){if(!platform.permissions(me).includes('manageBoosts'))fail(403,'You need the Manage Server Boosts platform permission.');}
 async function handle(req,res,url,me){const m=url.pathname.match(/^\/api\/platform\/server-boosts(?:\/([\w-]+))?$/);if(!m)return false;const d=req.method==='PATCH'?await body(req):{};authorize(me);
  if(req.method==='GET'&&!m[1]){const q=(url.searchParams.get('q')||'').toLowerCase(),offset=Number(url.searchParams.get('offset')||0);if(q.length>100||!Number.isSafeInteger(offset)||offset<0)fail(400,'Invalid boost search or page.');const servers=state.servers.filter(s=>(s.name+' '+s.id).toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name));json(res,200,{items:servers.slice(offset,offset+25).map(view),total:servers.length,offset,hasMore:offset+25<servers.length});return true;}
  const s=state.servers.find(s=>s.id===m[1]);if(!s)fail(404,'Server not found.');if(req.method!=='PATCH')fail(405,'Method not allowed.');
  if(Object.keys(d).some(k=>!['version','level','expiresAt','reason'].includes(k)))fail(400,'Unknown server boost setting.');
  if(!Number.isSafeInteger(d.version)||d.version!==(s.boostGrant?.version||0))fail(409,'The server boost grant changed. Refresh before saving.');
  if(![0,1,2,3].includes(d.level)||typeof d.reason!=='string'||!d.reason.trim()||d.reason.length>500)fail(400,'Choose a boost level and give a reason up to 500 characters.');
  if(d.level!==0&&d.expiresAt!==null&&(!Number.isSafeInteger(d.expiresAt)||d.expiresAt<Date.now()+1000||d.expiresAt>Date.now()+3660*86400000))fail(400,'Choose an expiry within ten years, or unlimited time.');
  s.boostGrant={version:d.version+1,level:d.level,expiresAt:d.level===0?null:d.expiresAt,reason:d.reason.trim(),grantedBy:me.id,grantedAt:Date.now()};platform.log(me,d.level?'Server boost level granted':'Server boost grant revoked',s.name,d.reason.trim());await save();refresh();json(res,200,view(s));return true;
 }
 let previous=new Map(state.servers.map(s=>[s.id,boostSummary(state,s).level]));const timer=setInterval(()=>{let changed=false;for(const s of state.servers){const level=boostSummary(state,s).level;if(previous.has(s.id)&&previous.get(s.id)!==level)changed=true;previous.set(s.id,level);}for(const id of previous.keys())if(!state.servers.some(s=>s.id===id))previous.delete(id);if(changed)refresh();},1000);timer.unref();
 return {handle,close:()=>clearInterval(timer)};
}
