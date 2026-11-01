import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {DesktopUpdater}=require('../desktop/updater.cjs');
const {downloadResponse,LFS_URL}=require('../desktop/update-download.cjs');
const {FEED_URL}=require('../desktop/update-feed.cjs');
const {releaseFeed}=await import('../build/release.mjs');
const binary=Buffer.from('MZ'+ 'verified-install-fixture'.repeat(400));
const release=releaseFeed({version:'2.14.0',sha256:createHash('sha256').update(binary).digest('hex'),size:binary.length,notes:'Delivery fixes',commit:'b'.repeat(40)});
const href='https://github-cloud.githubusercontent.com/alambic/media/123/'+release.sha256.slice(0,2)+'/'+release.sha256.slice(2,4)+'/'+release.sha256+'?signature=synthetic-private-query';
const batch=patch=>({objects:[{oid:release.sha256,size:release.size,actions:{download:{href}},...patch}]});
async function fixture(options={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'voxora-delivery-')),calls=[];
 const u=new DesktopUpdater({version:'2.13.0',supported:true,directory,launchInstaller:()=>{throw Error('No unattended installation allowed.');},quit:()=>{throw Error('No unattended quit allowed.');},fetch:async(url,opts)=>{
  calls.push({url,opts});if(url.split('?')[0]===FEED_URL)return Response.json(release);
  if(url===release.url)return new Response('Blocked',{status:403});
  if(url===LFS_URL)return Response.json(batch());
  assert.equal(url,href);return new Response(binary,{headers:{'Content-Length':String(binary.length)}});
 },...options});await u.initialize();return {u,calls,directory,cleanup:async()=>{u.stop();await u.logging;await rm(directory,{recursive:true,force:true});}};
}
test('a blocked primary host falls back to the exact public LFS object; only verified bytes persist and diagnostics omit signed URLs',async()=>{
 const f=await fixture();try{
  await f.u.check();assert.equal(f.u.phase,'ready');assert.equal(f.u.snapshot().downloadSource,'github-lfs');assert.deepEqual(await readFile(f.u.downloaded),binary);
  assert.match(f.calls[0].url,/\?check=\d+$/);assert.equal(f.calls[0].opts.cache,'no-store');
  const request=f.calls.find(c=>c.url===LFS_URL);assert.deepEqual(JSON.parse(request.opts.body).objects,[{oid:release.sha256,size:release.size}]);
  assert.ok(f.calls.every(c=>c.opts.credentials==='omit'));
  const diagnostics=await f.u.diagnostics();assert.ok(!diagnostics.includes('synthetic-private-query'));assert.ok(!diagnostics.includes(f.directory));assert.match(diagnostics,/github-lfs/);
  const restart=new DesktopUpdater({version:'2.13.0',supported:true,directory:f.directory});await restart.initialize();assert.equal(restart.phase,'ready');
 }finally{await f.cleanup();}
});
test('fallback rejects wrong object identities, sizes, unrelated hosts and CDN paths, and keeps external redirects unfetched',async()=>{
 for(const patch of [{oid:'c'.repeat(64)},{size:release.size+1},{actions:{download:{href:'https://evil.example/'+release.sha256}}},{actions:{download:{href:href.replace(release.sha256,'d'.repeat(64))}}},{error:{code:404}}]){
  const calls=[];const fetcher=async(url)=>{calls.push(url);return url===release.url?new Response(null,{status:302,headers:{location:'https://evil.example/setup.exe'}}):Response.json(batch(patch));};
  await assert.rejects(downloadResponse(fetcher,release,new AbortController().signal));assert.deepEqual(calls,[release.url,LFS_URL]);
 }
 const f=await fixture({fetch:async(url)=>url.split('?')[0]===FEED_URL?Response.json(release):url===release.url?new Response(null,{status:403}):url===LFS_URL?Response.json(batch()):new Response(Buffer.alloc(binary.length))});
 try{await f.u.check();assert.equal(f.u.phase,'available');assert.equal(f.u.downloaded,null);await assert.rejects(f.u.install());}finally{await f.cleanup();}
});
test('a stalled response header switches transport, but a successful response can stream beyond the header timeout',async()=>{
 const controller=new AbortController();
 const result=await downloadResponse(async(url,options)=>{
  if(url===release.url)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('Header timeout')),{once:true}));
  if(url===LFS_URL)return Response.json(batch());
  return new Response(new ReadableStream({start(stream){setTimeout(()=>{stream.enqueue(binary);stream.close();},25);}}));
 },release,controller.signal,{headerTimeout:5});
 assert.equal(result.source,'github-lfs');assert.deepEqual(Buffer.from(await result.response.arrayBuffer()),binary);
 controller.abort();await assert.rejects(downloadResponse(async()=>{throw Error('Aborted');},release,controller.signal));
});
test('automatic delivery starts once, polls each minute, retries outages sooner and resumes without losing its timer to throttling',async()=>{
 let now=10000,serial=0;const tasks=new Map(),timers={now:()=>now,set:(fn,ms)=>{const id=++serial;tasks.set(id,{fn,ms});return id;},clear:id=>tasks.delete(id)};
 let fail=true;const f=await fixture({timers,fetch:async()=>{if(fail)throw Error('Offline');return Response.json({...release,version:'2.13.0',url:release.url.replace('2.14.0','2.13.0')});}});
 try{
  const tick=async()=>{assert.equal(tasks.size,1);const [id,t]=[...tasks][0];tasks.delete(id);now+=t.ms;await t.fn();};
  f.u.start();f.u.start();assert.equal([...tasks.values()][0].ms,2000);await tick();assert.equal(f.u.phase,'error');assert.equal([...tasks.values()][0].ms,15000);
  await tick();assert.equal([...tasks.values()][0].ms,30000);fail=false;now+=5000;await f.u.wake();assert.equal(f.u.phase,'idle');assert.equal([...tasks.values()][0].ms,60000);
  now+=1000;await f.u.wake();assert.equal([...tasks.values()][0].ms,4000);await tick();assert.equal([...tasks.values()][0].ms,60000);
  assert.equal(f.u.snapshot().nextCheck,now+60000);f.u.stop();assert.equal(tasks.size,0);
 }finally{await f.cleanup();}
});
