import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('push worker isolates accounts, renders alerts and opens only same-origin message locations',async()=>{
 const handlers={},storage=new Map(),shown=[],opened=[],posted=[],closed=[],recipient='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';let current=[];
 const indexedDB={open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(){const transaction={objectStore(){return {get(key){const operation={};queueMicrotask(()=>{operation.result=storage.get(key);operation.onsuccess?.();queueMicrotask(()=>transaction.oncomplete?.());});return operation;},put(value,key){const operation={};queueMicrotask(()=>{storage.set(key,value);operation.result=value;operation.onsuccess?.();queueMicrotask(()=>transaction.oncomplete?.());});return operation;}};}};return transaction;}};request.onsuccess?.();});return request;}};
 const self={location:{origin:'https://voxora.test'},addEventListener:(type,fn)=>handlers[type]=fn,registration:{getNotifications:async()=>[{close:()=>closed.push(true)}],showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>current,openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{self,indexedDB,URL,queueMicrotask,Promise,Error,String});
 const event=async(type,fields)=>{let pending;handlers[type]({...fields,waitUntil:promise=>pending=promise});if(pending)await pending;};
 const bind=async(userId,source='https://voxora.test/app')=>{let ack;await event('message',{data:{type:'voxora-push-bind',userId},source:{url:source},ports:[{postMessage:v=>ack=v}]});return ack;};
 assert.equal(await bind(recipient,'https://evil.test/app'),undefined);assert.equal(storage.size,0);assert.equal((await bind(recipient)).ok,true);assert.equal(closed.length,1);
 const payload={schema:1,type:'message',id:'message-id',recipientId:recipient,channel:'general',threadId:'thread',title:'New message',body:'A test message'};
 await event('push',{data:{json:()=>({...payload,recipientId:other})}});assert.equal(shown.length,0);await event('push',{data:{json:()=>payload}});assert.equal(shown.length,1);assert.equal(shown[0].options.silent,false);
 current=[{url:'https://voxora.test/app',visibilityState:'visible',focus:async()=>posted.push('focus'),postMessage:m=>posted.push(m)}];await event('push',{data:{json:()=>payload}});assert.equal(shown.at(-1).options.silent,true);await event('notificationclick',{notification:{data:shown[0].options.data,close(){}}});assert.equal(posted[1].type,'voxora-notification-open');assert.equal(posted[1].payload.channel,'general');
 current=[];await event('notificationclick',{notification:{data:{...shown[0].options.data,channel:'https://evil.test/'},close(){}}});assert.equal(new URL(opened[0]).origin,'https://voxora.test');assert.equal(new URL(opened[0]).pathname,'/app');
 await bind(other,'https://voxora.test/invite/example');await event('notificationclick',{notification:{data:shown[0].options.data,close(){}}});assert.equal(opened.at(-1),'https://voxora.test/app');await bind(null);await event('push',{data:{json:()=>payload}});assert.equal(shown.length,2);assert.equal(storage.get('recipient'),null);
});
