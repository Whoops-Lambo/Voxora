const CACHE = 'voxora-install-3.3.1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html', '/voxora-icon.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('voxora-install-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  // Accounts, API responses, messages, attachments and application code are never cached.
  const url=new URL(event.request.url);
  if(url.origin===self.location.origin&&url.pathname==='/voxora-icon.png'&&event.request.method==='GET')event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
  else if (event.request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  }
});

function binding(value){return new Promise((resolve,reject)=>{const request=indexedDB.open('voxora-push',1);request.onupgradeneeded=()=>request.result.createObjectStore('settings');request.onerror=()=>reject(Error('Notification storage unavailable.'));request.onsuccess=()=>{const db=request.result,transaction=db.transaction('settings',value===undefined?'readonly':'readwrite'),store=transaction.objectStore('settings'),operation=value===undefined?store.get('recipient'):store.put(value,'recipient');let result;operation.onsuccess=()=>{result=operation.result;};transaction.oncomplete=()=>{db.close();resolve(value===undefined?result:value);};transaction.onerror=()=>{db.close();reject(Error('Notification storage unavailable.'));};};});}
self.addEventListener('message',event=>{
 if(event.data?.type!=='voxora-push-bind'||!event.source?.url||new URL(event.source.url).origin!==self.location.origin||!(new URL(event.source.url).pathname==='/app'||/^\/invite\/[\w-]+$/.test(new URL(event.source.url).pathname)))return;
 const userId=event.data.userId;if(userId!==null&&(typeof userId!=='string'||!/^[-a-f0-9]{36}$/i.test(userId)))return;
 event.waitUntil((async()=>{try{const old=await binding();await binding(userId);if(old!==userId||userId===null)for(const notification of await self.registration.getNotifications())notification.close();event.ports[0]?.postMessage({ok:true});}catch{event.ports[0]?.postMessage({ok:false});}})());
});
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{let payload;try{payload=event.data.json();}catch{return;}
  if(payload?.schema!==1||!['message','test'].includes(payload.type)||typeof payload.recipientId!=='string'||await binding()!==payload.recipientId)return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true}),visible=windows.some(client=>new URL(client.url).pathname==='/app'&&client.visibilityState==='visible');
  await self.registration.showNotification(String(payload.title||'Voxora').slice(0,140),{body:String(payload.body||'You have new activity in Voxora.').slice(0,200),icon:'/voxora-icon.png',badge:'/voxora-icon.png',tag:'voxora:'+String(payload.id),silent:visible,data:{recipientId:payload.recipientId,id:payload.id,channel:payload.channel,threadId:payload.threadId||null}});
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{const payload=event.notification.data||{},same=await binding()===payload.recipientId,url=new URL('/app',self.location.origin);
  if(same&&payload.id&&payload.channel){url.searchParams.set('push',payload.id);url.searchParams.set('channel',payload.channel);url.searchParams.set('recipient',payload.recipientId);if(payload.threadId)url.searchParams.set('thread',payload.threadId);}
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true}),existing=windows.find(client=>new URL(client.url).pathname==='/app');
  if(existing){await existing.focus();if(same&&payload.channel)existing.postMessage({type:'voxora-notification-open',payload});return;}
  await self.clients.openWindow(url.href);
 })());
});
