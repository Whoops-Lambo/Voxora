export function verificationView(server){
  const v=server.verification;
  const verified=v?.verified===true&&v.name===server.name&&v.ownerId===server.ownerId;
  return {verified,verifiedAt:verified?v.reviewedAt:null};
}
export function invalidateChangedVerifications(state,onInvalidate=()=>{}){
  let changed=false;
  for(const s of state.servers){const v=s.verification;if(v?.verified&&!verificationView(s).verified){s.verification={...v,verified:false,version:(Number.isSafeInteger(v.version)?v.version:0)+1,reviewedAt:Date.now(),reviewedBy:null,reason:'Server name or ownership changed; review required.'};onInvalidate(s);changed=true;}}
  return changed;
}
export function serverVerificationService({state,body,json,fail,save,refresh,platform,userById}){
  function requireStaff(me){if(!platform.permissions(me).includes('verifyServers'))fail(403,'Verify Servers staff permission is required.');}
  const view=s=>({id:s.id,name:s.name,description:s.description||'',ownerId:s.ownerId,owner:userById(s.ownerId)?.username||'Unclaimed',memberCount:s.members.filter(id=>!userById(id)?.bot).length,verification:verificationView(s),version:s.verification?.version||0,reason:s.verification?.reason||'',reviewedAt:s.verification?.reviewedAt||null});
  async function handle(req,res,url,me){
    const match=url.pathname.match(/^\/api\/platform\/server-verifications(?:\/([\w-]+))?$/);if(!match)return false;
    const d=req.method==='PATCH'?await body(req):{};requireStaff(me);
    if(req.method==='GET'&&!match[1]){
      const q=(url.searchParams.get('q')||'').trim().toLowerCase(),status=url.searchParams.get('status')||'all',offset=Number(url.searchParams.get('offset')||0);
      if(q.length>100||!['all','verified','unverified'].includes(status)||!Number.isSafeInteger(offset)||offset<0)fail(400,'Invalid verification search.');
      const items=state.servers.map(view).filter(s=>(!q||(s.id+' '+s.name+' '+s.owner).toLowerCase().includes(q))&&(status==='all'||s.verification.verified===(status==='verified'))).sort((a,b)=>a.name.localeCompare(b.name));
      json(res,200,{items:items.slice(offset,offset+25),offset,total:items.length,hasMore:offset+25<items.length});return true;
    }
    const s=state.servers.find(s=>s.id===match[1]);if(!s)fail(404,'Server not found.');
    if(req.method==='GET'){json(res,200,view(s));return true;}
    if(req.method!=='PATCH')fail(405,'Method not allowed.');
    if(Object.keys(d).some(k=>!['version','verified','reason','reviewed','name','ownerId'].includes(k))||typeof d.verified!=='boolean'||typeof d.reason!=='string'||d.reason.trim().length<3||d.reason.trim().length>500)fail(400,'Provide a verification decision and review reason (3–500 characters).');
    if(!Number.isSafeInteger(d.version)||d.version!==(s.verification?.version||0))fail(409,'This server’s verification changed. Refresh before saving.');
    if(d.verified&&(d.reviewed!==true||d.name!==s.name||d.ownerId!==s.ownerId||!userById(s.ownerId)))fail(409,'Review this server’s current name and owner before verifying it.');
    s.verification={verified:d.verified,version:d.version+1,name:s.name,ownerId:s.ownerId,reviewedBy:me.id,reviewedAt:Date.now(),reason:d.reason.trim()};
    platform.log(me,d.verified?'Server verified':'Server verification revoked',s.name+' · '+s.id,d.reason.trim());await save();refresh();json(res,200,view(s));return true;
  }
  return {handle};
}
