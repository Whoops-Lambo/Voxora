export function settingsShell({node,button,modal,scope,name,tabs,active,onSelect,className='',back}){
  const nav=node('nav','settings-nav settings-navigation',[node('p','settings-scope',scope),node('h3','settings-target',name)]);
  nav.setAttribute('aria-label',scope+' navigation');
  for(const tab of tabs){const control=button(tab,()=>onSelect(tab),'manage-tab'+(tab===active?' active':''));if(tab===active)control.setAttribute('aria-current','page');nav.append(control);}
  if(back)nav.append(node('div','settings-rule'),button('Back to Server Settings',back,'settings-back'));
  const content=node('section','settings-content manage-content',[node('p','settings-location',scope+' / '+active),node('h2','',active)]);
  content.setAttribute('aria-label',scope+' — '+active);
  modal([nav,content],'settings-dialog '+className);
  return{nav,content};
}
export function settingsForm({node,button,target,config,onSaved}){
  const form=node('form','settings-form'),error=node('p','form-error'),save=node('button','primary',config.submitLabel||'Save Changes');save.type='submit';error.setAttribute('role','alert');
  if(config.description)form.append(node('p','management-help',config.description));form.append(...config.fields,error,node('div','settings-form-actions',[save]));target.append(form);
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;error.textContent='';try{await config.submit();if(form.isConnected)await onSaved?.();}catch(e){if(form.isConnected)error.textContent=e.message;}finally{save.disabled=false;}};
  return form;
}
