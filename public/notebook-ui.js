export function createNotebookUI({node,button,input,field,formDialog,modal,api,getState,toast}){
 let root=null,editor=null,version=0,query='';const who=()=>getState()?.me?.id;
 function reset(){version++;if(root?.isConnected||editor?.node?.isConnected)document.getElementById('modal').close();root=null;editor=null;query='';}
 function exportText(title,text){const url=URL.createObjectURL(new Blob([title+'\n\n'+text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=(title.replace(/[^a-z0-9 _-]/gi,'').slice(0,60)||'Voxora-note')+'.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function open(){editor=null;root=node('section','notebook-view');modal([root],'notebook-dialog');await load();}
 async function load(){
  if(!root?.isConnected)return;const target=root,account=who(),epoch=++version;target.replaceChildren(node('p','muted','Opening your notebook…'));
  try{const data=await api('/me/notes?q='+encodeURIComponent(query));if(epoch!==version||account!==who()||!target.isConnected)return;
   const heading=node('header','notebook-hero',[node('div','',[node('span','studio-eyebrow','YOUR PRIVATE SPACE'),node('h1','','A place for your next idea.'),node('p','','Notes, checklists and a little room to think. Private to your account.')]),button('New Note',()=>edit(),'primary')]);
   const search=input(query,'Search your notes');search.setAttribute('aria-label','Search notebook');let timer;search.oninput=()=>{query=search.value;clearTimeout(timer);timer=setTimeout(()=>load(),300);};
   const list=node('div','notebook-grid');for(const n of data.items){const card=node('article','note-card note-'+n.color);card.dataset.noteId=n.id;const title=button(n.title,()=>edit(n),'note-title');card.append(node('span','note-kicker',n.pinned?'PINNED NOTE':'NOTE'),title,node('p','note-preview',n.content.slice(0,180)||'An empty page, ready for you.'),node('small','',new Date(n.updatedAt).toLocaleString()));const actions=node('div','thread-actions',[button(n.pinned?'Unpin Note':'Pin Note',async()=>{await api('/me/notes/'+n.id,'PATCH',{revision:n.revision,pinned:!n.pinned});await load();},'text-button'),button('Export Note',()=>exportText(n.title,n.content),'text-button')]);card.append(actions);list.append(card);}
   if(!data.items.length)list.append(node('div','notebook-empty',[node('span','','✦'),node('h2','','Keep a thought. Start a plan.'),node('p','','Your notebook follows your account, without posting anything in chat.'),button('Create Your First Note',()=>edit(),'primary')]));
   target.replaceChildren(heading,search,node('p','studio-result-count',data.total+' notes'),list);
  }catch(e){if(epoch===version&&target.isConnected)target.replaceChildren(node('p','form-error',e.message),button('Retry',load,'secondary'));}
 }
 async function edit(note=null){
  const account=who(),epoch=++version;let saved=note?await api('/me/notes/'+note.id):null;if(account!==who()||epoch!==version)return;
  const title=input(saved?.title||'','Give this page a title');title.maxLength=120;title.required=true;title.setAttribute('aria-label','Note title');
  const content=node('textarea','note-editor-content');content.value=saved?.content||'';content.maxLength=12000;content.setAttribute('aria-label','Note content');content.placeholder='Write freely. Use - [ ] for a checklist.';
  const color=node('select');color.setAttribute('aria-label','Note color');for(const [id,name]of[['mint','Mint'],['copper','Copper'],['iris','Iris']])color.append(new Option(name,id));color.value=saved?.color||'mint';
  const status=node('span','note-save-status',saved?'Saved':'New note · not saved'),count=node('small',''),preview=node('div','note-checklist');let dirty=false;
  function update(){count.textContent=content.value.length.toLocaleString()+' / 12,000';preview.replaceChildren();for(const [i,line]of content.value.split('\n').entries()){const m=/^- \[([ xX])\] (.*)$/.exec(line);if(!m)continue;const check=input('','','checkbox');check.checked=m[1]!==' ';check.onchange=()=>{const lines=content.value.split('\n');lines[i]='- ['+(check.checked?'x':' ')+'] '+m[2];content.value=lines.join('\n');change();};preview.append(node('label','inline-check',[check,document.createTextNode(m[2]||'Checklist item')]));}}
  function change(){dirty=true;status.textContent='Unsaved changes';update();}content.oninput=change;title.oninput=change;color.onchange=change;update();
  const form=node('form','note-editor'),save=node('button','primary','Save Note');save.type='submit';
  const actions=node('div','notebook-editor-actions',[button('Back to Notebook',()=>{if(!dirty||window.confirm('Discard unsaved note changes?'))open();},'secondary'),color,button('Insert Checklist',()=>{content.setRangeText('- [ ] Checklist item\n',content.selectionStart,content.selectionEnd,'end');change();content.focus();},'secondary'),button('Download Draft',()=>exportText(title.value,content.value),'text-button'),save]);
  const error=node('p','form-error');form.append(node('span','studio-eyebrow','VOXORA NOTEBOOK'),title,actions,content,preview,node('div','note-editor-footer',[status,count]),error);
  if(saved)form.append(button('Delete Note',()=>{if(!window.confirm('Delete this note permanently?'))return;return api('/me/notes/'+saved.id+'?revision='+saved.revision,'DELETE').then(open);},'text-button danger'));
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;error.textContent='';try{const data={title:title.value,content:content.value,color:color.value,...(saved?{revision:saved.revision}:{})};const result=await api('/me/notes'+(saved?'/'+saved.id:''),saved?'PATCH':'POST',data);if(account!==who()||!form.isConnected)return;saved=result;dirty=false;status.textContent='Saved · '+new Date(result.updatedAt).toLocaleTimeString();toast('Note saved.');}catch(e){error.textContent=e.message;}finally{save.disabled=false;}};
  root=null;editor={node:form,status,account};modal([form],'notebook-dialog');title.focus();
 }
 function refresh(){if(editor?.node?.isConnected){if(editor.account!==who())reset();else editor.status.textContent='Notebook updated. Saving checks for changes on another device.';return;}if(root?.isConnected)load();}
 function renderHome(main,side){side.append(node('section','hub-section notebook-home',[node('span','studio-eyebrow','A LITTLE SPACE TO THINK'),node('h2','','Your private notebook'),node('p','muted','Collect ideas, keep checklists and pick up where you left off.'),button('Open Notebook',open,'secondary')]));}
 return {open,edit,reset,refresh,renderHome};
}
