import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createECDH,randomBytes} from 'node:crypto';
import * as webPush from 'web-push';
import ece from 'http_ece';
import {backgroundPushService,validatePushSubscription} from '../background-push.js';
import {fixture} from './support/server.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
function device(){const dh=createECDH('prime256v1');dh.generateKeys();return {dh,subscription:{endpoint:'https://web.push.apple.com/test/'+randomBytes(16).toString('hex'),expirationTime:null,keys:{p256dh:dh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}};}
async function setup(t,{transport,delay=0}={}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'voxora-push-test-')),user={id:'recipient',username:'recipient',status:'online',readBaseline:0,readState:{},threadReadState:{},blocked:[]},state={users:[user],sessions:[{userId:user.id,hash:'session',expires:Date.now()+600000}],pushSubscriptions:[],servers:[],conversations:[{id:'dm',members:['recipient','sender']}]},messages=new Map(),delivered=[];let access=true,threadAccess=true;
 const service=await backgroundPushService({state,dataDir:dir,body:async req=>req.data,json:(res,status,data)=>Object.assign(res,{status,data}),fail,save:async()=>{},rate:()=>{},userById:id=>state.users.find(u=>u.id===id),serverFor:channel=>state.servers.find(s=>s.channels.some(c=>c.id===channel)),canRead:()=>access,getMessage:id=>messages.get(id),hasReplyAccess:()=>threadAccess,delay,transport:transport||(async(sub,payload,options)=>delivered.push({sub,payload:JSON.parse(payload),options}))});
 const call=async(route,data,method='POST',me=user,session=state.sessions[0])=>{const response={};await service.handle({method,data},response,new URL('https://voxora.test/api/push/'+route),me,session);return response.data;};
 const register=async(previews=false)=>{const d=device(),result=await call('subscriptions',{subscription:d.subscription,previews});return {...d,result};};
 const message=(fields={})=>{const m={id:randomBytes(6).toString('hex'),channel:'dm',sequence:1,authorId:'sender',author:'Sender',text:'Private test content',...fields};messages.set(m.id,m);return m;};
 const keepAlive=setInterval(()=>{},1000);t.after(async()=>{clearInterval(keepAlive);await service.close();await rm(dir,{recursive:true,force:true});});return {service,state,user,dir,messages,call,register,message,delivered,setAccess:v=>access=v,setThreadAccess:v=>threadAccess=v};
}
test('push subscriptions validate real P-256 keys, reject arbitrary network endpoints and preserve private VAPID keys',async t=>{
 const s=await setup(t),d=device();assert.equal(validatePushSubscription(d.subscription,fail).endpoint,d.subscription.endpoint);
 for(const endpoint of ['http://web.push.apple.com/x','https://127.0.0.1/x','https://web.push.apple.com.evil.test/x','https://web.push.apple.com:9999/x','https://user@web.push.apple.com/x','https://fcm.googleapis.com/x#fragment'])assert.throws(()=>validatePushSubscription({...d.subscription,endpoint},fail));
 assert.throws(()=>validatePushSubscription({...d.subscription,keys:{...d.subscription.keys,p256dh:Buffer.alloc(65).toString('base64url')}},fail));
 const key=await s.call('key',{},'GET');assert.equal(key.publicKey.length,87);const mode=(await stat(path.join(s.dir,'push-keys.json'))).mode&0o777;assert.equal(mode,0o600);assert.ok(!JSON.stringify(key).includes('privateKey'));
 const current=await s.register();assert.equal(current.result.previews,false);assert.ok(!JSON.stringify(current.result).includes('endpoint'));const badSession={hash:'other'};await assert.rejects(s.call('test',{subscriptionId:current.result.id},'POST',s.user,badSession),/Sign in again/);
});
test('encrypted Web Push payload and VAPID authentication round-trip without sending to a provider',async t=>{
 const s=await setup(t),d=await s.register();await s.service.notifyMessage(s.message());assert.equal(s.delivered.length,1);const delivery=s.delivered[0],request=webPush.generateRequestDetails(delivery.sub,JSON.stringify(delivery.payload),delivery.options);
 assert.equal(request.headers['Content-Encoding'],'aes128gcm');assert.match(request.headers.Authorization,/^vapid t=/);assert.ok(!request.body.includes(Buffer.from('Private test content')));
 const plaintext=ece.decrypt(request.body,{version:'aes128gcm',privateKey:d.dh,authSecret:d.subscription.keys.auth});assert.deepEqual(JSON.parse(plaintext.toString()),delivery.payload);assert.equal(delivery.payload.recipientId,'recipient');assert.ok(!JSON.stringify(delivery.payload).includes('Private test content'),'previews default off');
 await s.call('subscriptions',{subscription:d.subscription,previews:true});await s.service.notifyMessage(s.message());assert.equal(s.delivered.at(-1).payload.body,'Private test content');
});
test('delivery honors read markers, DND, blocks, mutes, mentions, deleted messages, revoked access and expired sessions',async t=>{
 const s=await setup(t,{delay:12});await s.register();
 for(const [set,reset]of [[()=>s.user.status='dnd',()=>s.user.status='online'],[()=>s.user.blocked=['sender'],()=>s.user.blocked=[]],[()=>s.user.readState.dm={sequence:1},()=>s.user.readState={}],[()=>s.user.notificationSettings={channels:{dm:{mutedUntil:-1}}},()=>s.user.notificationSettings={}],[()=>s.setAccess(false),()=>s.setAccess(true)]]){set();await s.service.notifyMessage(s.message());reset();}assert.equal(s.delivered.length,0);
 let m=s.message();const pending=s.service.notifyMessage(m);s.messages?.delete?.(m.id);s.setAccess(false);await pending;s.setAccess(true);assert.equal(s.delivered.length,0,'access checked again at delivery');
 s.state.servers.push({id:'guild',channels:[{id:'chat',name:'general'}]});await s.service.notifyMessage(s.message({channel:'chat'}));assert.equal(s.delivered.length,0);await s.service.notifyMessage(s.message({channel:'chat',mentions:{recipients:['recipient']}}));assert.equal(s.delivered.length,1);
 const thread=s.message({channel:'chat',threadId:'thread',mentions:{recipients:['recipient']}});s.user.threadReadState.thread=1;await s.service.notifyMessage(thread);assert.equal(s.delivered.length,1);s.user.threadReadState={};s.setThreadAccess(false);await s.service.notifyMessage(thread);assert.equal(s.delivered.length,1);s.setThreadAccess(true);
 const p=s.service.notifyMessage(s.message());s.state.sessions[0].expires=0;await p;assert.equal(s.delivered.length,1);await s.service.sweep();assert.equal(s.state.pushSubscriptions.length,0);
});
test('dead providers remove subscriptions and logout revokes notification delivery',async t=>{
 const s=await setup(t,{transport:async()=>{throw {statusCode:410};}});await s.register();await s.service.notifyMessage(s.message());assert.equal(s.state.pushSubscriptions.length,0);await s.register();await s.service.removeSession('session');assert.equal(s.state.pushSubscriptions.length,0);
});
test('HTTP subscriptions are session-bound, never leak keys through state, and are removed on logout',async()=>{
 const f=await fixture();try{const a=await f.register('push_http_owner'),b=await f.register('push_http_other'),d=device(),A=(p,m,data)=>f.call(a,p,m,data);assert.equal((await f.call(null,'/push/key')).status,401);const key=await A('/push/key');assert.equal(key.data.enabled,true);assert.ok(!JSON.stringify(key.data).includes('privateKey'));const saved=await A('/push/subscriptions','POST',{subscription:d.subscription});assert.equal(saved.status,200);assert.equal((await f.call(b,'/push/status','POST',{endpoint:d.subscription.endpoint})).data.enabled,false);await f.call(b,'/push/subscriptions/'+saved.data.id,'DELETE');assert.equal((await A('/push/status','POST',{endpoint:d.subscription.endpoint})).data.enabled,true);const state=await A('/state');assert.ok(!JSON.stringify(state.data).includes(d.subscription.endpoint));await A('/auth/logout','POST',{});await f.stop();const stored=JSON.parse(await readFile(path.join(f.dir,'state.json')));assert.equal(stored.pushSubscriptions.length,0);}finally{await f.cleanup();}
});
