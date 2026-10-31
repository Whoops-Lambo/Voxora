import { stripeGateway, PLUS_PRICES } from '../billing.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export async function setupStripe(gateway=stripeGateway({secret:process.env.VOXORA_STRIPE_SECRET_KEY})) {
 let product;try{product=await gateway.request('/products/voxora_plus');}catch(e){if(e.status!==404)throw e;product=await gateway.request('/products',{id:'voxora_plus',name:'Voxora Plus','metadata[voxora_plan]':'plus'},{idempotencyKey:'voxora-plus-product-v1'});}
 if(product.id!=='voxora_plus'||product.metadata?.voxora_plan!=='plus'||product.deleted||product.active===false)throw Error('The voxora_plus product ID is unavailable or belongs to another product.');
 const result={};for(const p of PLUS_PRICES){const lookup='voxora_plus_'+p.interval+'_usd_'+p.amount+'_v1',found=await gateway.request('/prices?'+new URLSearchParams({'lookup_keys[]':lookup,active:'true',limit:'1'}));let price=found.data?.[0];
  if(!price)price=await gateway.request('/prices',{product:product.id,currency:'usd',unit_amount:String(p.amount),'recurring[interval]':p.interval,lookup_key:lookup,'metadata[voxora_plan]':'plus'},{idempotencyKey:lookup});
  if(price.product!==product.id||price.currency!=='usd'||price.unit_amount!==p.amount||price.recurring?.interval!==p.interval||price.active===false)throw Error('An existing Stripe lookup key has different pricing. No checkout configuration was changed.');
  result[p.interval==='month'?'VOXORA_STRIPE_MONTHLY_PRICE_ID':'VOXORA_STRIPE_YEARLY_PRICE_ID']=price.id;
 }return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--help'))console.log('Set VOXORA_STRIPE_SECRET_KEY privately, then run npm run billing:setup to create/reuse Voxora Plus at US$9.99/month and US$89.99/year. This creates catalog entries, never charges a customer.');
 else if(!/^(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+$/.test(process.env.VOXORA_STRIPE_SECRET_KEY||'')){console.error('Set VOXORA_STRIPE_SECRET_KEY in your backend environment first. Keep the key private.');process.exitCode=1;}
 else setupStripe().then(values=>{console.log('Stripe catalog is ready. Configure these non-secret price IDs on the backend:');for(const [key,value]of Object.entries(values))console.log(key+'='+value);console.log('Configure a signed Stripe webhook and customer portal before enabling purchases. See docs/PLUS.md.');}).catch(()=>{console.error('Stripe catalog setup failed. Check key permissions, network access and existing product/price configuration. No customer was charged.');process.exitCode=1;});
}
