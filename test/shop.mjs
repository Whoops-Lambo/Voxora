import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {shopService,shopConfig} from '../shop.js';
import {initializeServer} from '../management.js';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
function harness(){
 const owner={id:'owner'},buyer={id:'buyer'},other={id:'other'},s=initializeServer({id:'s',ownerId:'owner',name:'Store Lab',members:['owner','buyer','other'],channels:[{id:'c',type:'text'}]});s.roles.push({id:'perk',name:'Supporter',position:1,permissions:[]});
 const state={users:[owner,buyer,other],servers:[s],platform:{ownerId:'owner'}},sessions=new Map(),intents=new Map(),charges=new Map(),requests=[];
 const config={ready:true,mode:'test',webhookSecret:'whsec_fixtureOnly',publicUrl:'https://voxora.example',missing:[]};let saves=0;
 const gateway={async request(path,fields,options={}){
  requests.push({path,fields,options});
  if(path==='/accounts')return{id:'acct_seller'};
  if(path==='/account_links')return{url:'https://connect.stripe.com/setup/test'};
  if(path==='/accounts/acct_seller')return{id:'acct_seller',charges_enabled:true,payouts_enabled:true,details_submitted:true};
  if(path==='/checkout/sessions'){
   const id='cs_fixture'+sessions.size,pi='pi_fixture'+sessions.size,metadata={voxora_order_id:fields['metadata[voxora_order_id]'],voxora_user_id:fields['metadata[voxora_user_id]'],voxora_server_id:fields['metadata[voxora_server_id]']},subtotal=Number(fields['line_items[0][price_data][unit_amount]'])*Number(fields['line_items[0][quantity]']),total=subtotal+Number(fields['shipping_options[0][shipping_rate_data][fixed_amount][amount]']||0),c={id,mode:'payment',status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/c/pay/'+id,client_reference_id:fields.client_reference_id,metadata,currency:'usd',amount_total:total,line_items:{data:[{quantity:Number(fields['line_items[0][quantity]']),price:{unit_amount:Number(fields['line_items[0][price_data][unit_amount]']),currency:'usd'}}]},payment_intent:pi};sessions.set(id,c);intents.set(pi,{id:pi,livemode:false,status:'succeeded',amount_received:total,currency:'usd',application_fee_amount:Number(fields['payment_intent_data[application_fee_amount]']),metadata:{voxora_order_id:metadata.voxora_order_id}});return structuredClone(c);
  }
  if(path.startsWith('/checkout/sessions/'))return structuredClone(sessions.get(path.split('/').at(-1).split('?')[0]));
  if(path.startsWith('/payment_intents/'))return structuredClone(intents.get(path.split('/').at(-1)));
  if(path.startsWith('/charges/'))return structuredClone(charges.get(path.split('/').at(-1)));
  throw Error('Unexpected Stripe request '+path);
 }};
 const management={log(){},async commit(){saves++;}};
 let service=shopService({state,body:async r=>r.data,bytes:async r=>r.raw,json:(res,status,data)=>Object.assign(res,{status,data}),fail,save:async()=>{saves++;},refresh(){},management,userById:id=>state.users.find(u=>u.id===id),config,gateway});
 async function call(who,path,method='GET',data){const res={};try{await service.handle({method,data},res,new URL('https://voxora.example/api'+path),who);return res;}catch(e){if(!e.status)throw e;return{status:e.status,data:{error:e.message}};}}
 async function webhook(o,type='checkout.session.completed',changes={}){const event={id:'evt_'+randomUUID().replaceAll('-',''),account:'acct_seller',livemode:false,type,data:{object:{id:o.sessionId,metadata:{voxora_order_id:o.id}}},...changes},raw=Buffer.from(JSON.stringify(event)),t=Math.floor(Date.now()/1000),sig=createHmac('sha256',config.webhookSecret).update(t+'.').update(raw).digest('hex'),res={};try{await service.handlePublic({method:'POST',raw,headers:{'stripe-signature':'t='+t+',v1='+sig}},res,new URL('https://voxora.example/api/shop/stripe/webhook'));return res;}catch(e){if(!e.status)throw e;return{status:e.status};}}
 const product=(type='digital',changes={})=>call(owner,'/servers/s/shop/products','POST',{name:'Supporter',description:'A useful community perk',price:1000,type,roleId:type==='digital'?'perk':undefined,instructions:'Private download instructions',shippingCountries:['US'],shippingCents:300,stock:null,...changes});
 const checkout=(id,changes={})=>call(buyer,'/servers/s/shop/checkout','POST',{productId:id,quantity:1,nonce:randomUUID(),...changes});
 const pay=o=>{sessions.get(o.sessionId).status='complete';sessions.get(o.sessionId).payment_status='paid';};
 return{state,s,owner,buyer,other,call,webhook,product,checkout,pay,sessions,intents,charges,requests,onboard:()=>call(owner,'/servers/s/shop/onboard','POST',{country:'US'})};
}
const ok=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.data;};

test('Connect checkout pays the original seller, freezes 7.5% excluding shipping and grants only after canonical signed payment validation',async()=>{
 const h=harness();ok(await h.onboard());const p=ok(await h.product()),nonce=randomUUID();
 const attempts=await Promise.all([h.checkout(p.id,{nonce}),h.checkout(p.id,{nonce})]);attempts.forEach(ok);assert.equal(h.state.shop.orders.length,1);assert.equal(h.requests.filter(r=>r.path==='/checkout/sessions').length,1);
 const o=h.state.shop.orders[0];assert.equal(o.fee,75);assert.equal(o.accountId,'acct_seller');assert.ok(h.requests.find(r=>r.path==='/checkout/sessions').options.accountId==='acct_seller');
 assert.ok(!(h.s.memberRoles.buyer||[]).includes('perk'));assert.ok(!JSON.stringify(ok(await h.call(h.other,'/servers/s/shop'))).includes('Private download instructions'));assert.ok(!JSON.stringify(ok(await h.call(h.buyer,'/shop/orders'))).includes('Private download instructions'));
 h.pay(o);h.intents.get(o.paymentIntentId||h.sessions.get(o.sessionId).payment_intent).application_fee_amount=0;assert.equal((await h.webhook(o)).status,400);assert.equal(o.status,'pending');
 h.intents.get(h.sessions.get(o.sessionId).payment_intent).application_fee_amount=75;
 assert.equal((await h.webhook(o,'checkout.session.completed',{account:'acct_wrong'})).status,200);assert.equal(o.status,'pending');
 ok(await h.webhook(o));assert.equal(o.status,'paid');assert.ok(h.s.memberRoles.buyer.includes('perk'));ok(await h.webhook(o));assert.equal(h.s.memberRoles.buyer.filter(id=>id==='perk').length,1);
 assert.ok(JSON.stringify(ok(await h.call(h.buyer,'/shop/orders'))).includes('Private download instructions'));assert.equal(ok(await h.call(h.other,'/shop/orders')).items.length,0);
 const visible=JSON.stringify(ok(await h.call(h.buyer,'/servers/s/shop')));assert.ok(!visible.includes('storeAccount'));
});

test('physical stock reservations serialize checkout, preserve late-payment stock and keep shipping private to the buyer and original seller',async()=>{
 const h=harness();ok(await h.onboard());const p=ok(await h.product('physical',{stock:1})),r=await Promise.all([h.checkout(p.id),h.checkout(p.id)]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);
 const o=h.state.shop.orders[0];assert.equal(o.total,1300);assert.equal(o.fee,75);o.expiresAt=Date.now()-1;assert.equal((await h.checkout(p.id)).status,409,'local expiry cannot release stock before canonical Stripe expiration');
 h.sessions.get(o.sessionId).shipping_details={name:'Private buyer',address:{line1:'123 Private Lane',country:'US'}};h.pay(o);ok(await h.webhook(o));assert.equal(o.fulfillment,'awaiting_shipment');assert.equal(h.state.shop.products[0].stock,0);
 assert.equal(ok(await h.call(h.other,'/shop/orders')).items.length,0);assert.ok(JSON.stringify(ok(await h.call(h.owner,'/shop/orders'))).includes('123 Private Lane'));
 assert.equal((await h.call(h.buyer,'/shop/orders/'+o.id,'PATCH',{fulfillment:'shipped'})).status,403);ok(await h.call(h.owner,'/shop/orders/'+o.id,'PATCH',{fulfillment:'shipped',tracking:'TRACK123'}));assert.equal(o.tracking,'TRACK123');
});

test('changed seller or unsafe role requires fulfillment review, refunds do not remove independently assigned roles, and fee controls are owner-only',async()=>{
 const h=harness();ok(await h.onboard());const p=ok(await h.product());ok(await h.checkout(p.id));const o=h.state.shop.orders[0];h.s.roles.find(r=>r.id==='perk').permissions=['administrator'];h.pay(o);ok(await h.webhook(o));assert.equal(o.fulfillment,'seller_review_required');assert.ok(!(h.s.memberRoles.buyer||[]).includes('perk'));
 h.s.roles.find(r=>r.id==='perk').permissions=[];ok(await h.checkout(p.id));const second=h.state.shop.orders[1];h.pay(second);ok(await h.webhook(second));h.s.memberRoleRevisions.buyer++;
 h.charges.set('ch_fixture',{id:'ch_fixture',payment_intent:second.paymentIntentId,amount_refunded:second.total});ok(await h.webhook(second,'charge.refunded',{data:{object:{id:'ch_fixture',payment_intent:second.paymentIntentId,metadata:{voxora_order_id:second.id}}}}));assert.equal(second.status,'refunded');assert.ok(h.s.memberRoles.buyer.includes('perk'),'manual role revision prevents a refund from deleting the role');
 assert.equal((await h.call(h.buyer,'/platform/shop-configuration','PATCH',{feeBasisPoints:500})).status,403);assert.equal((await h.call(h.owner,'/platform/shop-configuration','PATCH',{feeBasisPoints:1100})).status,400);assert.equal(ok(await h.call(h.owner,'/platform/shop-configuration','PATCH',{feeBasisPoints:1000})).feeBasisPoints,1000);
 h.s.ownerId=h.other.id;assert.equal((await h.checkout(p.id)).status,404);assert.equal(shopConfig({}).ready,false);
});
