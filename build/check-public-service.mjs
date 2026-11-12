// Anonymous deployment checks only. Never register accounts or change live data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { DEFAULT_SERVER, verifyServer } = createRequire(import.meta.url)('../desktop/connection.cjs');
try {
  let metadata, info;
  const requireFeatures=process.argv.includes('--require-features'),requireSync=process.argv.includes('--require-sync'),deadline=Date.now()+240000;
  while(true){
    try{
      info=await verifyServer(DEFAULT_SERVER,{fetch:async(...args)=>{const response=await fetch(...args);metadata=await response.clone().json();return response;}});
      if(requireSync)assert.equal(metadata.realtimeSync,true,'Render has not deployed the chat recovery fix. Enable Auto-Deploy On Commit or select Manual Deploy / Deploy latest commit.');
      if(requireFeatures)for(const capability of ['publicSafety','serverVerification','backgroundPush','externalExpressions','messageNotifications','mobileLayout','voiceMessages','messageForwarding','advancedSearch','personalTools','plusStudio','groupChats','teamPlanning','eventCenter','communityVoices','serverProfiles','suggestionBoards'])assert.equal(metadata.capabilities?.[capability],true,'Render has not deployed '+capability+'. Select Manual Deploy / Deploy latest commit.');
      break;
    }catch(error){if(!(requireSync||requireFeatures)||Date.now()>=deadline)throw error;console.log('Waiting for the public backend deployment…');await new Promise(resolve=>setTimeout(resolve,10000));}
  }
  assert.equal(metadata.privateWorkspace, false, 'The public service must share one platform.');
  assert.ok(info.instanceId, 'The public service needs a persistent installation identity.');
  const [app, state] = await Promise.all([
    fetch(DEFAULT_SERVER + info.appPath, { signal: AbortSignal.timeout(45000), redirect: 'error' }),
    fetch(DEFAULT_SERVER + '/api/state', { signal: AbortSignal.timeout(45000), redirect: 'error' }),
  ]);
  assert.equal(app.status, 200, 'The public chat page is unavailable.');
  assert.match(await app.text(), /id="auth"/);
  assert.equal(state.status, 401, 'Private account state must require sign-in.');
  if(requireFeatures){for(const page of ['/safety','/terms','/privacy','/emoji-data.json']){const response=await fetch(DEFAULT_SERVER+page,{signal:AbortSignal.timeout(45000),redirect:'error'});assert.equal(response.status,200,page+' must be deployed.');if(page.endsWith('.json'))assert.ok((await response.json()).length>1800,'Full emoji catalog must be deployed.');}}
  console.log(`::notice title=Public Voxora health::Public Voxora ${metadata.version} is healthy at ${DEFAULT_SERVER}. Chat loads, installation identity is present, and private state requires sign-in. Chat recovery deployed: ${metadata.realtimeSync===true}.`);
} catch (error) {
  console.error('::error title=Public Voxora health::' + String(error.message).replace(/[\r\n]/g, ' '));
  process.exitCode = 1;
}
