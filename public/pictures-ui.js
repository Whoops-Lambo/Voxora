export function verificationBadge(server){
 if(!server?.verification?.verified)return null;const badge=document.createElement('span');badge.className='verified-server-badge';badge.textContent='✓';badge.setAttribute('role','img');badge.setAttribute('aria-label','Verified server');badge.title='Voxora verified server · a staff verification decision, not a guarantee of member conduct';return badge;
}
export function applyPicture(element,url){
 if(!url)return element;const image=document.createElement('img');image.src=url;image.alt='';image.className='identity-picture';image.decoding='async';image.loading='lazy';
 element.classList.add('has-picture');image.onerror=()=>{image.remove();element.classList.remove('has-picture');};element.append(image);return element;
}
export function serverMark(server,className='community-letter'){
 const element=document.createElement('span');element.className=className+' server-picture';element.style.background=server.color||'#21465a';const initial=document.createElement('span');initial.className='picture-initial';initial.textContent=server.name?.slice(0,2).toUpperCase()||'V';element.append(initial);return applyPicture(element,server.iconUrl);
}
export function serverBanner(server,className='community-banner'){
 const element=document.createElement('span');element.className=className; if(server.bannerUrl){const image=document.createElement('img');image.src=server.bannerUrl;image.alt='';image.decoding='async';image.onerror=()=>element.remove();element.append(image);}return element;
}
export function createPictureUI({node,button,input,getState,refreshState,toast,onAvatarChange}){
 const widgets=new Set();const who=()=>getState()?.me?.id;
 function entity(widget){return widget.kind==='avatar'?getState()?.me:getState()?.servers.find(s=>s.id===widget.serverId);}
 function permitted(widget){const target=entity(widget);return !!(target&&who()===widget.account&&(widget.kind==='avatar'||target.permissions?.includes('manageServer')));}
 function discard(widget){widget.bitmap?.close();widget.bitmap=null;widget.crop.hidden=true;widget.file.value='';}
 function cleanup(){for(const w of widgets)if(!w.root.isConnected){discard(w);widgets.delete(w);}}
 const observer=new MutationObserver(cleanup);observer.observe(document.getElementById('modal-content'),{childList:true,subtree:true});
 function refresh(){cleanup();for(const w of widgets){if(!permitted(w)){discard(w);w.root.replaceChildren(node('p','muted','You no longer have permission to change this picture.'));continue;}paint(w);}}
 function paint(w){const target=entity(w);if(!target)return;const key=JSON.stringify([target[w.kind+'Url'],target.color,target.displayName,target.name]);if(key===w.previewKey)return;w.previewKey=key;w.preview.replaceChildren();const display=w.kind==='avatar'?applyPicture(node('span','picture-control-mark avatar',[node('span','avatar-initial',target.displayName?.slice(0,1).toUpperCase()||'V')]),target.avatarUrl):w.kind==='icon'?serverMark(target,'picture-control-mark'):serverBanner({...target,bannerUrl:target[w.kind+'Url']},'picture-control-banner');w.preview.append(display);w.upload.textContent=(target[w.kind+'Url']?'Change ':'Upload ')+w.label;w.remove.hidden=!target[w.kind+'Url'];}
 function draw(w){if(!w.bitmap)return;const {width,height}=w.bitmap,canvas=w.canvas,context=canvas.getContext('2d'),scale=Math.max(canvas.width/width,canvas.height/height)*Number(w.zoom.value),cropWidth=canvas.width/scale,cropHeight=canvas.height/scale,sx=(width-cropWidth)*(Number(w.x.value)/100),sy=(height-cropHeight)*(Number(w.y.value)/100);context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(w.bitmap,sx,sy,cropWidth,cropHeight,0,0,canvas.width,canvas.height);}
 function control({kind,serverId}){
  const label=kind==='avatar'?'Avatar':kind==='icon'?'Server Icon':kind==='inviteBanner'?'Invite Banner':'Server Banner',root=node('section','picture-control '+((kind==='banner'||kind==='inviteBanner')?'picture-control-wide':'')),preview=node('div','picture-current-preview'),file=input('','','file');file.accept='image/png,image/jpeg,image/webp,image/gif';file.hidden=true;file.setAttribute('aria-label','Choose '+label+' file');
  const upload=button('Upload '+label,()=>file.click(),'secondary'),remove=button('Remove '+label,async()=>{
   if(!permitted(w))throw Error('Your picture permissions changed.');const target=entity(w);remove.disabled=true;w.error.textContent='';
   try{await request(w,'DELETE',null,target[kind+'Version']||0);if(w.account!==who()||!root.isConnected)return;await refreshState();paint(w);onAvatarChange?.();toast(label+' removed.');}catch(e){w.error.textContent=e.message;}finally{remove.disabled=false;}
  },'text-button danger'),crop=node('div','picture-crop'),canvas=node('canvas','picture-crop-canvas');canvas.width=(kind==='banner'||kind==='inviteBanner')?960:512;canvas.height=(kind==='banner'||kind==='inviteBanner')?540:512;canvas.setAttribute('aria-label',label+' crop preview');
  const zoom=input(1,'','range'),x=input(50,'','range'),y=input(50,'','range');zoom.min=1;zoom.max=3;zoom.step=.05;for(const control of[x,y]){control.min=0;control.max=100;control.step=1;}
  const error=node('p','form-error picture-error');error.setAttribute('role','alert');
  const w={kind,serverId,label,root,preview,file,upload,remove,crop,canvas,zoom,x,y,error,account:who(),bitmap:null,source:0};widgets.add(w);
  const field=(label,control)=>node('label','picture-range',[document.createTextNode(label),control]);
  for(const [label,control]of[['Zoom',zoom],['Horizontal position',x],['Vertical position',y]]){control.setAttribute('aria-label',label+' for '+w.label);control.oninput=()=>draw(w);}
  const save=button('Save '+label,async()=>{
   if(!w.bitmap||!permitted(w))return;save.disabled=true;error.textContent='';
   try{const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Could not prepare this picture. Choose another file.');await request(w,'POST',blob,w.version);if(w.account!==who()||!root.isConnected)return;await refreshState();discard(w);paint(w);onAvatarChange?.();toast(label+' updated.');}
   catch(e){error.textContent=e.status===409?'This picture changed on another device. Cancel and choose it again.':e.message;}
   finally{save.disabled=false;}
  },'primary');
  crop.hidden=true;crop.append(node('h3','','Adjust '+label),canvas,field('Zoom',zoom),field('Horizontal position',x),field('Vertical position',y),node('div','picture-actions',[save,button('Cancel Picture Change',()=>discard(w),'secondary')]));
  file.onchange=async()=>{
   const selected=file.files?.[0],request=++w.source;if(!selected)return;
   error.textContent='';if(selected.size>10*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(selected.type)){error.textContent='Choose a PNG, JPEG, WebP or GIF image up to 10 MB.';file.value='';return;}
   try{const bitmap=await createImageBitmap(selected);if(request!==w.source||!root.isConnected||!permitted(w)){bitmap.close();return;}if(bitmap.width>16384||bitmap.height>16384||bitmap.width*bitmap.height>40000000){bitmap.close();throw Error('Choose a photo up to 40 megapixels.');}discard(w);w.bitmap=bitmap;w.version=entity(w)[kind+'Version']||0;zoom.value=1;x.value=50;y.value=50;crop.hidden=false;draw(w);}
   catch(e){error.textContent=e.message||'Could not read this image.';}
  };
  root.append(node('h3','',kind==='avatar'?'PROFILE PICTURE':label.toUpperCase()),preview,node('div','picture-actions',[upload,remove]),node('p','picture-hint','PNG, JPEG, WebP or GIF · up to 10 MB. Crop and save a static picture.'),file,crop,error);paint(w);return root;
 }
 async function request(w,method,body,version){
  const target=entity(w),path=w.kind==='avatar'?'/api/profile/avatar':'/api/servers/'+target.id+'/'+(w.kind==='inviteBanner'?'invite-banner':w.kind);
  const response=await fetch(path+'?version='+version,{method,headers:body?{'Content-Type':'image/png'}:undefined,body});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Could not save this picture.'),{status:response.status});return data;
 }
 function reset(){for(const w of widgets)discard(w);widgets.clear();}
 return {control,refresh,reset};
}
