import {isPlayBuild} from './payment-policy.js';
export function createShopUI({node,button,input,field,formDialog,api,getState,refreshState,toast,modal}){
 const safe=fn=>async()=>{try{await fn();}catch(e){toast(e.message,true);}};
 const money=c=>'$'+(c/100).toFixed(2)+' USD';
 function redirect(container,data){const a=node('a','primary','Continue securely at Stripe');a.href=data.url;a.target='_blank';a.rel='noopener noreferrer';container.append(a);}
 async function orders(container){
  const data=await api('/shop/orders');container.replaceChildren(node('h2','','Your Store Orders'));
  for(const o of data.items){const card=node('article','plus-card',[node('strong','',o.product.name),node('p','',o.status+' · '+money(o.total)+' · '+(o.fulfillment||'Awaiting payment')),node('small','muted','Order '+o.id)]);
   if(o.status==='paid'&&o.product.instructions)card.append(node('p','',o.product.instructions));
   if(o.shippingDetails)card.append(node('pre','',JSON.stringify(o.shippingDetails,null,2)));
   if(o.tracking)card.append(node('p','','Tracking: '+o.tracking));
   if(o.sellerId===getState().me.id&&o.product.type==='physical'&&o.status==='paid'){
    const status=node('select');for(const value of ['processing','shipped','delivered'])status.append(new Option(value,value));status.value=o.fulfillment==='awaiting_shipment'?'processing':o.fulfillment;const tracking=input(o.tracking||'','Tracking number or delivery reference');
    card.append(field('FULFILLMENT',status),field('TRACKING',tracking),button('Update Fulfillment',safe(async()=>{await api('/shop/orders/'+o.id,'PATCH',{fulfillment:status.value,tracking:tracking.value});await orders(container);}),'primary'));
   }container.append(card);
  }if(!data.items.length)container.append(node('p','','No purchases or sales yet.'));
 }
 function newProduct(s,after){
  const name=input('','Product name'),description=node('textarea'),type=node('select'),price=input('5.00','','number'),stock=input('','Unlimited'),role=node('select'),instructions=node('textarea'),countries=input('US','US,CA,...'),shipping=input('0.00','','number');
  for(const value of ['digital','physical'])type.append(new Option(value==='digital'?'Digital role or perk':'Physical product',value));role.append(new Option('No automatic role reward',''),...s.roles.filter(r=>r.id!=='everyone'&&!r.managedBoost).map(r=>new Option(r.name,r.id)));price.min=.5;price.step=.01;shipping.min=0;shipping.step=.01;description.maxLength=2000;instructions.maxLength=2000;
  formDialog({title:'Publish Store Product',description:'Prices are in USD. Digital delivery instructions are visible after payment. Physical products are shipped by the seller to the selected countries.',fields:[field('PRODUCT NAME',name),field('DESCRIPTION',description),field('TYPE',type),field('PRICE (USD)',price),field('STOCK (BLANK = UNLIMITED)',stock),field('DIGITAL REWARD ROLE',role),field('PAID DIGITAL DELIVERY INSTRUCTIONS',instructions),field('PHYSICAL SHIPPING COUNTRIES',countries),field('PHYSICAL SHIPPING PRICE (USD)',shipping)],submitLabel:'Publish Product',submit:async()=>{await api('/servers/'+s.id+'/shop/products','POST',{name:name.value,description:description.value,type:type.value,price:Math.round(Number(price.value)*100),stock:stock.value===''?null:Number(stock.value),roleId:role.value||null,instructions:instructions.value||undefined,shippingCountries:countries.value.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean),shippingCents:Math.round(Number(shipping.value)*100)});await after();}});
 }
 async function store(s,container){
  const load=async()=>{
   const data=await api('/servers/'+s.id+'/shop');if(!container.isConnected)return;container.replaceChildren(node('h2','',s.name+' Store'),node('p','muted','Purchases pay the server owner through Stripe Connect. Voxora receives '+(data.feeBasisPoints/100).toFixed(2)+'% of the item subtotal; shipping is excluded from the platform fee. Stripe processing fees are separate.'));
   if(!data.checkoutAvailable)container.append(node('p','','Purchases are unavailable until platform billing and the seller’s Stripe verification are configured.'));
   if(data.canOnboard){container.append(button('Set Up Seller Payouts',()=>{const country=input('US','Two-letter country code');formDialog({title:'Stripe Seller Onboarding',description:'Stripe will collect the seller’s identity and payout information. Do not enter bank details into Voxora.',fields:[field('SELLER COUNTRY',country)],submitLabel:'Continue at Stripe',submit:async()=>{const result=await api('/servers/'+s.id+'/shop/onboard','POST',{country:country.value.toUpperCase()});modal([node('h2','','Complete Stripe Onboarding')]);redirect(document.getElementById('modal-content'),result);}});},'primary'));}
   if(data.canManage)container.append(button('Publish Product',()=>newProduct(s,load),'primary'));
   container.append(button('Your Purchases & Sales',()=>orders(container),'secondary'));
   for(const p of data.products){const card=node('article','plus-card',[node('h3','',(p.featured?'★ ':'')+p.name),node('p','',p.description),node('strong','',money(p.price)),node('p','muted',p.type==='physical'?'Physical product · '+money(p.shippingCents)+' shipping · '+p.shippingCountries.join(', '):'Digital role or perk'),node('p','muted',p.stock===null?'Available':p.stock+' available')]);
    const buy=button('Buy Securely',()=>{const quantity=input('1','','number');quantity.min=1;quantity.max=p.type==='digital'?1:10;const nonce=crypto.randomUUID();formDialog({title:'Buy '+p.name,description:money(p.price)+' per item'+(p.type==='physical'?' plus '+money(p.shippingCents)+' shipping. The seller handles shipping and fulfillment.':'. This is a digital product.'),fields:[field('QUANTITY',quantity)],submitLabel:'Continue to Checkout',submit:async()=>{const result=await api('/servers/'+s.id+'/shop/checkout','POST',{productId:p.id,quantity:Number(quantity.value),nonce});modal([node('h2','','Stripe Checkout')]);redirect(document.getElementById('modal-content'),result);}});},'primary');buy.disabled=!data.checkoutAvailable||p.stock===0||p.type==='digital'&&isPlayBuild();card.append(buy);if(p.type==='digital'&&isPlayBuild())card.append(node('p','muted','Digital purchases are unavailable in this Play app.'));
    if(data.canManage&&data.featuredLimit)card.append(button(p.featured?'Remove Highlight':'Feature Product',safe(async()=>{await api('/servers/'+s.id+'/shop/products/'+p.id,'PATCH',{featured:!p.featured});await load();}),'secondary'));
    if(data.canManage)card.append(button('Retire Product',safe(async()=>{await api('/servers/'+s.id+'/shop/products/'+p.id,'DELETE');await load();}),'secondary'));container.append(card);
   }if(!data.products.length)container.append(node('p','','No products have been published.'));
  };await load();
 }
 return {store,orders};
}
