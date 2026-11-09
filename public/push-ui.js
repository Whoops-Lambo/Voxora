export function createPushUI({node,button,input,api,getState,toast,onOpen}){
  let account=null,registration=null,subscription=null,status={enabled:false},capability=null,view=null;
  const nativeIOS=()=>window.Capacitor?.getPlatform?.()==='ios'||!!window.webkit?.messageHandlers?.bridge;
  const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
  const standalone=()=>navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
  const supported=()=>isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window&&!nativeIOS();
  const dataKey=key=>Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  async function worker(){registration||=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('The notification service is not ready. Reload Voxora and try again.')),15000))]);return registration;}
  async function bind(userId){const r=await worker(),target=r.active;if(userId!==null&&getState()?.me.id!==userId||userId===null&&getState()?.me)return;if(!target)throw Error('Reload Voxora to activate notifications.');await new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>reject(Error('Device notification storage is unavailable.')),5000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data?.ok?resolve():reject(Error('Device notification storage is unavailable.'));};target.postMessage({type:'voxora-push-bind',userId},[channel.port2]);});}
  function paint(){if(!view?.isConnected)return;view.replaceChildren(node('h3','','BACKGROUND NOTIFICATIONS'));
    if(nativeIOS()||ios()&&!standalone()){
      view.append(node('p','management-help',nativeIOS()?'A native IPA signed with a free Apple ID cannot receive reliable alerts while closed. Use the Home Screen web app for free background notifications.':'On iPhone, add Voxora to your Home Screen first. Open that icon, sign in and enable background notifications here.'));
      const link=node('a','secondary','iPhone notification setup');link.href='/install#iphone-notifications';link.target='_blank';link.rel='noopener';view.append(link,button('Copy Voxora Web App Link',async()=>{const url=location.origin+'/app';try{await navigator.clipboard.writeText(url);toast('Web app link copied. Open it in Safari.');}catch{toast('Open '+url+' in Safari.');}},'secondary'));return;
    }
    if(!supported()){view.append(node('p','management-help','This browser does not support background push notifications. iPhone needs iOS 16.4+ and a Home Screen installation.'));return;}
    if(capability?.enabled===false){view.append(node('p','management-help','Background notifications are unavailable on this backend. Deploy the latest Voxora server and check its notification configuration.'));return;}
    view.append(node('p','management-help','Receive direct-message and mention alerts even when this web app is closed. Mutes, Do Not Disturb, blocks and conversation permissions still apply. Your device’s notification and Focus settings control sounds.'));
    view.append(node('p','push-status',status.enabled?'Background notifications enabled for this account on this device.':'Background notifications are off on this device.'));
    if(status.lastError)view.append(node('p','form-error',status.lastError));
    if(!status.enabled)view.append(button('Enable Background Notifications',enable,'primary'));
    else{
      const previews=input('','','checkbox');previews.checked=!!status.previews;previews.setAttribute('aria-label','Background message previews');previews.onchange=async()=>{try{status=await api('/push/subscriptions','POST',{subscription:subscription.toJSON(),previews:previews.checked});paint();}catch(error){toast(error.message,true);}};
      view.append(node('label','permission-row',[node('span','','Show sender and message previews in background alerts'),previews]),button('Send Test Notification',async()=>{await api('/push/test','POST',{subscriptionId:status.id});toast('Test alert sent. Check your device notifications and Focus settings.');},'secondary'),button('Disable Background Notifications',disable,'secondary'));
    }
  }
  async function enable(){
    // Safari requires this call directly inside a user gesture, before any network awaits.
    const current=getState()?.me.id;const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Allow notifications in your browser or iPhone settings, then try again.');
    if(getState()?.me.id!==current)throw Error('Your account changed. Enable notifications again.');const configuration=await api('/push/key');if(!configuration.enabled)throw Error('The server has not enabled background notifications.');capability=configuration;
    const r=await worker();subscription=await r.pushManager.getSubscription();if(subscription?.options?.applicationServerKey&&!Array.from(new Uint8Array(subscription.options.applicationServerKey)).every((value,i)=>value===dataKey(configuration.publicKey)[i])){await subscription.unsubscribe();subscription=null;}
    subscription||=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:dataKey(configuration.publicKey)});
    if(getState()?.me.id!==current){await subscription.unsubscribe();throw Error('Your account changed. Enable notifications again.');}
    status=await api('/push/subscriptions','POST',{subscription:subscription.toJSON(),previews:false});
    try{await bind(current);}catch(error){await api('/push/subscriptions/'+status.id,'DELETE');await subscription.unsubscribe();status={enabled:false};throw error;}
    paint();toast('Background notifications enabled.');
  }
  async function disable(){if(status.id)await api('/push/subscriptions/'+status.id,'DELETE');await subscription?.unsubscribe();subscription=null;status={enabled:false};await bind(null);paint();toast('Background notifications disabled on this device.');}
  async function openPending(){const params=new URLSearchParams(location.search);if(!params.has('push'))return;const recipient=params.get('recipient');if(recipient!==getState()?.me.id){toast('Sign in to the account that received this notification.');return;}const message={id:params.get('push'),channel:params.get('channel'),threadId:params.get('thread')||null};history.replaceState(null,'',location.pathname);await onOpen(message);}
  async function apply(){
    const current=getState()?.me.id;if(!current||current===account)return;account=current;status={enabled:false};capability=null;
    openPending().catch(error=>toast(error.message,true));
    if(!supported())return;
    try{const config=await api('/push/key');if(getState()?.me.id!==current)return;capability=config;if(!config.enabled){paint();return;}
      subscription=await(await worker()).pushManager.getSubscription();if(!subscription){paint();return;}const next=await api('/push/status','POST',{endpoint:subscription.endpoint});if(getState()?.me.id!==current)return;status=next;
      if(status.enabled)await bind(current);else{await subscription.unsubscribe();subscription=null;await bind(null);}paint();
    }catch{if(getState()?.me.id===current)paint();}
  }
  function reset(){account=null;status={enabled:false};capability=null;if(supported())(async()=>{try{await subscription?.unsubscribe();subscription=null;await bind(null);}catch{}})();}
  navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type!=='voxora-notification-open')return;const payload=event.data.payload;if(payload.recipientId!==getState()?.me.id){toast('Sign in to the account that received this notification.');return;}onOpen(payload).catch(error=>toast(error.message,true));});
  return {apply,reset,render:content=>{view=node('section','background-push-settings');content.append(view);paint();},enabled:()=>status.enabled};
}
