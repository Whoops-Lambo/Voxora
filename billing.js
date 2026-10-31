import { createHmac, timingSafeEqual } from 'node:crypto';
import { isSuspended } from './platform.js';
import { initializePremiumUser } from './premium.js';

export function billingConfig(env=process.env) {
  const missing=[];for(const name of ['VOXORA_STRIPE_SECRET_KEY','VOXORA_STRIPE_WEBHOOK_SECRET','VOXORA_PUBLIC_URL'])if(!env[name])missing.push(name);
  const prices={month:env.VOXORA_STRIPE_MONTHLY_PRICE_ID||null,year:env.VOXORA_STRIPE_YEARLY_PRICE_ID||null};if(!prices.month)missing.push('VOXORA_STRIPE_MONTHLY_PRICE_ID');if(!prices.year)missing.push('VOXORA_STRIPE_YEARLY_PRICE_ID');
  let publicUrl;try{const u=new URL(env.VOXORA_PUBLIC_URL);if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error();publicUrl=u.origin;}catch{if(env.VOXORA_PUBLIC_URL)missing.push('valid VOXORA_PUBLIC_URL');}
  if(env.VOXORA_STRIPE_SECRET_KEY&&!/^(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+$/.test(env.VOXORA_STRIPE_SECRET_KEY))missing.push('valid Stripe secret key');
  if(Object.values(prices).some(id=>id&&!/^price_[A-Za-z0-9]+$/.test(id)))missing.push('valid Stripe recurring price IDs');
  const mode=/^(?:sk|rk)_(test|live)_/.exec(env.VOXORA_STRIPE_SECRET_KEY||'')?.[1]||null;
  return {ready:!missing.length,missing,prices,secret:env.VOXORA_STRIPE_SECRET_KEY,webhookSecret:env.VOXORA_STRIPE_WEBHOOK_SECRET,publicUrl,mode,testMode:mode==='test'};
}
export function verifyStripeSignature(raw,signature,secret,now=Date.now()) {
  if(!secret||typeof signature!=='string'||signature.length>2048)return false;
  const parts=signature.split(',').map(s=>s.trim().split('=')),timestamps=parts.filter(([k])=>k==='t');if(timestamps.length!==1||!/^\d{9,13}$/.test(timestamps[0][1]))return false;
  const timestamp=timestamps[0][1];if(Math.abs(now/1000-Number(timestamp))>300)return false;
  const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
  return parts.filter(([k,v])=>k==='v1'&&/^[a-f0-9]{64}$/i.test(v||'')).some(([,v])=>timingSafeEqual(expected,Buffer.from(v,'hex')));
}
export function stripeGateway(config,{fetchImpl=fetch}={}) {
  async function request(path,fields,{idempotencyKey}={}) {
    const response=await fetchImpl('https://api.stripe.com/v1'+path,{method:fields?'POST':'GET',headers:{Authorization:'Bearer '+config.secret,'Stripe-Version':'2024-06-20',...(fields?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(fields?{body:new URLSearchParams(fields)}:{}),redirect:'error',signal:AbortSignal.timeout(12000)});
    let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>512000)throw Error('Billing provider response is too large.');chunks.push(chunk);}let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{throw Error('Billing provider response was invalid.');}
    if(!response.ok){const error=Error('Billing provider could not complete the request.');error.status=response.status;throw error;}return data;
  }
  return {request};
}
const idOf=value=>typeof value==='string'?value:value?.id;
const validId=(value,prefix)=>typeof value==='string'&&value.startsWith(prefix+'_')&&/^[A-Za-z0-9_]{3,180}$/.test(value);
export const PLUS_PRICES=[{interval:'month',amount:999,currency:'usd',label:'$9.99'},{interval:'year',amount:8999,currency:'usd',label:'$89.99'}];
export function billingService({state,bytes,json,fail,save,refresh,config=billingConfig(),gateway=stripeGateway(config)}) {
  const locks=new Map(),rate=new Map();let pricesCache,pricesPending,priceRetryAt=0;
  async function locked(userId,fn) {const prior=locks.get(userId)||Promise.resolve(),task=prior.catch(()=>{}).then(fn);locks.set(userId,task);try{return await task;}finally{if(locks.get(userId)===task)locks.delete(userId);}}
  const live=me=>{if(!state.users.includes(me)||me.bot||isSuspended(me))fail(403,'An active human account is required.');};
  const enabled=()=>{if(!config.ready)fail(503,'Purchases are not enabled on this Voxora server. The platform owner can grant Plus access.');};
  const call=async(path,fields)=>{try{return await gateway.request(path,fields);}catch{fail(502,'The billing provider is unavailable. Try again later.');}};
  function limited(me){const now=Date.now(),recent=(rate.get(me.id)||[]).filter(t=>t>now-60000);if(recent.length>=5)fail(429,'Wait a minute before opening billing again.');recent.push(now);rate.set(me.id,recent);if(rate.size>1000)for(const [id,times]of rate)if(times.at(-1)<now-60000)rate.delete(id);}
  async function prices() {
    enabled();if(pricesCache?.until>Date.now())return pricesCache.items;
    if(pricesPending)return pricesPending;if(priceRetryAt>Date.now())fail(503,'Pricing is temporarily unavailable. Try again shortly.');
    const task=(async()=>{const items=[];for(const [interval,id]of Object.entries(config.prices)){if(!id)continue;const p=await call('/prices/'+id),expected=PLUS_PRICES.find(p=>p.interval===interval);if(p.id!==id||!p.active||p.type!=='recurring'||p.recurring?.interval!==interval||p.recurring.interval_count!==1||p.recurring.usage_type==='metered'||p.billing_scheme!=='per_unit'||p.unit_amount!==expected.amount||p.currency!==expected.currency)fail(503,'Stripe prices must match the published Plus plan: US$9.99 monthly or US$89.99 yearly.');items.push({...expected,priceId:id});}pricesCache={items,until:Date.now()+300000};return items;})();
    pricesPending=task;try{return await task;}catch(e){priceRetryAt=Date.now()+10000;throw e;}finally{if(pricesPending===task)pricesPending=null;}
  }
  async function catalog(){let available=config.ready,items=[];if(available)try{items=await prices();}catch{available=false;}return{name:'Voxora Plus',checkoutAvailable:available,testMode:config.testMode,prices:PLUS_PRICES.map(p=>({...p,available:available&&items.some(i=>i.interval===p.interval)}))};}
  async function configuration(){return{...(await catalog()),missing:config.missing,webhookPath:'/api/billing/stripe/webhook',publicUrl:config.publicUrl||null};}
  function recordEvent(id){if(id){state.premiumBilling.events.push(id);state.premiumBilling.events=state.premiumBilling.events.slice(-1000);}}
  async function applySubscription(me,subscription,eventId) {
    const canonical=await call('/subscriptions/'+subscription),b=me.premium.billing;
    if(canonical.id!==subscription||idOf(canonical.customer)!==b.customerId||canonical.metadata?.voxora_user_id!==me.id)fail(400,'Billing subscription does not match this account.');
    const items=canonical.items?.data||[],price=idOf(items[0]?.price),known=b.subscriptionId===subscription&&b.priceId===price;
    if(items.length!==1||items[0].quantity!==1||!known&&!Object.values(config.prices).includes(price)){const changed=b.subscriptionId===subscription;if(changed){b.eligible=false;me.premium.version++;}recordEvent(eventId);await save();if(changed)refresh();return;}
    if(b.subscriptionId&&b.subscriptionId!==subscription&&!['none','canceled','incomplete_expired'].includes(b.status)){recordEvent(eventId);await save();return;}
    if(typeof canonical.status!=='string'||!Number.isSafeInteger(canonical.current_period_end)||canonical.current_period_end<0||!Number.isSafeInteger(canonical.current_period_end*1000))fail(502,'The billing provider returned an invalid subscription.');
    Object.assign(b,{mode:config.mode,subscriptionId:subscription,priceId:price,interval:Object.entries(config.prices).find(([,id])=>id===price)?.[0]||b.interval||null,status:canonical.status,currentPeriodEnd:canonical.current_period_end*1000,cancelAtPeriodEnd:!!canonical.cancel_at_period_end,eligible:true});delete b.pendingCheckout;me.premium.version++;recordEvent(eventId);await save();refresh();
  }
  async function syncInside(me){
    const b=me.premium.billing;
    if(b.subscriptionId&&!['none','canceled','incomplete_expired'].includes(b.status)){await applySubscription(me,b.subscriptionId);return;}
    const pending=b.pendingCheckout;if(!pending)return;
    const session=await call('/checkout/sessions/'+pending.id);if(session.id!==pending.id||idOf(session.customer)!==b.customerId||session.mode!=='subscription')fail(400,'Checkout does not match this account.');
    if(session.status==='complete'&&validId(idOf(session.subscription),'sub'))await applySubscription(me,idOf(session.subscription));
    else if(session.status==='expired'){delete b.pendingCheckout;me.premium.version++;await save();refresh();}
  }
  async function sync(me){enabled();live(me);limited(me);return locked(me.id,async()=>{live(me);await syncInside(me);return{ok:true};});}
  async function checkout(me,interval) {
    enabled();live(me);if(!['month','year'].includes(interval)||!config.prices[interval])fail(400,'Choose an available billing interval.');
    return locked(me.id,async()=>{live(me);initializePremiumUser(me);const b=me.premium.billing;
      if(b.pendingCheckout&&b.pendingCheckout.expiresAt<=Date.now()){limited(me);await syncInside(me);live(me);if(b.pendingCheckout)fail(409,'This checkout is still pending. Continue or cancel it before starting another.');}
      if(b.subscriptionId&&!['none','canceled','incomplete_expired'].includes(b.status))fail(409,'Manage your existing subscription through the billing portal.');
      if(b.pendingCheckout?.expiresAt>Date.now()){if(b.pendingCheckout.interval!==interval)fail(409,'Cancel the pending checkout before changing its billing interval.');return{url:b.pendingCheckout.url,reused:true};}
      limited(me);
      await prices();live(me);
      if(!b.customerId){const customer=await call('/customers',{'metadata[voxora_user_id]':me.id});if(!validId(customer.id,'cus'))fail(502,'The billing provider returned an invalid customer.');live(me);b.mode=config.mode;b.customerId=customer.id;await save();}
      const session=await call('/checkout/sessions',{mode:'subscription',customer:b.customerId,'line_items[0][price]':config.prices[interval],'line_items[0][quantity]':'1',client_reference_id:me.id,'metadata[voxora_user_id]':me.id,'subscription_data[metadata][voxora_user_id]':me.id,success_url:config.publicUrl+'/app?plus=success',cancel_url:config.publicUrl+'/app?plus=cancelled',expires_at:String(Math.floor(Date.now()/1000)+3600)});
      let url;try{url=new URL(session.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.port||url.username||url.password)throw Error();}catch{fail(502,'The billing provider returned an invalid checkout link.');}
      if(!validId(session.id,'cs')||idOf(session.customer)!==b.customerId||session.mode!=='subscription'||session.status!=='open'||!Number.isSafeInteger(session.expires_at)||session.expires_at*1000<=Date.now())fail(502,'The billing provider returned an invalid checkout session.');
      live(me);b.pendingCheckout={id:session.id,url:url.href,interval,expiresAt:session.expires_at*1000};me.premium.version++;await save();refresh();return{url:url.href,reused:false};
    });
  }
  async function cancelCheckout(me){enabled();live(me);limited(me);return locked(me.id,async()=>{live(me);const pending=me.premium.billing.pendingCheckout;if(!pending)return{ok:true};await call('/checkout/sessions/'+pending.id+'/expire',{});live(me);delete me.premium.billing.pendingCheckout;me.premium.version++;await save();refresh();return{ok:true};});}
  async function portal(me){enabled();live(me);limited(me);return locked(me.id,async()=>{live(me);const customer=me.premium.billing.customerId;if(!customer)fail(400,'There is no billing account to manage yet.');const session=await call('/billing_portal/sessions',{customer,return_url:config.publicUrl+'/app?plus=returned'});live(me);let u;try{u=new URL(session.url);if(u.protocol!=='https:'||u.hostname!=='billing.stripe.com'||u.port||u.username||u.password)throw Error();}catch{fail(502,'The billing provider returned an invalid portal link.');}return{url:u.href};});}
  async function handlePublic(req,res,url) {
    if(url.pathname==='/api/premium/catalog'&&req.method==='GET'){json(res,200,await catalog());return true;}
    if(url.pathname!=='/api/billing/stripe/webhook')return false;
    if(req.method!=='POST')fail(405,'Method not allowed.');enabled();const raw=await bytes(req,256000);if(!verifyStripeSignature(raw,req.headers['stripe-signature'],config.webhookSecret))fail(400,'Invalid billing signature.');
    let event;try{event=JSON.parse(raw.toString());}catch{fail(400,'Invalid billing event.');}if(!validId(event?.id,'evt')||typeof event.type!=='string'||!event.data?.object)fail(400,'Invalid billing event.');
    const object=event.data.object,customer=idOf(object.customer),me=validId(customer,'cus')&&state.users.find(u=>u.premium?.billing.customerId===customer),supported=['checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed'];
    if(!me||!supported.includes(event.type)){json(res,200,{received:true,ignored:true});return true;}
    await locked(me.id,async()=>{
      if(state.premiumBilling.events.includes(event.id))return;
      const subscription=event.type.startsWith('customer.subscription.')?object.id:idOf(object.subscription)||idOf(object.parent?.subscription_details?.subscription);
      if(!validId(subscription,'sub'))return;
      // Read canonical provider state inside the account lock, so delayed/reordered
      // webhooks cannot restore a canceled subscription or extend an old period.
      await applySubscription(me,subscription,event.id);
    });json(res,200,{received:true});return true;
  }
  return{checkout,portal,cancelCheckout,sync,handlePublic,catalog,configuration};
}
