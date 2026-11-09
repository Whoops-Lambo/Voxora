import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const {APP_ID,notificationPayload,createDesktopNotifications}=createRequire(import.meta.url)('../desktop/notifications.cjs');
const payload=(extra={})=>({id:'message',channel:'general',threadId:null,recipientId:'member',title:'New message · Voxora',body:'A private alert',silent:true,...extra});
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'voxora-desktop-alerts-')),notifications=[],trays=[],sent=[],opened=[],events=[];let origin='https://voxora.test',supported=true,time=100000;
 class Notification extends EventEmitter{static isSupported(){return supported;}constructor(value){super();this.value=value;notifications.push(this);}show(){this.shown=true;}close(){this.closed=true;this.emit('close');}}
 class Tray extends EventEmitter{constructor(){super();trays.push(this);}setToolTip(value){this.tooltip=value;}setContextMenu(value){this.menu=value;}destroy(){this.destroyed=true;}}
 const window={isDestroyed:()=>false,isMinimized:()=>true,restore:()=>events.push('restore'),show:()=>events.push('show'),focus:()=>events.push('focus'),webContents:{send:(...args)=>sent.push(args)}};
 const inputs={Notification,Tray,Menu:{buildFromTemplate:x=>x},nativeImage:{createFromPath:()=>({resize:()=>({})})},getWindow:()=>window,getOrigin:()=>origin,quit:()=>events.push('quit'),openExternal:async url=>opened.push(url),directory,icon:'/fixed/voxora.png',platform:'win32',now:()=>time};
 const service=await createDesktopNotifications(inputs);t.after(async()=>{service.dispose();await rm(directory,{recursive:true,force:true});});return {service,inputs,notifications,trays,sent,opened,events,origin:v=>origin=v,support:v=>supported=v,time:v=>time=v,directory};
}
test('native alerts validate fixed metadata, focus the app and pass message references without allowing renderer URLs or icons',async t=>{
 const f=await fixture(t);assert.equal(APP_ID,'com.voxora.desktop');assert.equal(f.service.show(payload()).shown,true);assert.deepEqual(f.notifications[0].value,{title:'New message · Voxora',body:'A private alert',icon:'/fixed/voxora.png',silent:true,timeoutType:'default'});f.notifications[0].emit('click');assert.deepEqual(f.events,['restore','show','focus']);assert.deepEqual(f.sent[0],['voxora:notification-click',{id:'message',channel:'general',threadId:null,recipientId:'member'}]);
 for(const bad of [{...payload(),icon:'https://evil.test/image'},payload({channel:'https://evil.test/'}),payload({title:'x'.repeat(141)}),payload({silent:'false'}),{...payload(),command:'run'},null])assert.throws(()=>notificationPayload(bad),/Invalid/);
});
test('deduplication, burst bounds, old-workspace clicks, logout cleanup and unsupported sessions cannot produce stale alerts',async t=>{
 const f=await fixture(t);f.service.show(payload());assert.equal(f.service.show(payload()).reason,'duplicate');f.origin('https://another.test');f.notifications[0].emit('click');assert.equal(f.sent.length,0);assert.equal(f.events.length,0);
 for(let i=0;i<30;i++)f.service.show(payload({id:'burst'+i}));assert.equal(f.notifications.length,10);assert.equal(f.service.show(payload({id:'extra'})).reason,'rate-limited');f.service.clear();assert.ok(f.notifications.every(n=>n.closed));f.notifications[1].emit('click');assert.equal(f.sent.length,0);f.support(false);assert.equal(f.service.show(payload()).reason,'unsupported');
});
test('background tray mode is opt-in, persists, restores the window and provides an explicit quit action',async t=>{
 const f=await fixture(t);assert.equal(f.service.snapshot().keepRunning,false);assert.equal(f.trays.length,0);await f.service.configure({keepRunning:true});assert.equal(f.service.keepRunning(),true);assert.equal(JSON.parse(await readFile(path.join(f.directory,'desktop-notifications.json'))).keepRunning,true);f.trays[0].emit('click');assert.deepEqual(f.events,['restore','show','focus']);f.trays[0].menu.find(x=>x.label==='Quit Voxora').click();assert.equal(f.events.at(-1),'quit');
 const restored=await createDesktopNotifications(f.inputs);assert.equal(restored.keepRunning(),true);restored.dispose();await f.service.configure({keepRunning:false});assert.equal(f.service.keepRunning(),false);assert.equal(f.trays[0].destroyed,true);await f.service.systemSettings();assert.deepEqual(f.opened,['ms-settings:notifications']);await assert.rejects(f.service.configure({keepRunning:true,command:'run'}),/Invalid/);
});
test('the isolated preload exposes only notification operations and removes registered click listeners',async()=>{
 const ipc=new EventEmitter(),calls=[];ipc.invoke=async(...args)=>{calls.push(args);return {shown:true};};let bridge;
 vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'voxoraDesktop');bridge=value;}},ipcRenderer:ipc};}});
 await bridge.showNotification(payload());assert.equal(calls[0][0],'voxora:notification-show');await bridge.testNotification();assert.equal(calls[1][0],'voxora:notification-test');let click;const off=bridge.onNotificationClick(value=>click=value);ipc.emit('voxora:notification-click',{}, {id:'message'});assert.equal(click.id,'message');off();assert.equal(ipc.listenerCount('voxora:notification-click'),0);assert.equal(bridge.send,undefined);
});
