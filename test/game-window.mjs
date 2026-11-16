import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {recognizedGame,validShortcut,createGameWindow}=createRequire(import.meta.url)('../desktop/game-window.cjs');
test('game detection uses a fixed process-name allowlist and shortcuts reject arbitrary command text',()=>{
 assert.equal(recognizedGame(['discord','cs2.exe']),'Counter-Strike 2');assert.equal(recognizedGame(['My private document','NotAGame.exe']),null);assert.equal(validShortcut('CommandOrControl+Shift+O'),true);assert.equal(validShortcut('powershell.exe -Command bad'),false);
});
test('game detection stays opt-in per account and IPC rejects untrusted senders',async()=>{
 const dir=await mkdtemp('/tmp/voxora-game-'),handlers=new Map(),sent=[],registered=new Set();let calls=0;let service;
 try{
  service=await createGameWindow({app:{getPath:()=>dir},BrowserWindow:class{},globalShortcut:{register(k){registered.add(k);return true;},unregister(k){registered.delete(k);}},ipcMain:{handle:(k,v)=>handlers.set(k,v),removeHandler:k=>handlers.delete(k)},shell:{},mainWindow:{isDestroyed:()=>false,webContents:{send:(_e,v)=>sent.push(v)}},getOrigin:()=> 'https://voxora.example',trustedIPC:e=>{if(!e.trusted)throw Error('Untrusted');},platform:'win32',execImpl:async()=>{calls++;return{stdout:'["cs2","PrivateDocument"]'};}});
  const invoke=(n,arg,e={trusted:true})=>handlers.get('voxora:'+n)(e,arg);
  await assert.rejects(invoke('game-account','u',{trusted:false}),/Untrusted/);await invoke('game-account','first');assert.equal(calls,0);await invoke('game-settings',{enabled:true});assert.equal(service.snapshot().game,'Counter-Strike 2');assert.equal(sent.at(-1).accountId,'first');
  await invoke('game-account','second');assert.equal(service.snapshot().enabled,false);assert.equal(service.snapshot().game,null);await invoke('game-account','first');assert.equal(service.snapshot().enabled,true);assert.ok(!JSON.stringify(sent).includes('PrivateDocument'));await invoke('game-account',null);assert.equal(service.snapshot().game,null);
  service.dispose();service=null;assert.equal(handlers.size,0);assert.equal(registered.size,0);
 }finally{service?.dispose();await rm(dir,{recursive:true,force:true});}
});
