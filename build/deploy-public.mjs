import {pathToFileURL} from 'node:url';
export async function triggerPublicDeploy({hook=process.env.RENDER_DEPLOY_HOOK,commit=process.env.GITHUB_SHA,fetchImpl=fetch}={}){
 if(!hook)return{triggered:false};
 let url;try{url=new URL(hook);}catch{throw Error('The private Render deploy hook is invalid.');}
 if(url.protocol!=='https:'||url.hostname!=='api.render.com'||url.port||url.username||url.password||!/^\/deploy\/srv-[a-zA-Z0-9]+$/.test(url.pathname)||!url.searchParams.get('key')||url.hash||[...url.searchParams.keys()].some(k=>!['key','ref'].includes(k)))throw Error('The private Render deploy hook must target the existing service at api.render.com.');
 if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('A tested source commit is required to deploy Public Voxora.');
 url.searchParams.set('ref',commit);
 let response;try{response=await fetchImpl(url.href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('Render did not accept the deployment request. Check the private deploy hook and service access.');}
 if(!response.ok)throw Error('Render rejected the deployment request (HTTP '+response.status+').');
 return{triggered:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const result=await triggerPublicDeploy();console.log(result.triggered?'Render accepted deployment of the tested source commit. Waiting for public-service verification.':'No private deploy hook is configured. Waiting for Render Auto-Deploy on Commit or a manual deployment.');}
 catch(e){console.error('::error title=Public Voxora deployment::'+e.message);process.exitCode=1;}
}
