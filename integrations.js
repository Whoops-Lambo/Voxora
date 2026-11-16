import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {isSuspended} from './platform.js';
import {initializeActivityUser} from './read-service.js';
import {channelPermissions,administrator} from './public/permissions.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function integrationService({state,body,json,fail,save,refresh,management,createMessage,rate,userById}){
 state.webhooks||=[];state.widgets||=[];const guests=new Map();
 function bot(s,name){const u={id:randomUUID(),username:'integration_'+randomBytes(6).toString('hex'),displayName:name,bot:true,color:'#55e6bc',status:'online',blocked:[],createdAt:Date.now()};initializeActivityUser(u,state.messageSequence||0);state.users.push(u);s.members.push(u.id);return u;}
 function active(record){const s=state.servers.find(s=>s.id===record.serverId),u=userById(record.userId);return (state.webhooks.includes(record)||state.widgets.includes(record))&&s&&u&&!isSuspended(u)&&s.members.includes(u.id)&&s.channels.some(c=>c.id===record.channelId)&&channelPermissions(s,u.id,record.channelId).includes('sendMessages');}
 function publicWidget(i){const s=state.servers.find(s=>s.id===i.serverId);if(!active(i)||!s)return false;const shadow={...s,members:[...s.members,'widget-preview'],memberRoles:{...s.memberRoles,'widget-preview':[]}};return channelPermissions(shadow,'widget-preview',i.channelId).includes('viewChannel');}
 async function handle(req,res,url,me){
  const m=url.pathname.match(/^\/api\/servers\/([\w-]+)\/(webhooks|widgets)(?:\/([\w-]+))?$/);if(!m)return false;
  const d=['POST','PATCH'].includes(req.method)?await body(req):{},s=state.servers.find(s=>s.id===m[1]&&s.members.includes(me.id));if(!s)fail(404,'Server not found.');management.requirePermission(s,me,'manageIntegrations');
  const items=m[2]==='widgets'?state.widgets:state.webhooks;
  if(req.method==='GET'){json(res,200,{items:items.filter(i=>i.serverId===s.id).map(({tokenHash,...i})=>i)});return true;}
  if(req.method==='DELETE'){const i=items.find(i=>i.id===m[3]&&i.serverId===s.id);if(!i)fail(404,'Integration not found.');items.splice(items.indexOf(i),1);s.members=s.members.filter(id=>id!==i.userId);management.log(s,me,'Integration removed',i.name);await management.commit(s);json(res,200,{ok:true});return true;}
  if(req.method!=='POST'||m[3])fail(405,'Method not allowed.');
  if(items.filter(i=>i.serverId===s.id).length>=25)fail(400,'Use up to 25 integrations of each type.');
  const c=s.channels.find(c=>c.id===d.channelId&&c.type==='text'&&!c.forum&&!c.links&&!c.rules&&!c.bulletin);if(!c||!channelPermissions(s,me.id,c.id).includes('viewChannel'))fail(400,'Choose a visible text channel.');
  if(typeof d.name!=='string'||!d.name.trim()||d.name.length>60)fail(400,'Choose an integration name.');
  const widget=m[2]==='widgets';let origins;
  if(widget){
   if(!administrator(s,me.id)||d.confirmPublic!==true)fail(403,'Administrators must explicitly confirm public widget access.');
   const shadow={...s,members:[...s.members,'widget-preview'],memberRoles:{...s.memberRoles,'widget-preview':[]}};
   if(!channelPermissions(shadow,'widget-preview',c.id).includes('viewChannel'))fail(400,'Private channels cannot be embedded publicly.');
   if(!Array.isArray(d.origins)||!d.origins.length||d.origins.length>10)fail(400,'Choose 1–10 allowed website origins.');
   origins=d.origins.map(value=>{let u;try{u=new URL(value);}catch{fail(400,'Invalid website origin.');}if(u.origin!==value||u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))fail(400,'Use HTTPS website origins without paths.');return u.origin;});
  }
  const secret=randomBytes(32).toString('hex'),u=bot(s,widget?'Website Visitor':d.name.trim()),record={id:randomUUID(),serverId:s.id,channelId:c.id,userId:u.id,name:d.name.trim(),createdBy:me.id,createdAt:Date.now(),...(widget?{origins,public:true}:{tokenHash:hash(secret)})};
  items.push(record);management.log(s,me,widget?'Public chat widget created':'Webhook created',record.name);await management.commit(s);
  const base=(process.env.VOXORA_PUBLIC_URL||((req.socket.encrypted||req.headers['x-forwarded-proto']==='https'?'https':'http')+'://'+req.headers.host)).replace(/\/$/,'');
  json(res,201,{...Object.fromEntries(Object.entries(record).filter(([k])=>k!=='tokenHash')),...(widget?{embed:'<script src="'+base+'/voxora-widget.js" data-widget="'+record.id+'"></script>'}:{url:base+'/api/webhooks/'+record.id+'/'+secret})});return true;
 }
 async function handlePublic(req,res,url){
  if(url.pathname==='/voxora-widget.js'){
   res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'public, max-age=300'});res.end(`(async()=>{const script=document.currentScript,base=new URL(script.src).origin,id=script.dataset.widget;try{const r=await fetch(base+'/api/widgets/'+id+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});if(!r.ok)throw Error('Widget unavailable');const data=await r.json(),frame=document.createElement('iframe');frame.src=base+'/widgets/'+id+'#'+data.token;frame.title='Voxora live chat';frame.style.cssText='width:100%;max-width:480px;height:560px;border:0;border-radius:16px';script.after(frame);}catch(e){const text=document.createElement('p');text.textContent='Chat is temporarily unavailable.';script.after(text);}})();`);return true;
  }
  const hook=url.pathname.match(/^\/api\/webhooks\/([\w-]+)\/([a-f0-9]{64})$/);
  if(hook){
   const i=state.webhooks.find(i=>i.id===hook[1]&&i.tokenHash===hash(hook[2]));if(!i||!active(i))fail(404,'Webhook unavailable.');
   if(req.method!=='POST')fail(405,'Method not allowed.');rate('webhook:'+i.id,30,60000);const d=await body(req,128000);
   if(!active(i))fail(403,'Webhook access changed.');
   const result=await createMessage(userById(i.userId),{channel:i.channelId,text:d.content??d.text??'',embeds:d.embeds,components:d.components},{authorize:()=>{if(!active(i))fail(403,'Webhook access changed.');}});
   json(res,201,result);return true;
  }
  const page=url.pathname.match(/^\/widgets\/([\w-]+)$/),api=url.pathname.match(/^\/api\/widgets\/([\w-]+)\/(session|messages)$/);if(!page&&!api)return false;
  const i=state.widgets.find(i=>i.id===(page?.[1]||api?.[1]));if(!i||!publicWidget(i))fail(404,'Widget unavailable.');
  // Public publication stays revoked if administrators make the source channel private.
  const s=state.servers.find(s=>s.id===i.serverId),shadow={...s,members:[...s.members,'widget-preview'],memberRoles:{...s.memberRoles,'widget-preview':[]}};
  if(!channelPermissions(shadow,'widget-preview',i.channelId).includes('viewChannel'))fail(404,'Widget unavailable.');
  if(page){
   res.removeHeader('X-Frame-Options');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors "+i.origins.join(' '));
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end('<!doctype html><html><head><meta charset="utf-8"><title>'+escape(i.name)+'</title><style>body{font:15px system-ui;background:#0c141e;color:#e6edf3;padding:16px}#messages{height:380px;overflow:auto}input{width:90%;padding:8px}button{padding:8px}</style></head><body><h2>'+escape(i.name)+'</h2><div id="messages" role="log"></div><form><input aria-label="Message" maxlength="1000" required><button>Send</button></form><p id="status"></p><script type="module" src="/widget-ui.js"></script></body></html>');return true;
  }
  const origin=req.headers.origin;
  if(origin&&i.origins.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');}
  if(req.method==='OPTIONS'){if(!i.origins.includes(origin))fail(403,'Website is not allowed.');res.writeHead(204);res.end();return true;}
  if(api[2]==='session'){
   if(req.method!=='POST'||!i.origins.includes(origin))fail(403,'Website is not allowed.');
   rate('widget-session:'+i.id+':'+req.socket.remoteAddress,20,60000);
   for(const [token,g] of guests)if(g.expiresAt<Date.now())guests.delete(token);
   if(guests.size>=10000)fail(503,'Widget capacity reached.');const token=randomBytes(32).toString('hex');guests.set(hash(token),{widgetId:i.id,expiresAt:Date.now()+3600000});json(res,201,{token});return true;
  }
  const token=req.headers.authorization?.replace(/^Widget /,''),guest=token&&guests.get(hash(token));if(!guest||guest.widgetId!==i.id||guest.expiresAt<Date.now())fail(403,'Widget session expired.');
  if(req.method==='GET'){json(res,200,{messages:state.messages.filter(m=>m.channel===i.channelId).slice(-50).map(m=>({id:m.id,author:m.widgetGuestName||userById(m.authorId)?.displayName||'Member',text:m.text,time:m.time}))});return true;}
  if(req.method!=='POST')fail(405,'Method not allowed.');const d=await body(req,4000);if(typeof d.text!=='string'||!d.text.trim()||d.text.length>1000)fail(400,'Use 1–1,000 message characters.');rate('widget-post:'+hash(token),5,60000);rate('widget-ip:'+req.socket.remoteAddress,20,60000);
  const result=await createMessage(userById(i.userId),{channel:i.channelId,text:d.text},{untrustedIntegration:true,authorize:()=>{if(!publicWidget(i))fail(403,'Widget access changed.');},beforeSave:m=>{m.widgetGuestName='Website Visitor';}});
  json(res,201,{id:result.id});return true;
 }
 return {handle,handlePublic};
}
