import { mkdtemp,writeFile,readFile,rename,rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { fixture } from './server.mjs';
export const testWebhookSecret='whsec_fixture_only_never_live_4a6e21b9';
export async function stripeFixture(){
 const dir=await mkdtemp('/tmp/voxora-stripe-'),modelPath=dir+'/provider.json';await writeFile(modelPath,JSON.stringify({requests:[],customers:0,sessions:0,subscriptions:{}}));
 const extraEnv={NODE_OPTIONS:'--import='+fileURLToPath(new URL('./stripe-mock.mjs',import.meta.url)),VOXORA_TEST_STRIPE_STATE:modelPath,VOXORA_STRIPE_SECRET_KEY:'sk_test_fixtureOnly',VOXORA_STRIPE_WEBHOOK_SECRET:testWebhookSecret,VOXORA_STRIPE_MONTHLY_PRICE_ID:'price_fixturemonth',VOXORA_STRIPE_YEARLY_PRICE_ID:'price_fixtureyear',VOXORA_PUBLIC_URL:'http://127.0.0.1:9999'};const f=await fixture({extraEnv});
 const read=async()=>JSON.parse(await readFile(modelPath,'utf8'));
 const update=async fn=>{const state=await read();fn(state);await writeFile(modelPath+'.parent',JSON.stringify(state));await rename(modelPath+'.parent',modelPath);};
 async function webhook(event,{signature,timestamp=Math.floor(Date.now()/1000)}={}){const raw=JSON.stringify(event),digest=createHmac('sha256',testWebhookSecret).update(timestamp+'.'+raw).digest('hex');const r=await fetch(f.origin+'/api/billing/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':signature||'t='+timestamp+',v1='+digest},body:raw});return{status:r.status,data:await r.json()};}
 return{f,extraEnv,read,update,webhook,cleanup:async()=>{await f.cleanup();await rm(dir,{recursive:true,force:true});}};
}
