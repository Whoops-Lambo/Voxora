// Test-only preload. Production always talks to the fixed api.stripe.com endpoint.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
const original=globalThis.fetch,filename=process.env.VOXORA_TEST_STRIPE_STATE;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(String(input));if(url.hostname!=='api.stripe.com')return original(input,options);
 if((options.method||'GET')==='GET'&&url.pathname.startsWith('/v1/prices/'))await new Promise(resolve=>setTimeout(resolve,20));
 const state=JSON.parse(readFileSync(filename,'utf8')),fields=Object.fromEntries(new URLSearchParams(options.body)),method=options.method||'GET',path=url.pathname;
 state.requests.push({method,path,fields,apiVersion:options.headers?.['Stripe-Version']});let data,status=200;
 if(state.failNext){state.failNext=false;status=503;data={error:{message:'Synthetic provider outage'}};}
 else if(method==='GET'&&path.startsWith('/v1/prices/')){const interval=path.endsWith('year')?'year':'month';data={id:path.split('/').at(-1),active:true,type:'recurring',billing_scheme:'per_unit',unit_amount:state.wrongPrice?100:interval==='year'?8999:999,currency:'usd',recurring:{interval,interval_count:1,usage_type:'licensed'}};}
 else if(method==='POST'&&path==='/v1/customers'){state.customers++;data={id:'cus_fixture'+state.customers};}
 else if(method==='POST'&&path==='/v1/checkout/sessions'){state.sessions++;data={id:'cs_test_fixture'+state.sessions,customer:fields.customer,mode:'subscription',status:'open',url:state.evilCheckout?'https://example.invalid/checkout':'https://checkout.stripe.com/c/pay/cs_test_fixture'+state.sessions,expires_at:Math.floor(Date.now()/1000)+3600};state.checkoutSessions||={};state.checkoutSessions[data.id]={...data};}
 else if(method==='GET'&&path.startsWith('/v1/checkout/sessions/')){data=state.checkoutSessions?.[path.split('/').at(-1)];if(!data){status=404;data={error:{message:'No synthetic checkout'}};}}
 else if(method==='POST'&&path.endsWith('/expire')){const id=path.split('/').at(-2);if(state.checkoutSessions?.[id])state.checkoutSessions[id].status='expired';data={id,status:'expired'};}
 else if(method==='POST'&&path==='/v1/billing_portal/sessions')data={url:'https://billing.stripe.com/p/session/test_fixture'};
 else if(method==='GET'&&path.startsWith('/v1/subscriptions/')){data=state.subscriptions[path.split('/').at(-1)];if(!data){status=404;data={error:{message:'No synthetic subscription'}};}}
 else{status=404;data={error:{message:'Unexpected synthetic request'}};}
 writeFileSync(filename+'.tmp',JSON.stringify(state));renameSync(filename+'.tmp',filename);
 return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
