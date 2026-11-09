import * as webPush from 'web-push';
import {readFile,writeFile,rename,chmod} from 'node:fs/promises';
import path from 'node:path';
import {createECDH,randomBytes,randomUUID,createHash} from 'node:crypto';
import {notificationPolicy,shouldNotify} from './public/activity.js';
import {isSuspended} from './platform.js';

export function validatePushSubscription(value,fail){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['endpoint','expirationTime','keys'].includes(k))||typeof value.endpoint!=='string'||value.endpoint.length>2048)fail(400,'Invalid push subscription.');
  let url;try{url=new URL(value.endpoint);}catch{fail(400,'Invalid push endpoint.');}
  const allowed=['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].includes(url.hostname)||url.hostname.endsWith('.notify.windows.com');
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!allowed)fail(400,'Use a supported browser push provider.');
  const key=(value,length)=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(value)||Buffer.from(value,'base64url').length!==length)fail(400,'Invalid push encryption keys.');return Buffer.from(value,'base64url').toString('base64url');};
  const p256dh=key(value.keys?.p256dh,65),auth=key(value.keys?.auth,16);
  try{const ecdh=createECDH('prime256v1');ecdh.generateKeys();ecdh.computeSecret(Buffer.from(p256dh,'base64url'));}catch{fail(400,'Invalid push encryption key.');}
  if(value.expirationTime!==undefined&&value.expirationTime!==null&&(!Number.isFinite(value.expirationTime)||value.expirationTime<=Date.now()))fail(400,'The push subscription has expired. Enable notifications again.');
  return {endpoint:url.href,expirationTime:value.expirationTime??null,keys:{p256dh,auth}};
}

export async function backgroundPushService({state,dataDir,body,json,fail,save,rate,userById,serverFor,canRead,getMessage,hasReplyAccess,transport=webPush.sendNotification,delay=900,now=Date.now}){
  state.pushSubscriptions||=[];
  let keys,configError=false;
  const keyPath=path.join(dataDir,'push-keys.json');
  try{
    try{keys=JSON.parse(await readFile(keyPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;if(state.pushSubscriptions.length)throw Error('Restore push keys from backup.');keys=webPush.generateVAPIDKeys();await writeFile(keyPath+'.tmp',JSON.stringify(keys),{mode:0o600});await rename(keyPath+'.tmp',keyPath);}
    const ec=createECDH('prime256v1');ec.setPrivateKey(Buffer.from(keys.privateKey,'base64url'));if(ec.getPublicKey().toString('base64url')!==keys.publicKey)throw Error('Invalid push key pair.');await chmod(keyPath,0o600);
  }catch{configError=true;console.warn('Background notifications unavailable: restore the private push key file and restart.');}
  let subject=process.env.VOXORA_PUSH_SUBJECT||process.env.VOXORA_PUBLIC_URL||'https://github.com/Whoops-Lambo/Voxora';
  try{const address=new URL(subject);if(!['https:','mailto:'].includes(address.protocol)||address.username||address.password)subject='https://github.com/Whoops-Lambo/Voxora';}catch{subject='https://github.com/Whoops-Lambo/Voxora';}
  const validSession=sub=>state.sessions.some(s=>s.userId===sub.userId&&s.hash===sub.sessionHash&&s.expires>now());
  const usable=sub=>state.pushSubscriptions.includes(sub)&&validSession(sub)&&!!userById(sub.userId)&&!isSuspended(userById(sub.userId))&&(!sub.subscription.expirationTime||sub.subscription.expirationTime>now());
  const options=id=>({vapidDetails:{subject,...keys},TTL:3600,urgency:'high',timeout:5000,topic:createHash('sha256').update(id).digest('base64url').slice(0,32)});
  const view=sub=>({id:sub.id,enabled:true,previews:!!sub.previews,lastDeliveryAt:sub.lastDeliveryAt||null,lastError:sub.lastError||null});
  const queued=new Map(),active=new Set();let timer=null,closing=false,lastSweep=0;
  function eligible(sub,message){
    const me=userById(sub.userId);if(!usable(sub)||!message||!me||me.bot||!canRead(me,message.channel)||message.threadId&&!hasReplyAccess(message,me))return false;
    const server=serverFor(message.channel),dm=!server&&state.conversations.find(c=>c.id===message.channel&&c.members.includes(me.id));
    if(!server&&!dm||dm&&dm.members.some(id=>me.blocked?.includes(id)||userById(id)?.blocked?.includes(me.id)))return false;
    const read=message.threadId?(me.threadReadState?.[message.threadId]||0):(me.readState?.[message.channel]?.sequence??me.readBaseline??0);
    return message.sequence>read&&shouldNotify(message,me,notificationPolicy(me.notificationSettings,server?.id||null,message.channel,now()),{dm:!!dm,blocked:me.blocked||[],dnd:me.status==='dnd'});
  }
  function payload(sub,message){const server=serverFor(message.channel),channel=server?.channels.find(c=>c.id===message.channel);return {schema:1,type:'message',recipientId:sub.userId,id:message.id,channel:message.channel,threadId:message.threadId||null,serverId:server?.id||null,title:sub.previews?message.author+' · '+(server?'#'+channel.name:'Direct message'):'New message · Voxora',body:sub.previews?(message.text.slice(0,160)||'Sent an attachment'):server?'You have new activity in a Voxora community.':'You have a new direct message in Voxora.'};}
  async function deliver(sub,data){
    try{await transport(sub.subscription,JSON.stringify(data),options(data.id));if(state.pushSubscriptions.includes(sub)){sub.lastDeliveryAt=now();sub.lastError=null;}return true;}
    catch(error){if(error.statusCode===404||error.statusCode===410){state.pushSubscriptions=state.pushSubscriptions.filter(item=>item!==sub);await save();}else{sub.lastError='Push provider could not deliver'+(Number.isInteger(error.statusCode)?' (HTTP '+error.statusCode+')':'.');}throw {statusCode:error.statusCode};}
  }
  function schedule(){if(timer||closing||!queued.size)return;timer=setTimeout(()=>{timer=null;pump();},Math.max(0,Math.min(...[...queued.values()].map(j=>j.readyAt))-now()));timer.unref?.();}
  function pump(){
    if(closing)return;
    for(const [key,job]of queued){if(active.size>=4)break;if(job.readyAt>now())continue;queued.delete(key);
      const work=(async()=>{const sub=state.pushSubscriptions.find(s=>s.id===job.subscriptionId),message=getMessage(job.id,job.threadId);if(!sub||!eligible(sub,message)){job.resolve();return;}
        try{await deliver(sub,payload(sub,message));job.resolve();}
        catch(error){if(usable(sub)&&job.attempts<2&&(!error.statusCode||error.statusCode===429||error.statusCode>=500)){job.attempts++;job.readyAt=now()+job.attempts*3000;queued.set(key,job);}else job.resolve();}
      })();active.add(work);work.catch(()=>job.resolve()).finally(()=>{active.delete(work);schedule();});
    }
    if(active.size<4)schedule();
  }
  function notifyMessage(message){
    if(configError||closing)return Promise.resolve();
    const waits=[];
    for(const sub of state.pushSubscriptions){if(!eligible(sub,message))continue;const key=sub.id+':'+message.id;if(queued.has(key))continue;if(queued.size>=1000){const oldest=queued.keys().next().value;queued.get(oldest).resolve();queued.delete(oldest);}
      waits.push(new Promise(resolve=>queued.set(key,{subscriptionId:sub.id,id:message.id,threadId:message.threadId||null,readyAt:now()+delay,attempts:0,resolve})));
    }
    schedule();return Promise.all(waits);
  }
  async function handle(req,res,url,me,session){
    if(!url.pathname.startsWith('/api/push/'))return false;
    if(url.pathname==='/api/push/key'&&req.method==='GET'){json(res,200,{enabled:!configError,publicKey:configError?null:keys.publicKey});return true;}
    const d=['POST','PATCH'].includes(req.method)?await body(req,12000):{};
    if(configError)fail(503,'Background notifications are unavailable on this server. Contact the operator.');
    if(isSuspended(me)||!state.sessions.some(s=>s.hash===session.hash&&s.userId===me.id&&s.expires>now()))fail(401,'Sign in again to configure notifications.');
    if(url.pathname==='/api/push/status'&&req.method==='POST'){if(typeof d.endpoint!=='string'||d.endpoint.length>2048)fail(400,'Invalid endpoint.');const sub=state.pushSubscriptions.find(s=>s.subscription.endpoint===d.endpoint&&s.userId===me.id&&s.sessionHash===session.hash);json(res,200,sub?view(sub):{enabled:false});return true;}
    if(url.pathname==='/api/push/subscriptions'&&req.method==='POST'){
      if(Object.keys(d).some(k=>!['subscription','previews'].includes(k))||d.previews!==undefined&&typeof d.previews!=='boolean')fail(400,'Invalid notification preferences.');
      rate('push-register:'+me.id,20,60000);const subscription=validatePushSubscription(d.subscription,fail),existing=state.pushSubscriptions.find(s=>s.subscription.endpoint===subscription.endpoint);
      if(!existing&&state.pushSubscriptions.filter(s=>s.userId===me.id&&validSession(s)).length>=10)fail(400,'Disable an old device before adding another notification subscription.');
      const sub={id:existing?.id||randomUUID(),userId:me.id,sessionHash:session.hash,subscription,previews:d.previews===true,createdAt:existing?.createdAt||now(),updatedAt:now()};state.pushSubscriptions=state.pushSubscriptions.filter(s=>s!==existing);state.pushSubscriptions.push(sub);await save();json(res,200,view(sub));return true;
    }
    const deletion=url.pathname.match(/^\/api\/push\/subscriptions\/([\w-]+)$/);
    if(deletion&&req.method==='DELETE'){state.pushSubscriptions=state.pushSubscriptions.filter(s=>!(s.id===deletion[1]&&s.userId===me.id&&s.sessionHash===session.hash));await save();json(res,200,{enabled:false});return true;}
    if(url.pathname==='/api/push/test'&&req.method==='POST'){
      if(Object.keys(d).some(k=>k!=='subscriptionId'))fail(400,'Invalid test notification.');rate('push-test:'+me.id,3,60000);const sub=state.pushSubscriptions.find(s=>s.id===d.subscriptionId&&s.userId===me.id&&s.sessionHash===session.hash);
      if(!sub||!usable(sub))fail(404,'Enable notifications on this device first.');
      try{await deliver(sub,{schema:1,type:'test',id:randomUUID(),recipientId:me.id,title:'Voxora notifications are ready',body:'Background alerts are enabled for this account.'});}catch{fail(502,'The push provider could not deliver. Enable notifications again and check your device settings.');}
      json(res,200,{sent:true});return true;
    }
    fail(404,'Unknown notification route.');
  }
  async function sweep(){if(now()-lastSweep<60000)return;lastSweep=now();const before=state.pushSubscriptions.length;state.pushSubscriptions=state.pushSubscriptions.filter(usable);if(before!==state.pushSubscriptions.length)await save();}
  async function removeSession(hash){state.pushSubscriptions=state.pushSubscriptions.filter(s=>s.sessionHash!==hash);await save();}
  async function close(){closing=true;clearTimeout(timer);for(const job of queued.values())job.resolve();queued.clear();await Promise.allSettled([...active]);}
  return {handle,notifyMessage,sweep,removeSession,close,enabled:!configError};
}
