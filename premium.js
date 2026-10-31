import { randomUUID } from 'node:crypto';
import { isSuspended } from './platform.js';

export function initializePremiumUser(user) {
  user.premium ||= { version:0, grant:null, billing:{customerId:null,subscriptionId:null,status:'none',currentPeriodEnd:0,cancelAtPeriodEnd:false,eligible:false}, profile:{bannerStart:'#5865f2',bannerEnd:'#eb459e',accent:'#b197fc',showBadge:true}, boosts:[{slot:1,serverId:null,assignedAt:0},{slot:2,serverId:null,assignedAt:0}] };
}
export function initializePremium(state,{billingMode=null}={}) { for(const u of state.users){initializePremiumUser(u);const p=u.premium;if(billingMode&&p.billing.mode&&p.billing.mode!==billingMode){p.billingArchive||={};p.billingArchive[p.billing.mode]=p.billing;p.billing=p.billingArchive[billingMode]||{customerId:null,subscriptionId:null,status:'none',currentPeriodEnd:0,cancelAtPeriodEnd:false,eligible:false};delete p.billingArchive[billingMode];p.version++;}if(billingMode)p.billing.mode=billingMode;}state.premiumBilling ||= {events:[]}; }
export function activePremium(user,now=Date.now()) {
  if(!user||user.bot||isSuspended(user))return false;const p=user.premium;
  return !!(p&&(p.grant&&(p.grant.expiresAt===null||p.grant.expiresAt>now)||p.billing.eligible&&['active','trialing'].includes(p.billing.status)&&p.billing.currentPeriodEnd>now));
}
export function premiumPerks(user) { const plus=activePremium(user);return {messageCharacters:plus?4000:2000,uploadBytes:(plus?25:8)*1024*1024,bioCharacters:plus||user?.bot?500:190,boostSlots:plus?2:0}; }
export function publicPremium(user) { return activePremium(user)?{badge:user.premium.profile.showBadge,profile:{bannerStart:user.premium.profile.bannerStart,bannerEnd:user.premium.profile.bannerEnd,accent:user.premium.profile.accent}}:{badge:false,profile:null}; }
export function boostSummary(state,server) {
  const boosts=state.users.filter(u=>activePremium(u)&&server.members.includes(u.id)).flatMap(u=>u.premium.boosts.filter(b=>b.serverId===server.id));
  return {count:boosts.length,level:boosts.length>=2?1:0,emojiSlots:boosts.length>=2?100:50};
}
export function premiumService({state,body,json,fail,save,refresh,userById,platform,billing}) {
  function self(me) {
    initializePremiumUser(me);const p=me.premium,active=activePremium(me);
    return {plan:active?'plus':'free',active,version:p.version,perks:premiumPerks(me),grant:p.grant?{expiresAt:p.grant.expiresAt}:null,billing:{status:p.billing.status,currentPeriodEnd:p.billing.currentPeriodEnd||null,cancelAtPeriodEnd:p.billing.cancelAtPeriodEnd,hasCustomer:!!p.billing.customerId,hasSubscription:!!p.billing.subscriptionId&&!['none','canceled','incomplete_expired'].includes(p.billing.status),pendingCheckout:p.billing.pendingCheckout?{interval:p.billing.pendingCheckout.interval,expiresAt:p.billing.pendingCheckout.expiresAt,expired:p.billing.pendingCheckout.expiresAt<=Date.now()}:null},profile:{...p.profile},boosts:p.boosts.map(b=>{const s=state.servers.find(s=>s.id===b.serverId&&s.members.includes(me.id));return{slot:b.slot,serverId:s?.id||null,serverName:s?.name||null,active:active&&!!s,assignedAt:b.assignedAt,transferAvailableAt:b.assignedAt?b.assignedAt+86400000:null};})};
  }
  const owner=me=>{if(me.bot||isSuspended(me)||state.platform.ownerId!==me.id)fail(403,'Only the platform owner can manage Plus grants.');};
  function version(d,p){if(!Number.isSafeInteger(d.version)||d.version!==p.version)fail(409,'Plus settings changed. Refresh and try again.');}
  function reason(d){if(typeof d.reason!=='string'||!d.reason.trim()||d.reason.length>500)fail(400,'Give a reason of up to 500 characters.');return d.reason.trim();}
  async function handle(req,res,url,me) {
    const own=url.pathname.match(/^\/api\/premium\/(me|profile|boosts|checkout|portal|sync)(?:\/(\d|cancel))?$/),admin=url.pathname.match(/^\/api\/platform\/premium\/(members|configuration)(?:\/([\w-]+))?$/);if(!own&&!admin)return false;
    const d=['POST','PATCH'].includes(req.method)?await body(req):{},method=req.method;
    if(me.bot||isSuspended(me))fail(403,'Plus requires an active human account.');initializePremiumUser(me);
    if(admin){owner(me);const [,kind,id]=admin;
      if(kind==='configuration'&&method==='GET'){json(res,200,await billing.configuration());return true;}
      if(kind==='members'&&!id&&method==='GET'){const q=(url.searchParams.get('q')||'').toLowerCase().slice(0,100),offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)fail(400,'Invalid page.');const users=state.users.filter(u=>!u.bot&&(u.username+' '+u.displayName).toLowerCase().includes(q));json(res,200,{items:users.slice(offset,offset+25).map(u=>({id:u.id,username:u.username,displayName:u.displayName,...self(u),grantReason:u.premium.grant?.reason||null})),total:users.length,hasMore:offset+25<users.length});return true;}
      if(kind!=='members'||!id||method!=='PATCH')fail(405,'Method not allowed.');
      const u=userById(id);if(!u||u.bot)fail(404,'Human account not found.');initializePremiumUser(u);version(d,u.premium);const why=reason(d);
      if(d.revoke===true)u.premium.grant=null;
      else{if(![1,7,30,90,365,null].includes(d.days))fail(400,'Choose 1, 7, 30, 90, 365 days or ongoing access.');u.premium.grant={id:randomUUID(),grantedBy:me.id,grantedAt:Date.now(),expiresAt:d.days===null?null:Date.now()+d.days*86400000,reason:why};}
      u.premium.version++;platform.log(me,d.revoke?'Plus grant revoked':'Plus access granted',u.username,why);await save();refresh();json(res,200,self(u));return true;
    }
    const [,kind,id]=own,p=me.premium;
    if(kind==='me'&&method==='GET'){json(res,200,self(me));return true;}
    if(kind==='checkout'&&method==='POST'){json(res,200,id==='cancel'?await billing.cancelCheckout(me):await billing.checkout(me,d.interval));return true;}
    if(kind==='portal'&&method==='POST'){json(res,200,await billing.portal(me));return true;}
    if(kind==='sync'&&method==='POST'){json(res,200,await billing.sync(me));return true;}
    if(kind==='profile'&&method==='PATCH'){
      version(d,p);if(!activePremium(me))fail(403,'Voxora Plus is required for premium profile styles.');
      if(Object.keys(d).some(k=>!['version','bannerStart','bannerEnd','accent','showBadge'].includes(k)))fail(400,'Unknown profile style.');
      const next={...p.profile};for(const key of ['bannerStart','bannerEnd','accent'])if(d[key]!==undefined){if(!/^#[a-f0-9]{6}$/i.test(d[key]))fail(400,'Choose a valid profile color.');next[key]=d[key];}if(d.showBadge!==undefined){if(typeof d.showBadge!=='boolean')fail(400,'Choose whether to display the Plus badge.');next.showBadge=d.showBadge;}
      p.profile=next;p.version++;await save();refresh();json(res,200,self(me));return true;
    }
    if(kind==='boosts'&&id&&method==='PATCH'){
      version(d,p);const boost=p.boosts.find(b=>b.slot===Number(id));if(!boost)fail(404,'Boost slot not found.');
      if(d.serverId!==null&&(!activePremium(me)||!state.servers.some(s=>s.id===d.serverId&&s.members.includes(me.id))))fail(403,'Choose a server you belong to with active Plus access.');
      if(d.serverId!==null&&d.serverId!==(boost.lastServerId||boost.serverId)&&boost.assignedAt&&Date.now()-boost.assignedAt<86400000)fail(429,'A boost slot can move to another server once every 24 hours.');
      if(d.serverId!==null&&d.serverId!==(boost.lastServerId||boost.serverId)){boost.assignedAt=Date.now();boost.lastServerId=d.serverId;}
      boost.serverId=d.serverId;p.version++;await save();refresh();json(res,200,self(me));return true;
    }
    fail(405,'Method not allowed.');
  }
  let previous=new Map(state.users.map(u=>[u.id,activePremium(u)]));
  const timer=setInterval(()=>{let changed=false;for(const u of state.users){const active=activePremium(u);if(previous.has(u.id)&&previous.get(u.id)!==active)changed=true;previous.set(u.id,active);}for(const id of previous.keys())if(!state.users.some(u=>u.id===id))previous.delete(id);if(changed)refresh();},15000);timer.unref();
  return {handle,self,close:()=>clearInterval(timer)};
}
