const root=document.documentElement;
document.querySelector('meta[name="viewport"]')?.setAttribute('content','width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover,interactive-widget=resizes-content');
const touch=()=>navigator.maxTouchPoints>0||matchMedia('(pointer:coarse)').matches;
let frame=0,baseline=innerHeight,width=innerWidth;
function update(){frame=0;root.toggleAttribute('data-touch',touch());const viewport=window.visualViewport;if(Math.abs((viewport?.scale||1)-1)>.03)return;const height=viewport?.height||innerHeight;if(Math.abs(innerWidth-width)>80){baseline=innerHeight;width=innerWidth;}baseline=Math.max(baseline,innerHeight);root.style.setProperty('--app-height',Math.round(height)+'px');root.style.setProperty('--app-top',Math.round(viewport?.offsetTop||0)+'px');const focus=document.activeElement,typing=focus?.matches('textarea,input:not([type=checkbox]):not([type=radio]):not([type=range])'),keyboard=touch()&&typing&&baseline-height>140;root.toggleAttribute('data-keyboard-open',!!keyboard);root.toggleAttribute('data-composer-keyboard',!!keyboard&&!!focus?.matches('#message-input,.thread-composer textarea'));}
function schedule(){if(!frame)frame=requestAnimationFrame(update);}
for(const event of ['resize','orientationchange'])window.addEventListener(event,schedule);for(const event of ['resize','scroll'])window.visualViewport?.addEventListener(event,schedule);for(const event of ['focusin','focusout'])document.addEventListener(event,schedule);
for(const event of ['gesturestart','gesturechange','gestureend'])document.addEventListener(event,e=>{if(touch()&&e.cancelable)e.preventDefault();},{passive:false});
document.addEventListener('touchmove',e=>{if(e.touches.length>1&&e.cancelable)e.preventDefault();},{passive:false});
update();

const scrim=document.createElement('button');scrim.type='button';scrim.className='mobile-sidebar-scrim';scrim.setAttribute('aria-label','Close Channels');scrim.onclick=()=>document.body.classList.remove('sidebar-open');document.body.append(scrim);
