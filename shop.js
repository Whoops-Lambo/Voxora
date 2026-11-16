import {isPlayBuild} from './public/payment-policy.js';
import {randomUUID} from 'node:crypto';
import {stripeGateway,verifyStripeSignature} from './billing.js';
import {isSuspended} from './platform.js';
import {safeRole} from './onboarding.js';
import {boostSummary} from './premium.js';
import {serverPermissions,roleRank} from './public/permissions.js';
export function shopConfig(env=process.env){
 let origin;try{const u=new URL(env.VOXORA_PUBLIC_URL);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error();origin=u.origin;}catch{}
 const secret=env.VOXORA_STRIPE_SECRET_KEY,webhookSecret=env.VOXORA_STRIPE_CONNECT_WEBHOOK_SECRET,mode=/^(?:sk|rk)_(test|live)_/.exec(secret||'')?.[1];
 return{ready:!!(origin&&mode&&webhookSecret),secret,webhookSecret,publicUrl:origin,mode,missing:[...(!secret?['VOXORA_STRIPE_SECRET_KEY']:[]),...(!webhookSecret?['VOXORA_STRIPE_CONNECT_WEBHOOK_SECRET']:[]),...(!origin?['VOXORA_PUBLIC_URL']:[])]};
}
const valid=(id,prefix)=>typeof id==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9_]{2,180}$').test(id);
export function shopService({state,body,bytes,json,fail,save,refresh,management,userById,config=shopConfig(),gateway=stripeGateway(config)}){
 state.shop||={products:[],orders:[],events:[],feeBasisPoints:750};const locks=new Map();
 const locked=async(key,fn)=>{const previous=locks.get(key)||Promise.resolve(),task=previous.catch(()=>{}).then(fn);locks.set(key,task);try{return await task;}finally{if(locks.get(key)===task)locks.delete(key);}};
 const live=me=>{if(!me||me.bot||isSuspended(me)||!state.users.includes(me))fail(403,'An active human account is required.');};
 const enabled=()=>{if(!config.ready)fail(503,'Stripe Connect and its signed webhook must be configured before purchases.');};
 async function call(path,fields,accountId,idempotencyKey){try{return await gateway.request(path,fields,{accountId,idempotencyKey});}catch{fail(502,'Stripe could not complete the request.');}}
 const seller=(s,me)=>{live(me);if(s.ownerId!==me.id)fail(403,'Only the server owner can manage payouts.');};
 const manager=(s,me)=>{live(me);if(!serverPermissions(s,me.id).includes('manageStore'))fail(403,'Manage Server Store is required.');};
 const member=(id,me)=>{const s=state.servers.find(s=>s.id===id&&s.members.includes(me.id));if(!s)fail(404,'Server not found.');live(me);return s;};
 const originURL=(value,hosts)=>{let u;try{u=new URL(value);}catch{fail(502,'Stripe returned an invalid redirect.');}if(u.protocol!=='https:'||!hosts.includes(u.hostname)||u.port||u.username||u.password)fail(502,'Stripe returned an invalid redirect.');return u.href;};
 const text=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail(400,'Product text is invalid or too long.');return value.trim();};
 const orderView=o=>({...o,product:{...o.product,instructions:o.status==='paid'?o.product.instructions:undefined},checkoutUrl:undefined});
 const available=p=>p.stock===null?null:Math.max(0,p.stock-state.shop.orders.filter(o=>o.productId===p.id&&o.status==='pending').reduce((sum,o)=>sum+o.quantity,0));
 async function onboard(s,me,d){
  seller(s,me);enabled();if(!/^[A-Z]{2}$/.test(d.country||''))fail(400,'Choose a two-letter seller country.');
  let accountId=s.storeAccount?.ownerId===me.id?s.storeAccount.id:null;
  if(!accountId){const a=await call('/accounts',{type:'express',country:d.country,'capabilities[card_payments][requested]':'true','capabilities[transfers][requested]':'true','metadata[voxora_server_id]':s.id,'metadata[voxora_owner_id]':me.id},null,'voxora-connect-'+s.id+'-'+me.id);if(!valid(a.id,'acct'))fail(502,'Stripe returned an invalid connected account.');seller(s,me);accountId=a.id;s.storeAccount={id:accountId,ownerId:me.id,country:d.country};await save();}
  const link=await call('/account_links',{account:accountId,type:'account_onboarding',refresh_url:config.publicUrl+'/app?shop=onboarding',return_url:config.publicUrl+'/app?shop=returned'});seller(s,me);return{url:originURL(link.url,['connect.stripe.com'])};
 }
 async function checkout(s,me,d){
  live(me);enabled();if(typeof d.nonce!=='string'||!/^[a-f0-9-]{36}$/i.test(d.nonce)||!Number.isSafeInteger(d.quantity)||d.quantity<1||d.quantity>10)fail(400,'Choose 1–10 items and a valid request identifier.');
  return locked('product:'+d.productId,async()=>{
   member(s.id,me);const duplicate=state.shop.orders.find(o=>o.userId===me.id&&o.nonce===d.nonce);
   if(duplicate){if(duplicate.productId!==d.productId||duplicate.quantity!==d.quantity)fail(409,'This request identifier was already used.');if(duplicate.status==='pending'&&duplicate.expiresAt>Date.now()&&duplicate.checkoutUrl)return{url:duplicate.checkoutUrl,reused:true};fail(409,'This checkout is completed, expired or needs review.');}
   const p=state.shop.products.find(p=>p.id===d.productId&&p.serverId===s.id&&p.active);if(!p||p.sellerId!==s.ownerId)fail(404,'Product unavailable.');
   if(!s.storeAccount||s.storeAccount.ownerId!==s.ownerId)fail(503,'The current server owner must finish payout onboarding.');
   if(p.type==='digital'&&p.roleId&&!safeRole(s,s.roles.find(r=>r.id===p.roleId)))fail(409,'This reward role is no longer eligible.');
   const stock=available(p);if(stock!==null&&stock<d.quantity)fail(409,'Not enough stock.');if(p.type==='digital'&&d.quantity!==1)fail(400,'Digital perks can be purchased one at a time.');
   const account=await call('/accounts/'+s.storeAccount.id);if(account.id!==s.storeAccount.id||!account.charges_enabled||!account.payouts_enabled||!account.details_submitted)fail(503,'The seller must finish Stripe verification.');
   member(s.id,me);if(p.sellerId!==s.ownerId||!p.active)fail(409,'Product or seller changed.');
   const subtotal=p.price*d.quantity,shipping=p.type==='physical'?p.shippingCents:0,fee=Math.round(subtotal*state.shop.feeBasisPoints/10000),o={id:randomUUID(),serverId:s.id,productId:p.id,sellerId:s.ownerId,userId:me.id,nonce:d.nonce,quantity:d.quantity,accountId:s.storeAccount.id,mode:config.mode,status:'pending',subtotal,shipping,total:subtotal+shipping,fee,feeBasisPoints:state.shop.feeBasisPoints,currency:'usd',product:structuredClone(p),createdAt:Date.now(),expiresAt:Date.now()+1800000};
   state.shop.orders.push(o);await save();
   const fields={mode:'payment',client_reference_id:o.id,'metadata[voxora_order_id]':o.id,'metadata[voxora_user_id]':me.id,'metadata[voxora_server_id]':s.id,'line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(p.price),'line_items[0][price_data][product_data][name]':p.name,'line_items[0][quantity]':String(d.quantity),'payment_intent_data[application_fee_amount]':String(fee),'payment_intent_data[metadata][voxora_order_id]':o.id,success_url:config.publicUrl+'/app?shop=paid',cancel_url:config.publicUrl+'/app?shop=cancelled',expires_at:String(Math.floor(o.expiresAt/1000))};
   if(p.type==='physical'){p.shippingCountries.forEach((c,i)=>fields['shipping_address_collection[allowed_countries]['+i+']']=c);Object.assign(fields,{'shipping_options[0][shipping_rate_data][type]':'fixed_amount','shipping_options[0][shipping_rate_data][fixed_amount][amount]':String(shipping),'shipping_options[0][shipping_rate_data][fixed_amount][currency]':'usd','shipping_options[0][shipping_rate_data][display_name]':'Seller shipping'});}
   let session;try{session=await call('/checkout/sessions',fields,o.accountId,'voxora-shop-'+o.id);}catch(e){o.status='failed';await save();throw e;}
   if(!valid(session.id,'cs')||session.mode!=='payment'||session.status!=='open')fail(502,'Stripe returned an invalid checkout session.');
   o.sessionId=session.id;o.checkoutUrl=originURL(session.url,['checkout.stripe.com']);await save();return{url:o.checkoutUrl,reused:false};
  });
 }
 async function paid(o){
  if(o.status!=='pending')return;
  const c=await call('/checkout/sessions/'+o.sessionId+'?expand[]=line_items',undefined,o.accountId),item=c.line_items?.data?.[0],p=o.product;
  if(c.id!==o.sessionId||c.mode!=='payment'||c.client_reference_id!==o.id||c.metadata?.voxora_order_id!==o.id||c.metadata?.voxora_user_id!==o.userId||c.metadata?.voxora_server_id!==o.serverId||c.currency!=='usd'||c.amount_total!==o.total||c.line_items?.data?.length!==1||item.quantity!==o.quantity||item.price?.unit_amount!==p.price||item.price?.currency!=='usd')fail(400,'Paid checkout does not match the frozen order.');
  if(c.status!=='complete'||c.payment_status!=='paid')return;
  const paymentId=typeof c.payment_intent==='string'?c.payment_intent:c.payment_intent?.id;if(!valid(paymentId,'pi'))fail(400,'Payment intent missing.');const intent=await call('/payment_intents/'+paymentId,undefined,o.accountId);if(intent.id!==paymentId||intent.livemode!==(config.mode==='live')||intent.status!=='succeeded'||intent.amount_received!==o.total||intent.currency!=='usd'||intent.application_fee_amount!==o.fee||intent.metadata?.voxora_order_id!==o.id)fail(400,'Payment intent or platform fee does not match the order.');
  o.status='paid';o.paidAt=Date.now();o.paymentIntentId=typeof c.payment_intent==='string'?c.payment_intent:c.payment_intent?.id;o.customerEmail=c.customer_details?.email||null;
  if(p.type==='physical'){o.shippingDetails=c.shipping_details||c.collected_information?.shipping_details||null;o.fulfillment='awaiting_shipment';}
  else{
   const s=state.servers.find(s=>s.id===o.serverId),user=userById(o.userId),r=s?.roles.find(r=>r.id===p.roleId);o.fulfillment='delivered';
   if(p.roleId){if(!s||!user||isSuspended(user)||!s.members.includes(user.id)||s.ownerId!==o.sellerId||!safeRole(s,r))o.fulfillment='seller_review_required';
    else{s.memberRoles[user.id]||=[];o.rolePreviouslyPresent=s.memberRoles[user.id].includes(r.id);if(!o.rolePreviouslyPresent){s.memberRoles[user.id].push(r.id);s.automaticRoleIds||={};s.automaticRoleIds[user.id]||=[];if(!s.automaticRoleIds[user.id].includes(r.id))s.automaticRoleIds[user.id].push(r.id);}s.memberRoleRevisions||={};s.memberRoleRevisions[user.id]=(s.memberRoleRevisions[user.id]||0)+1;o.roleRevision=s.memberRoleRevisions[user.id];management.log(s,{id:null,displayName:'Voxora Shop'},'Store role fulfilled',r.name);}}
  }
  const current=state.shop.products.find(p=>p.id===o.productId);if(current?.stock!==null&&current?.stock!==undefined)current.stock=Math.max(0,current.stock-o.quantity);
 }
 async function handlePublic(req,res,url){
  if(url.pathname!=='/api/shop/stripe/webhook')return false;if(req.method!=='POST')fail(405,'Method not allowed.');enabled();
  const raw=await bytes(req,256000);if(!verifyStripeSignature(raw,req.headers['stripe-signature'],config.webhookSecret))fail(400,'Invalid shop webhook signature.');
  let e;try{e=JSON.parse(raw.toString());}catch{fail(400,'Invalid shop webhook.');}
  if(!valid(e?.id,'evt')||!valid(e.account,'acct')||typeof e.livemode!=='boolean'||e.livemode!==(config.mode==='live'))fail(400,'Invalid shop webhook account or mode.');
  const object=e.data?.object,orderId=object?.metadata?.voxora_order_id,o=state.shop.orders.find(o=>o.id===orderId||o.sessionId===object?.id||o.paymentIntentId&&o.paymentIntentId===object?.payment_intent);
  if(!o||o.accountId!==e.account||o.mode!==config.mode){json(res,200,{received:true,ignored:true});return true;}
  await locked('order:'+o.id,async()=>{
   if(state.shop.events.includes(e.id)){await save();return;}
   if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(e.type))await paid(o);
   else if(e.type==='checkout.session.expired'&&o.status==='pending'){const c=await call('/checkout/sessions/'+o.sessionId,undefined,o.accountId);if(c.status==='expired')o.status='expired';}
   else if(e.type==='charge.refunded'&&valid(object?.id,'ch')){
    const charge=await call('/charges/'+object.id,undefined,o.accountId);
    if(charge.payment_intent===o.paymentIntentId&&charge.amount_refunded===o.total){o.status='refunded';o.refundedAt=Date.now();const s=state.servers.find(s=>s.id===o.serverId);if(o.product.roleId&&!o.rolePreviouslyPresent&&s?.memberRoleRevisions?.[o.userId]===o.roleRevision){s.memberRoles[o.userId]=(s.memberRoles[o.userId]||[]).filter(id=>id!==o.product.roleId);s.memberRoleRevisions[o.userId]++;}else if(o.product.roleId)o.fulfillment='refund_role_review_required';}
   }
   state.shop.events.push(e.id);state.shop.events=state.shop.events.slice(-5000);await save();refresh();
  });json(res,200,{received:true});return true;
 }
 async function handle(req,res,url,me){
  const m=url.pathname.match(/^\/api\/servers\/([\w-]+)\/shop(?:\/(products|onboard|checkout)(?:\/([\w-]+))?)?$/),orders=url.pathname.match(/^\/api\/shop\/orders(?:\/([\w-]+))?$/),settings=url.pathname==='/api/platform/shop-configuration';if(!m&&!orders&&!settings)return false;
  live(me);const d=['POST','PATCH'].includes(req.method)?await body(req):{};
  if(settings){if(state.platform.ownerId!==me.id)fail(403,'Only the platform owner can change shop fees.');if(req.method==='PATCH'){if(!Number.isInteger(d.feeBasisPoints)||d.feeBasisPoints<500||d.feeBasisPoints>1000)fail(400,'Choose a fee from 5% to 10%.');state.shop.feeBasisPoints=d.feeBasisPoints;await save();}else if(req.method!=='GET')fail(405,'Method not allowed.');json(res,200,{feeBasisPoints:state.shop.feeBasisPoints,ready:config.ready,missing:config.missing,webhookPath:'/api/shop/stripe/webhook'});return true;}
  if(orders){const own=state.shop.orders.filter(o=>o.userId===me.id||o.sellerId===me.id);
   if(req.method==='GET'){json(res,200,{items:own.filter(o=>!orders[1]||o.id===orders[1]).map(orderView)});return true;}
   const o=own.find(o=>o.id===orders[1]);if(!o||o.sellerId!==me.id)fail(403,'Only the original seller can fulfill this order.');
   if(req.method!=='PATCH'||o.product.type!=='physical'||o.status!=='paid'||!['processing','shipped','delivered'].includes(d.fulfillment))fail(400,'Choose a paid physical order and fulfillment state.');
   const tracking=d.tracking||'';if(typeof tracking!=='string'||tracking.length>300)fail(400,'Tracking must be up to 300 characters.');o.fulfillment=d.fulfillment;o.tracking=tracking;o.fulfilledAt=Date.now();await save();json(res,200,orderView(o));return true;
  }
  const s=member(m[1],me),kind=m[2],id=m[3];
  if(!kind&&req.method==='GET'){
   const products=state.shop.products.filter(p=>p.serverId===s.id&&p.active&&p.sellerId===s.ownerId),slots=boostSummary(state,s).featuredProducts,featured=new Set(products.filter(p=>p.featured).slice(0,slots).map(p=>p.id));
   json(res,200,{products:products.map(({instructions,...p})=>({...p,featured:featured.has(p.id),stock:available(p)})).sort((a,b)=>Number(b.featured)-Number(a.featured)),featuredLimit:slots,feeBasisPoints:state.shop.feeBasisPoints,checkoutAvailable:config.ready&&s.storeAccount?.ownerId===s.ownerId,canManage:serverPermissions(s,me.id).includes('manageStore'),canOnboard:s.ownerId===me.id});return true;
  }
  if(kind==='onboard'&&req.method==='POST'){json(res,200,await locked('seller:'+s.id,()=>onboard(s,me,d)));return true;}
  if(kind==='checkout'&&req.method==='POST'){if(isPlayBuild(req.headers?.['user-agent'])&&state.shop.products.some(p=>p.id===d.productId&&p.serverId===s.id&&p.type==='digital'))fail(403,'Digital checkout is unavailable in this Play app.');json(res,200,await checkout(s,me,d));return true;}
  if(kind!=='products')fail(405,'Method not allowed.');manager(s,me);
  if(req.method==='PATCH'){
   const p=state.shop.products.find(p=>p.id===id&&p.serverId===s.id&&p.active);if(!p)fail(404,'Product not found.');
   if(Object.keys(d).length!==1||typeof d.featured!=='boolean')fail(400,'Choose the featured state only.');
   if(d.featured&&(!boostSummary(state,s).featuredProducts||state.shop.products.filter(x=>x.serverId===s.id&&x.active&&x.featured&&x!==p).length>=boostSummary(state,s).featuredProducts))fail(403,'Storefront highlights require boost level 4 and an available featured slot.');
   p.featured=d.featured;management.log(s,me,'Storefront highlight changed',p.name);await management.commit(s);json(res,200,{ok:true});return true;
  }
  if(req.method==='DELETE'){const p=state.shop.products.find(p=>p.id===id&&p.serverId===s.id);if(!p)fail(404,'Product not found.');p.active=false;management.log(s,me,'Store product retired',p.name);await management.commit(s);json(res,200,{ok:true});return true;}
  if(req.method!=='POST'||id)fail(405,'Method not allowed.');if(state.shop.products.filter(p=>p.serverId===s.id&&p.active).length>=100)fail(400,'Use up to 100 active products.');
  const name=text(d.name,80),description=text(d.description,2000);if(!['digital','physical'].includes(d.type)||!Number.isSafeInteger(d.price)||d.price<50||d.price>1000000)fail(400,'Choose digital or physical and a price from $0.50 to $10,000 in cents.');
  if(d.roleId&&(!safeRole(s,s.roles.find(r=>r.id===d.roleId))||me.id!==s.ownerId&&s.roles.find(r=>r.id===d.roleId).position>=roleRank(s,me.id)||!s.roles.find(r=>r.id===d.roleId).permissions.every(p=>serverPermissions(s,me.id).includes(p))))fail(403,'Only safe optional roles can be sold.');
  const stock=d.stock??null;if(stock!==null&&(!Number.isSafeInteger(stock)||stock<0||stock>1000000))fail(400,'Choose valid stock or unlimited stock.');
  let shippingCountries=[],shippingCents=0;if(d.type==='physical'){if(!Array.isArray(d.shippingCountries)||!d.shippingCountries.length||d.shippingCountries.length>30||d.shippingCountries.some(c=>typeof c!=='string'||!/^[A-Z]{2}$/.test(c))||!Number.isSafeInteger(d.shippingCents)||d.shippingCents<0||d.shippingCents>100000)fail(400,'Choose shipping countries and a shipping price up to $1,000.');shippingCountries=[...new Set(d.shippingCountries)];shippingCents=d.shippingCents;}
  const p={id:randomUUID(),serverId:s.id,sellerId:s.ownerId,name,description,type:d.type,price:d.price,currency:'usd',roleId:d.type==='digital'?d.roleId||null:null,instructions:d.type==='digital'?text(d.instructions||'Your purchase is available in your order receipt.',2000):null,stock,shippingCountries,shippingCents,active:true,createdAt:Date.now()};state.shop.products.push(p);management.log(s,me,'Store product published',p.name);await management.commit(s);json(res,201,p);return true;
 }
 return {handle,handlePublic};
}
