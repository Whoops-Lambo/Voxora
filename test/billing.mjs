import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { stripeFixture,testWebhookSecret } from './support/stripe-fixture.mjs';
import { billingConfig,verifyStripeSignature,stripeGateway } from '../billing.js';
import { setupStripe } from '../build/stripe-setup.mjs';
const event=(id,type,object)=>({id:'evt_'+id,type,data:{object}});
const subscription=(id,customer,userId,changes={})=>({id,customer,status:'active',current_period_end:Math.floor(Date.now()/1000)+86400,cancel_at_period_end:false,metadata:{voxora_user_id:userId},items:{data:[{price:{id:'price_fixturemonth'},quantity:1}]},...changes});

test('Stripe checkout uses exact published prices, deduplicates pending sessions, binds account metadata and grants only after verified canonical webhooks',async()=>{
 const x=await stripeFixture(),{f}=x;try{
  const owner=await f.register('billing_owner'),user=await f.register('billing_member'),U=(p,m,d)=>f.call(user,p,m,d);
  const catalogs=await Promise.all(Array.from({length:12},()=>f.call(null,'/premium/catalog'))),catalog=catalogs[0].data;assert.ok(catalogs.every(r=>r.data.checkoutAvailable));assert.deepEqual(catalog.prices.map(p=>p.amount),[999,8999]);assert.equal((await x.read()).requests.filter(r=>r.path.startsWith('/v1/prices/')).length,2,'concurrent public pricing reads must share one provider lookup');
  const attempts=await Promise.all([U('/premium/checkout','POST',{interval:'month'}),U('/premium/checkout','POST',{interval:'month'}),U('/premium/checkout','POST',{interval:'month'})]);assert.ok(attempts.every(r=>r.status===200));let model=await x.read();assert.equal(model.customers,1);assert.equal(model.sessions,1);assert.equal((await U('/premium/me')).data.active,false);
  const sent=model.requests.find(r=>r.path==='/v1/checkout/sessions');assert.equal(sent.fields['line_items[0][price]'],'price_fixturemonth');assert.equal(sent.fields['line_items[0][quantity]'],'1');assert.equal(sent.fields['subscription_data[metadata][voxora_user_id]'],user.id);assert.equal(sent.fields.success_url,'http://127.0.0.1:9999/app?plus=success');
  assert.equal((await U('/premium/checkout','POST',{interval:'year'})).status,409);
  await x.update(m=>m.subscriptions.sub_first=subscription('sub_first','cus_fixture1',user.id));const complete=event('complete','checkout.session.completed',{customer:'cus_fixture1',subscription:'sub_first'});
  const replies=await Promise.all([x.webhook(complete),x.webhook(complete)]);assert.ok(replies.every(r=>r.status===200));let info=(await U('/premium/me')).data;assert.equal(info.active,true);assert.equal(info.billing.pendingCheckout,null);assert.equal(info.perks.uploadBytes,25*1048576);
  const before=info.version;assert.equal((await x.webhook(complete)).status,200);assert.equal((await U('/premium/me')).data.version,before);
  assert.equal((await U('/premium/checkout','POST',{interval:'month'})).status,409);const portal=await U('/premium/portal','POST',{});assert.equal(portal.status,200);assert.match(portal.data.url,/^https:\/\/billing\.stripe\.com\//);model=await x.read();assert.equal(model.requests.find(r=>r.path==='/v1/billing_portal/sessions').fields.customer,'cus_fixture1');
  const publicBoot=JSON.stringify((await f.call(owner,'/state')).data);assert.ok(!publicBoot.includes('cus_fixture1'));assert.ok(!publicBoot.includes('sub_first'));assert.ok(!publicBoot.includes('sk_test_fixtureOnly'));
  await f.stop();await f.start();assert.equal((await U('/premium/me')).data.active,true);assert.equal((await x.webhook(complete)).status,200);assert.equal((await U('/premium/me')).data.version,before);
  await f.stop();x.extraEnv.VOXORA_STRIPE_SECRET_KEY='sk_live_fixtureOnly';await f.start();assert.equal((await U('/premium/me')).data.active,false,'test subscriptions must not carry into live billing');assert.equal((await U('/premium/me')).data.billing.hasCustomer,false);
  await f.stop();x.extraEnv.VOXORA_STRIPE_SECRET_KEY='sk_test_fixtureOnly';await f.start();assert.equal((await U('/premium/me')).data.active,true,'switching back restores the saved test binding');
 }finally{await x.cleanup();}
});

test('signed webhook replays, cross-account bindings, unsupported products and delayed cancellation events cannot grant or restore inappropriate access',async()=>{
 const x=await stripeFixture(),{f}=x;try{
  const user=await f.register('lifecycle_member'),U=(p,m,d)=>f.call(user,p,m,d);await U('/premium/checkout','POST',{interval:'month'});
  const payload=event('paid','customer.subscription.updated',{id:'sub_lifecycle',customer:'cus_fixture1'});await x.update(m=>m.subscriptions.sub_lifecycle=subscription('sub_lifecycle','cus_fixture1',user.id));
  assert.equal((await x.webhook(payload,{signature:'t=1,v1='+'0'.repeat(64)})).status,400);assert.equal((await x.webhook(payload,{timestamp:Math.floor(Date.now()/1000)-301})).status,400);assert.equal((await U('/premium/me')).data.active,false);
  await x.update(m=>m.subscriptions.sub_lifecycle.metadata.voxora_user_id='another_account');assert.equal((await x.webhook(payload)).status,400);assert.equal((await U('/premium/me')).data.active,false);await x.update(m=>m.subscriptions.sub_lifecycle.metadata.voxora_user_id=user.id);assert.equal((await x.webhook(payload)).status,200);assert.equal((await U('/premium/me')).data.active,true);
  await x.update(m=>m.subscriptions.sub_lifecycle.cancel_at_period_end=true);assert.equal((await x.webhook(event('cancel_scheduled','customer.subscription.updated',{id:'sub_lifecycle',customer:'cus_fixture1'}))).status,200);assert.equal((await U('/premium/me')).data.active,true);assert.equal((await U('/premium/me')).data.billing.cancelAtPeriodEnd,true);
  await x.update(m=>m.subscriptions.sub_lifecycle.items.data[0].price.id='price_unrelated');await x.webhook(event('unsupported','customer.subscription.updated',{id:'sub_lifecycle',customer:'cus_fixture1'}));assert.equal((await U('/premium/me')).data.active,false);
  await x.update(m=>m.subscriptions.sub_lifecycle.items.data[0].price.id='price_fixturemonth');await x.webhook(event('restored_product','customer.subscription.updated',{id:'sub_lifecycle',customer:'cus_fixture1'}));assert.equal((await U('/premium/me')).data.active,true);
  await x.update(m=>m.subscriptions.sub_lifecycle.status='canceled');await x.webhook(event('deleted','customer.subscription.deleted',{id:'sub_lifecycle',customer:'cus_fixture1'}));assert.equal((await U('/premium/me')).data.active,false);
  await x.webhook(event('old_active_event','customer.subscription.updated',{id:'sub_lifecycle',customer:'cus_fixture1',status:'active',current_period_end:9999999999}));assert.equal((await U('/premium/me')).data.active,false,'canonical canceled state wins over old event payload');
  const stored=JSON.parse(await readFile(f.dir+'/state.json','utf8'));assert.equal(stored.premiumBilling.events.filter(id=>id==='evt_paid').length,1);
 }finally{await x.cleanup();}
});

test('wrong Stripe amounts, provider failures, forged checkout fields and external redirect URLs cannot create a wrong-price or unsafe checkout',async()=>{
 const x=await stripeFixture(),{f}=x;try{
  const user=await f.register('checkout_safety'),U=(p,m,d)=>f.call(user,p,m,d);await x.update(m=>m.wrongPrice=true);assert.equal((await f.call(null,'/premium/catalog')).data.checkoutAvailable,false);assert.equal((await U('/premium/checkout','POST',{interval:'month'})).status,503);assert.equal((await x.read()).customers,0);
  await x.update(m=>m.wrongPrice=false);await f.stop();await f.start();assert.equal((await U('/premium/checkout','POST',{interval:'day'})).status,400);
  await x.update(m=>m.evilCheckout=true);assert.equal((await U('/premium/checkout','POST',{interval:'month'})).status,502);assert.equal((await U('/premium/me')).data.billing.pendingCheckout,null);
  await x.update(m=>m.evilCheckout=false);const valid=await U('/premium/checkout','POST',{interval:'year',priceId:'price_attacker',userId:'attacker',quantity:100});assert.equal(valid.status,200);let model=await x.read();const request=model.requests.filter(r=>r.path==='/v1/checkout/sessions').at(-1);assert.equal(request.fields['line_items[0][price]'],'price_fixtureyear');assert.equal(request.fields['line_items[0][quantity]'],'1');assert.equal(request.fields.client_reference_id,user.id);assert.equal(model.customers,1);
  assert.equal((await U('/premium/checkout/cancel','POST',{})).status,200);assert.equal((await U('/premium/me')).data.billing.pendingCheckout,null);
  await x.update(m=>m.failNext=true);assert.equal((await U('/premium/checkout','POST',{interval:'month'})).status,502);const retry=await U('/premium/checkout','POST',{interval:'month'});assert.equal(retry.status,200);model=await x.read();assert.equal(model.customers,1);assert.equal((await U('/premium/me')).data.active,false);
  // A checkout paid while webhooks were unavailable must not produce a second subscription.
  await f.stop();const stored=JSON.parse(await readFile(f.dir+'/state.json','utf8')),account=stored.users.find(u=>u.id===user.id),pending=account.premium.billing.pendingCheckout;account.premium.billing.pendingCheckout.expiresAt=Date.now()-1;await writeFile(f.dir+'/state.json',JSON.stringify(stored));
  await x.update(m=>{m.checkoutSessions[pending.id].status='complete';m.checkoutSessions[pending.id].subscription='sub_recovered';m.subscriptions.sub_recovered=subscription('sub_recovered','cus_fixture1',user.id);});await f.start();
  const sessionsBefore=(await x.read()).sessions;assert.equal((await U('/premium/checkout','POST',{interval:'month'})).status,409);assert.equal((await U('/premium/me')).data.active,true);assert.equal((await x.read()).sessions,sessionsBefore);assert.equal((await U('/premium/sync','POST',{})).status,200);
 }finally{await x.cleanup();}
});

test('Stripe transport and catalog setup keep secrets out of results, pin the API and safely reuse the exact approved product and recurring prices',async()=>{
 const raw=Buffer.from('{"id":"evt_fixture"}'),now=Date.now(),stamp=Math.floor(now/1000),signature='t='+stamp+',v1='+createHmac('sha256',testWebhookSecret).update(stamp+'.').update(raw).digest('hex');assert.equal(verifyStripeSignature(raw,signature,testWebhookSecret,now),true);assert.equal(verifyStripeSignature(Buffer.from('tampered'),signature,testWebhookSecret,now),false);
 assert.equal(billingConfig({}).ready,false);assert.equal(billingConfig({VOXORA_STRIPE_SECRET_KEY:'sk_test_fixture',VOXORA_STRIPE_WEBHOOK_SECRET:testWebhookSecret,VOXORA_PUBLIC_URL:'http://untrusted.example',VOXORA_STRIPE_MONTHLY_PRICE_ID:'price_month',VOXORA_STRIPE_YEARLY_PRICE_ID:'price_year'}).ready,false);
 let captured;const gateway=stripeGateway({secret:'sk_test_fixtureOnly'},{fetchImpl:async(url,options)=>{captured={url,options};return new Response('{"id":"price_fixture"}',{status:200});}});await gateway.request('/prices/price_fixture');assert.equal(captured.url,'https://api.stripe.com/v1/prices/price_fixture');assert.equal(captured.options.redirect,'error');assert.equal(captured.options.headers['Stripe-Version'],'2024-06-20');
 const saved=new Map();let products=0,prices=0;const fake={request:async(path,fields)=>{
  if(path==='/products/voxora_plus'){if(saved.has('product'))return saved.get('product');const e=Error('Synthetic 404');e.status=404;throw e;}
  if(path==='/products'){products++;const p={id:fields.id,active:true,metadata:{voxora_plan:fields['metadata[voxora_plan]']}};saved.set('product',p);return p;}
  if(path.startsWith('/prices?')){const key=new URLSearchParams(path.split('?')[1]).get('lookup_keys[]');return{data:saved.has(key)?[saved.get(key)]:[]};}
  if(path==='/prices'){prices++;const p={id:'price_created'+prices,product:fields.product,active:true,currency:fields.currency,unit_amount:Number(fields.unit_amount),recurring:{interval:fields['recurring[interval]']}};saved.set(fields.lookup_key,p);return p;}
  throw Error('Unexpected synthetic path');
 }};
 const first=await setupStripe(fake),second=await setupStripe(fake);assert.deepEqual(first,second);assert.equal(products,1);assert.equal(prices,2);assert.deepEqual([...saved.values()].filter(v=>v.unit_amount).map(v=>v.unit_amount),[999,8999]);assert.ok(!JSON.stringify(first).includes('sk_test'));
});
