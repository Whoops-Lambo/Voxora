import { renderUpdates } from '../public/updates-ui.js';
const form=document.getElementById('connect-form'),server=document.getElementById('server'),status=document.getElementById('status'),connect=document.getElementById('connect'),host=document.getElementById('private-host'),join=document.getElementById('join-public');
let publicServer='';
function busy(value){connect.disabled=value;host.disabled=value;server.disabled=value;join.disabled=value;connect.textContent=value?'Connecting…':'Connect';}
busy(true);
window.voxoraDesktop.getConnectionInfo().then(info=>{publicServer=info.publicServer||'';server.value=info.server||'';status.textContent=info.message||'';document.getElementById('public-service').hidden=!publicServer;document.getElementById('public-address').textContent=publicServer;document.getElementById('existing').hidden=!info.hasLocalData;if(info.server&&info.server!==publicServer)document.querySelector('details').open=true;busy(!!info.connecting);}).catch(error=>{status.textContent=error.message;busy(false);});
async function connectTo(address){busy(true);status.textContent=address===publicServer?'Connecting to Public Voxora… This can take a moment while the service wakes up.':'Connecting to your shared server…';try{await window.voxoraDesktop.connect(address);}catch(error){status.textContent=error.message;busy(false);}}
form.onsubmit=event=>{event.preventDefault();connectTo(server.value);};
join.onclick=()=>connectTo(publicServer);
host.onclick=async()=>{busy(true);status.textContent='';try{const result=await window.voxoraDesktop.hostPrivateWorkspace();if(result.cancelled)busy(false);}catch(error){status.textContent=error.message;busy(false);}};

const node=(tag,cls='',text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const button=(label,fn,cls='secondary')=>{const e=node('button',cls,label);e.type='button';e.onclick=fn;return e;};
const field=(label,control)=>{const e=node('label','update-field',label);e.append(control);return e;};
if(window.voxoraDesktop.getUpdateState)renderUpdates({content:document.getElementById('setup-updates'),node,button,field,toast:message=>status.textContent=message});
