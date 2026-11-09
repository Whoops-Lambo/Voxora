export function platformReportService({state,body,json,fail,save,refresh,platform,canRead,userById}){
 const open=c=>['open','reviewing'].includes(c.status);
 const canReview=(me,s,c)=>platform.permissions(me).includes('reviewReports')&&c.kind==='report'&&(canRead(me,c.channel)||c.reporters.some(r=>r.sendToPlatform));
 const all=me=>state.servers.flatMap(s=>(s.moderation?.cases||[]).filter(c=>canReview(me,s,c)).map(c=>({s,c})));
 const overview=me=>{const list=all(me);return {open:list.filter(({c})=>open(c)).length,mine:list.filter(({c})=>open(c)&&c.assigneeId===me.id).length,total:list.length};};
 const view=(me,s,c)=>({id:c.id,number:c.number,version:c.version,status:c.status,serverId:s.id,serverName:s.name,channelName:canRead(me,c.channel)?s.channels.find(ch=>ch.id===c.channel)?.name||'Deleted channel':'Reported private channel',createdAt:c.createdAt,updatedAt:c.updatedAt,evidence:{authorId:c.snapshot.authorId,authorName:c.snapshot.authorName,text:c.snapshot.text,files:c.snapshot.files||[]},reporters:c.reporters.filter(r=>canRead(me,c.channel)||r.sendToPlatform).map(r=>({name:userById(r.userId)?.displayName||r.name,reason:r.reason,details:r.details,time:r.time})),assigneeId:c.assigneeId||null,assigneeName:c.assigneeId?userById(c.assigneeId)?.displayName||'Former staff member':null});
 async function handle(req,res,url,me){const match=url.pathname.match(/^\/api\/platform\/reports(?:\/([\w-]+))?$/);if(!match)return false;const d=req.method==='PATCH'?await body(req):{};
  if(!platform.permissions(me).includes('reviewReports'))fail(403,'You need the Review Platform Reports staff permission.');
  if(req.method==='GET'&&!match[1]){const status=url.searchParams.get('status')||'open',q=(url.searchParams.get('q')||'').trim().toLowerCase(),offset=Number(url.searchParams.get('offset')||0);if(!['open','reviewing','resolved','dismissed','all'].includes(status)||q.length>100||!Number.isSafeInteger(offset)||offset<0)fail(400,'Invalid report filter.');const list=all(me).filter(({s,c})=>(status==='all'||status==='open'?status==='all'||open(c):c.status===status)&&(!q||(s.name+' '+c.snapshot.authorName+' '+c.snapshot.text+' '+c.number).toLowerCase().includes(q))).sort((a,b)=>b.c.updatedAt-a.c.updatedAt);json(res,200,{items:list.slice(offset,offset+25).map(({s,c})=>view(me,s,c)),total:list.length,offset,hasMore:offset+25<list.length,counts:overview(me)});return true;}
  const found=all(me).find(({c})=>c.id===match[1]);if(!found)fail(404,'Report not found.');const {s,c}=found;
  if(req.method==='GET'){json(res,200,view(me,s,c));return true;}
  if(req.method!=='PATCH')fail(405,'Method not allowed.');
  if(!Number.isSafeInteger(d.version)||d.version!==c.version)fail(409,'This report changed. Refresh before reviewing it.');
  if(Object.keys(d).some(k=>!['version','status','claim','resolution'].includes(k)))fail(400,'Unknown report update.');
  if(d.status!==undefined&&!['open','reviewing','resolved','dismissed'].includes(d.status))fail(400,'Invalid report status.');
  const resolution=typeof d.resolution==='string'?d.resolution.trim():'';if(resolution.length>500||d.status&&['resolved','dismissed'].includes(d.status)&&!resolution)fail(400,'Give a review reason up to 500 characters.');
  if(d.claim!==undefined){if(typeof d.claim!=='boolean'||!open(c))fail(400,'Only open reports can be claimed.');if(c.assigneeId&&c.assigneeId!==me.id&&!platform.self(me).owner)fail(409,'Another reviewer has claimed this report.');c.assigneeId=d.claim?me.id:null;if(d.claim&&c.status==='open')c.status='reviewing';}
  if(d.status)c.status=d.status;c.version++;c.updatedAt=Date.now();if(resolution)c.platformResolution=resolution;
  platform.log(me,'Report reviewed','Report '+c.number+' · '+s.name,(d.status||'assignment')+(resolution?': '+resolution:''));await save();refresh();json(res,200,view(me,s,c));return true;
 }
 return {handle,overview};
}
