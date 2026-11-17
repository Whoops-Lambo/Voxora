// Read-only production checks: no accounts, grants, messages or orders are created.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assertDeployment,PUBLIC_APP_ASSETS} from './deployment-readiness.mjs';
const {DEFAULT_SERVER}=createRequire(import.meta.url)('../desktop/connection.cjs');
const request=async path=>fetch(DEFAULT_SERVER+path,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 const features=process.argv.includes('--require-features'),sync=process.argv.includes('--require-sync'),requireVersion=process.argv.includes('--require-version'),requireCommit=process.argv.includes('--require-commit'),assets=process.argv.includes('--require-assets'),pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const expected={requireFeatures:features,requireSync:sync,...(requireVersion?{version:pkg.version}:{}),...(requireCommit?{commit:process.env.GITHUB_SHA}:{})};
 if(requireCommit&&!/^[a-f0-9]{40}$/.test(expected.commit||''))throw Error('Set GITHUB_SHA to the tested source commit.');
 const deadline=Date.now()+((features||sync||requireVersion||assets)?8*60000:0);let metadata;
 while(true){
  try{
   const response=await request('/api/info?deployment='+encodeURIComponent(expected.commit||pkg.version));assert.equal(response.status,200,'Public metadata is unavailable.');metadata=assertDeployment(await response.json(),expected);
   if(assets)for(const name of PUBLIC_APP_ASSETS){const served=await request('/'+name+'?deployment='+encodeURIComponent(expected.commit||pkg.version));assert.equal(served.status,200,'The public interface is missing '+name+'.');assert.equal(digest(Buffer.from(await served.arrayBuffer())),digest(await readFile(new URL('../public/'+name,import.meta.url))),'The public interface still serves an older '+name+'.');}
   break;
  }catch(error){if(Date.now()>=deadline)throw error;console.log('Waiting for the matching public deployment: '+error.message);await new Promise(r=>setTimeout(r,10000));}
 }
 const [app,state]=await Promise.all([request('/app'),request('/api/state')]);assert.equal(app.status,200);assert.match(await app.text(),/id="auth"/);assert.equal(state.status,401,'Private account state must require sign-in.');
 if(features)for(const path of ['/safety','/terms','/privacy','/emoji-data.json']){const response=await request(path);assert.equal(response.status,200,path+' must be deployed.');if(path.endsWith('.json'))assert.ok((await response.json()).length>1800);}
 console.log('::notice title=Public Voxora health::Public Voxora '+metadata.version+' is deployed with the required community features, matching interface assets, and authenticated private state.');
}catch(e){console.error('::error title=Public Voxora health::'+String(e.message).replace(/[\r\n]/g,' ')+' Enable Auto-Deploy on Commit or configure the private RENDER_DEPLOY_HOOK repository secret.');process.exitCode=1;}
