import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';

export const SAFETY_REASONS={harassment:'Harassment or bullying',threats:'Threats or violence',hate:'Hate or targeted abuse',scam:'Scams or phishing',privacy:'Privacy or personal information','child-safety':'Child safety','sexual-content':'Unwanted sexual content',other:'Another concern'};
const CLOSED=new Set(['resolved','dismissed']);
const DAY=86400000;
const digest=value=>createHash('sha256').update(value).digest();

export function safetyClientAddress(req,hops=0){
  const remote=req.socket.remoteAddress||'unknown';
  if(!hops)return remote;
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',').map(s=>s.trim());
  if(forwarded.some(ip=>!isIP(ip)))return remote;
  return [...forwarded,remote].at(-1-hops)||remote;
}

export function publicSafetyService({state,body,json,fail,save,notifyStaff,trustProxyHops=Number(process.env.VOXORA_TRUST_PROXY_HOPS||0),now=Date.now}){
  if(!Number.isInteger(trustProxyHops)||trustProxyHops<0||trustProxyHops>4)throw Error('VOXORA_TRUST_PROXY_HOPS must be a whole number from 0 to 4.');
  state.safetyReports||=[];
  const rateSecret=randomBytes(32),buckets=new Map(),forms=new Map();
  let lastSweep=0;
  const clientKey=req=>createHmac('sha256',rateSecret).update(safetyClientAddress(req,trustProxyHops)).digest('hex');
  function limit(key,max,period){
    const time=now();let item=buckets.get(key);
    if(!item||item.until<=time){
      if(buckets.size>=4096){for(const [id,value]of buckets)if(value.until<=time)buckets.delete(id);if(buckets.size>=4096)fail(429,'Reporting is busy. Please try again shortly.',{retryAfter:60});}
      item={count:0,until:time+period};buckets.set(key,item);
    }
    if(++item.count>max)fail(429,'Too many attempts. Please try again later.',{retryAfter:Math.max(1,Math.ceil((item.until-time)/1000))});
  }
  function pruneForms(){for(const [key,value]of forms)if(value.expiresAt<=now())forms.delete(key);}
  function pruneReports(){const before=state.safetyReports.length;state.safetyReports=state.safetyReports.filter(c=>!CLOSED.has(c.status)||c.updatedAt>now()-90*DAY);return before!==state.safetyReports.length;}
  const receipt=c=>({reference:c.reference,status:c.status,createdAt:c.createdAt,updatedAt:c.updatedAt});
  const invalid=()=>fail(400,'The reporting form expired or changed connection. Reload the form and try again.');
  function text(value,label,max,required=false){
    if(typeof value!=='string'||value.trim().length>max||required&&!value.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail(400,'Enter a valid '+label+' (up to '+max+' characters).');
    return value.trim();
  }
  function payload(d){
    if(Object.keys(d).some(k=>!['formToken','subject','category','context','details','links','confirm','website'].includes(k)))fail(400,'Unknown report fields.');
    if(d.website!==undefined&&(typeof d.website!=='string'||d.website))fail(400,'Unable to submit this form. Reload it and try again.');
    const subject=text(d.subject,'member username or ID',100,true),context=text(d.context??'','community or channel',160),details=text(d.details,'description',4000,true);
    if(details.length<20)fail(400,'Describe what happened in at least 20 characters.');
    if(typeof d.category!=='string'||!Object.hasOwn(SAFETY_REASONS,d.category)||d.confirm!==true)fail(400,'Choose a report category and confirm the information is accurate to your knowledge.');
    if(!Array.isArray(d.links)||d.links.length>5)fail(400,'Include up to five evidence links.');
    const links=d.links.map(link=>{let url;try{url=new URL(text(link,'evidence link',500,true));}catch{fail(400,'Evidence links must be complete HTTP or HTTPS addresses.');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)fail(400,'Use HTTP or HTTPS links without embedded credentials.');return url.href;});
    return {subject,context,details,category:d.category,links:[...new Set(links)]};
  }
  async function handlePublic(req,res,url){
    if(!['/api/safety/form','/api/safety/reports','/api/safety/receipt'].includes(url.pathname))return false;
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex');
    if(req.headers['sec-fetch-site']==='cross-site')fail(403,'Open the Safety Center on this Voxora website to report.');
    const ip=clientKey(req);
    if(url.pathname==='/api/safety/form'){
      if(req.method!=='GET')fail(405,'Method not allowed.');
      limit('form:'+ip,30,10*60000);limit('forms-global',1000,3600000);pruneForms();
      if(forms.size>=2048)fail(429,'Reporting is busy. Please try again shortly.',{retryAfter:60});
      const formToken=randomBytes(32).toString('base64url'),expiresAt=now()+30*60000;
      forms.set(formToken,{ip,expiresAt});json(res,200,{formToken,expiresAt,categories:SAFETY_REASONS});return true;
    }
    if(req.method!=='POST')fail(405,'Method not allowed.');
    if(url.pathname==='/api/safety/receipt'){
      limit('lookup:'+ip,60,10*60000);limit('lookups-global',10000,3600000);
      const d=await body(req,4096);
      if(Object.keys(d).some(k=>!['reference','receiptKey'].includes(k))||typeof d.reference!=='string'||!/^VSR-[A-F0-9]{12}$/.test(d.reference)||typeof d.receiptKey!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(d.receiptKey))fail(404,'No matching receipt. Check your reference and private key.');
      const c=state.safetyReports.find(c=>c.reference===d.reference),actual=digest(d.receiptKey),expected=c?Buffer.from(c.receiptHash,'hex'):Buffer.alloc(32);
      if(!timingSafeEqual(actual,expected)||!c||CLOSED.has(c.status)&&c.updatedAt<=now()-90*DAY)fail(404,'No matching receipt. Check your reference and private key.');
      json(res,200,receipt(c));return true;
    }
    limit('submit-attempt:'+ip,30,15*60000);
    const d=await body(req,32000);pruneForms();
    const form=typeof d.formToken==='string'&&forms.get(d.formToken);
    if(!form||form.ip!==ip)invalid();
    const data=payload(d),fingerprint=createHash('sha256').update(JSON.stringify(data)).digest('hex');
    if(form.result){if(fingerprint!==form.fingerprint)fail(409,'This form already submitted a different report. Reload to start a new one.');await form.pending;json(res,201,form.result);return true;}
    limit('report:'+ip,5,15*60000);limit('reports-global',300,3600000);
    pruneReports();
    if(state.safetyReports.length>=5000){const oldest=state.safetyReports.filter(c=>CLOSED.has(c.status)).sort((a,b)=>a.updatedAt-b.updatedAt)[0];if(!oldest)fail(429,'The review queue is full. Please try again later.',{retryAfter:3600});state.safetyReports=state.safetyReports.filter(c=>c!==oldest);}
    const raw=data.subject.replace(/^@/,'').toLowerCase(),target=state.users.find(u=>!u.bot&&(u.id===data.subject||u.username===raw)),time=now(),receiptKey=randomBytes(32).toString('base64url');
    let reference;do{reference='VSR-'+randomBytes(6).toString('hex').toUpperCase();}while(state.safetyReports.some(c=>c.reference===reference));
    // No cookie, session, reporter account, email, user agent or network address is retained.
    const c={id:randomUUID(),reference,number:reference,kind:'safety',version:1,status:'open',createdAt:time,updatedAt:time,subject:data.subject,context:data.context,category:data.category,evidenceLinks:data.links,snapshot:{authorId:target?.id||null,authorName:data.subject,text:data.details,files:[]},receiptHash:digest(receiptKey).toString('hex'),assigneeId:null};
    state.safetyReports.push(c);form.fingerprint=fingerprint;form.result={...receipt(c),receiptKey};
    form.pending=save().catch(error=>{state.safetyReports=state.safetyReports.filter(item=>item!==c);form.result=null;throw error;});
    await form.pending;notifyStaff();json(res,201,form.result);return true;
  }
  async function sweep(){if(now()-lastSweep<60000)return;lastSweep=now();pruneForms();for(const [key,value]of buckets)if(value.until<=now())buckets.delete(key);if(pruneReports())await save();}
  return {handlePublic,sweep};
}
