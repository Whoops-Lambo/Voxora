import { moveServer, dissolveFolder, reorderEntry } from './workspace-model.js';

export function createWorkspaceUI({node,button,input,field,formDialog,confirmDialog,context,api,getState,getRoute,storage,preferences,applyPreferences,renderRail,openSettings,toast,serverButton,unreadCount,mentionCount,unreadVisible,markRead}) {
  let current, account, generation=0, tail=Promise.resolve();const localVersions=new Map();
  const data=()=>current||getState()?.workspace||{version:0,appearance:null,layout:[]};
  const folders=()=>data().layout.filter(e=>e.kind==='folder');
  const server=id=>getState()?.servers.find(s=>s.id===id);
  const appearance=()=>({theme:preferences.theme==='light'?'light':'dark',compact:!!preferences.compact,fontSize:Math.max(13,Math.min(20,Number(preferences.fontSize)||15)),reducedMotion:!!preferences.reducedMotion});
  function apply(snapshot) {
    if(!snapshot||!getState()?.me)return;
    const id=getState().me.id;if(account!==id){account=id;current=null;generation++;localVersions.clear();}
    if(current&&snapshot.version<current.version){getState().workspace=current;return;}
    current=structuredClone(snapshot);getState().workspace=current;
    if(snapshot.appearance){Object.assign(preferences,snapshot.appearance);storage.set('appearance:'+id,snapshot.appearance);applyPreferences();}
  }
  function reset(){generation++;current=null;account=null;localVersions.clear();}
  async function load(){const id=getState()?.me.id,epoch=generation;const result=await api('/me/workspace');if(getState()?.me.id===id&&epoch===generation){apply(result);renderRail();}return result;}
  function save(fields,version=data().version,rebaseOwnChanges=false) {
    const id=getState()?.me.id,epoch=generation;
    const task=tail.catch(()=>{}).then(async()=>{
      if(!id||getState()?.me.id!==id||generation!==epoch)throw Error('Sign in again before changing settings.');
      // Appearance controls can queue several changes before the first request returns.
      // Advance through this device's successful writes only; foreign changes still conflict.
      let expected=version;if(rebaseOwnChanges)while(localVersions.has(expected))expected=localVersions.get(expected);
      try{const result=await api('/me/workspace','PATCH',{version:expected,...fields});if(getState()?.me.id===id&&generation===epoch){localVersions.set(expected,result.version);if(localVersions.size>64)localVersions.delete(localVersions.keys().next().value);apply(result);renderRail();}return result;}
      catch(e){if(getState()?.me.id===id&&generation===epoch)await load().catch(()=>{});throw e;}
    });tail=task;return task;
  }
  async function initialize(snapshot){apply(snapshot);if(!data().appearance){const cached=storage.get('appearance:'+account,null);if(cached)Object.assign(preferences,cached);try{await save({appearance:appearance()});}catch(e){if(e.status!==409)toast('Appearance sync is unavailable: '+e.message,true);}}}
  const saveAppearance=()=>save({appearance:appearance()},data().version,true);
  const quiet=fn=>async()=>{try{await fn();}catch(e){toast(e.message,true);}};
  function folderDialog(folder,serverId) {
    const version=data().version,layout=structuredClone(data().layout),name=input(folder?.name||'','Folder name'),color=input(folder?.color||'#5865f2','','color');name.required=true;name.maxLength=64;
    formDialog({title:folder?'Edit Server Folder':'Create Server Folder',description:'Organize your own server list. Your folders sync with this account.',fields:[field('FOLDER NAME',name),field('FOLDER COLOR',color)],submitLabel:'Save Server Folder',submit:async()=>{
      let next=layout;if(folder){const item=next.find(e=>e.kind==='folder'&&e.id===folder.id);if(!item)throw Error('This folder no longer exists.');Object.assign(item,{name:name.value,color:color.value});}
      else{const id=crypto.randomUUID();next.push({kind:'folder',id,name:name.value,color:color.value,serverIds:[]});if(serverId)next=moveServer(next,serverId,{folderId:id});}
      await save({layout:next},version);openSettings('Server Organization');toast('Server folder saved.');
    }});
  }
  function moveDialog(s) {
    const version=data().version,layout=structuredClone(data().layout),select=node('select'),old=folders().find(e=>e.serverIds.includes(s.id));select.setAttribute('aria-label','SERVER FOLDER');select.append(new Option('No Folder',''),...folders().map(e=>new Option(e.name,e.id)));select.value=old?.id||'';
    formDialog({title:'Move Server to Folder',description:s.name,fields:[field('SERVER FOLDER',select)],submitLabel:'Move Server',submit:async()=>{await save({layout:moveServer(layout,s.id,{folderId:select.value||undefined})},version);toast('Server moved.');}});
  }
  function removeFolder(folder) {const version=data().version,layout=dissolveFolder(data().layout,folder.id);confirmDialog('Delete Server Folder','Remove '+folder.name+' and keep its servers in your list?',async()=>{await save({layout},version);openSettings('Server Organization');});}
  const items=s=>[{label:'Move to Folder',icon:'folder',run:()=>moveDialog(s)},{label:'Create Folder with Server',icon:'folder',run:()=>folderDialog(null,s.id)}];
  function folderMenu(event,folder){context(event,[{label:'Edit Folder',icon:'edit',run:()=>folderDialog(folder)},{label:'Mark Folder as Read',icon:'check',run:quiet(async()=>{for(const id of folder.serverIds)await markRead(id);})},{label:'Organize Servers',icon:'settings',run:()=>openSettings('Server Organization')},{label:'Delete Folder',icon:'trash',danger:true,run:()=>removeFolder(folder)}]);}
  function dropTarget(element,{folderId,beforeServerId,beforeEntryId}={}) {
    element.ondragover=e=>{if([...e.dataTransfer.types].some(t=>t==='application/x-voxora-server'||t==='application/x-voxora-folder')){e.preventDefault();e.stopPropagation();element.classList.add('workspace-drop');e.dataTransfer.dropEffect='move';}};
    element.ondragleave=()=>element.classList.remove('workspace-drop');
    element.ondrop=e=>{e.preventDefault();e.stopPropagation();element.classList.remove('workspace-drop');const sid=e.dataTransfer.getData('application/x-voxora-server'),fid=e.dataTransfer.getData('application/x-voxora-folder');if(!sid&&!fid)return;
      if(sid&&(!server(sid)||sid===beforeServerId))return;
      const layout=sid?moveServer(data().layout,sid,{folderId,beforeServerId}):reorderEntry(data().layout,fid,beforeEntryId||folderId||beforeServerId);
      quiet(()=>save({layout}))();
    };
  }
  function render(rail) {
    for(const entry of data().layout) {
      if(entry.kind==='server'){const s=server(entry.id);if(s){const b=serverButton(s);decorateServer(b,s);rail.append(b);}continue;}
      const children=entry.serverIds.map(server).filter(Boolean),closed=storage.get('folders-collapsed:'+account,{}),expanded=closed[entry.id]===false;
      const group=node('div','rail-folder'),b=button('',()=>{closed[entry.id]=expanded;storage.set('folders-collapsed:'+account,closed);renderRail();},'rail-item rail-folder-toggle');b.style.setProperty('--folder-color',entry.color);b.title=entry.name;b.setAttribute('aria-label','Folder: '+entry.name);b.setAttribute('aria-expanded',String(expanded));b.setAttribute('aria-controls','folder-'+entry.id);b.draggable=true;b.ondragstart=e=>{e.dataTransfer.setData('application/x-voxora-folder',entry.id);e.dataTransfer.effectAllowed='move';};
      const preview=node('span','rail-folder-preview');for(const s of children.slice(0,4)){const letter=node('span','',s.name.slice(0,1).toUpperCase());letter.style.background=s.color;preview.append(letter);}if(!children.length)preview.append(node('span','','＋'));b.append(preview);
      const channels=children.flatMap(s=>s.channels),mentions=channels.reduce((n,c)=>n+mentionCount(c.id),0),total=channels.reduce((n,c)=>n+unreadCount(c.id),0);if(mentions)b.append(node('span','rail-mention-badge',String(mentions)));b.classList.toggle('unread',channels.some(c=>unreadVisible(c.id)));b.classList.toggle('folder-selected',children.some(s=>getRoute().server===s.id));b.setAttribute('aria-description',children.length+' servers, '+total+' unread messages, '+mentions+' mentions');b.oncontextmenu=e=>folderMenu(e,entry);dropTarget(b,{folderId:entry.id,beforeEntryId:entry.id});
      group.append(b);const contents=node('div','rail-folder-contents');contents.id='folder-'+entry.id;contents.hidden=!expanded;contents.setAttribute('role','group');contents.setAttribute('aria-label',entry.name+' servers');for(const s of children){const child=serverButton(s);decorateServer(child,s,entry.id);contents.append(child);}if(!children.length)contents.append(node('small','rail-folder-empty','Empty'));group.append(contents);rail.append(group);
    }
  }
  function decorateServer(b,s,entryId=s.id){b.draggable=true;b.dataset.serverId=s.id;b.ondragstart=e=>{e.dataTransfer.setData('application/x-voxora-server',s.id);e.dataTransfer.effectAllowed='move';};dropTarget(b,{beforeServerId:s.id,beforeEntryId:entryId});}
  function organization(content) {
    content.append(node('p','muted','Folders and server order sync across your devices. Drag server icons onto folders, or use the controls below. Opening and closing folders stays local to this device.'),button('Create Server Folder',()=>folderDialog(),'primary'));
    const layout=data().layout,version=data().version;
    layout.forEach((entry,index)=>{
      const title=entry.kind==='folder'?entry.name:server(entry.id)?.name;if(!title)return;
      const row=node('article','workspace-entry'),head=node('div','workspace-entry-heading',[node('strong','',(entry.kind==='folder'?'Folder · ':'')+title)]),controls=node('div','workspace-actions');
      for(const [label,delta]of [['Move Up',-1],['Move Down',1]]){const b=button(label,quiet(async()=>{const next=structuredClone(layout);[next[index],next[index+delta]]=[next[index+delta],next[index]];await save({layout:next},version);openSettings('Server Organization');}));b.disabled=index+delta<0||index+delta>=layout.length;controls.append(b);}
      if(entry.kind==='folder')controls.append(button('Edit Folder',()=>folderDialog(entry)),button('Delete Folder',()=>removeFolder(entry),'danger'));else controls.append(button('Move to Folder',()=>moveDialog(server(entry.id))));head.append(controls);row.append(head);
      if(entry.kind==='folder'){for(const id of entry.serverIds){const s=server(id);if(!s)continue;row.append(node('div','workspace-folder-member',[node('span','',s.name),button('Move Server',()=>moveDialog(s))]));}if(!entry.serverIds.length)row.append(node('p','muted','Drop a server here or move one from its menu.'));}content.append(row);
    });
  }
  function portability(content) {
    content.append(node('p','muted','Export appearance, folders and server order to a JSON file. Importing does not join or leave servers. Microphone choices, volume, notification permissions, drafts, messages and tokens stay out of this file.'));
    content.append(button('Export Settings',quiet(async()=>{const settings=await api('/me/workspace/export'),url=URL.createObjectURL(new Blob([JSON.stringify(settings,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download='Voxora-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Settings exported.');}),'primary'));
    const file=input('','','file');file.accept='.json,application/json';const mode=node('select');mode.setAttribute('aria-label','IMPORT MODE');mode.append(new Option('Merge: keep saved placements, add imported folders','merge'),new Option('Replace: use imported organization','replace'));const result=node('section','workspace-import-preview'),error=node('p','form-error'),preview=button('Preview Import',quiet(async()=>{
      error.textContent='';result.replaceChildren();try{const selected=file.files[0];if(!selected)throw Error('Choose a Voxora settings file.');if(selected.size>100000)throw Error('Settings files can be up to 100 KB.');let settings;try{settings=JSON.parse(await selected.text());}catch{throw Error('This file is not valid JSON.');}
        const chosenMode=mode.value,preview=await api('/me/workspace/import-preview','POST',{settings,mode:chosenMode});if(!content.isConnected)return;
        result.append(node('h3','','Import Preview'),node('p','',preview.appearance.theme+' theme · '+preview.appearance.fontSize+'px · '+(preview.appearance.compact?'Compact':'Comfortable')+' messages'),node('p','',preview.layout.filter(e=>e.kind==='folder').length+' folders · '+preview.ignoredServers+' unavailable servers skipped'),node('p','muted',chosenMode==='replace'?'Your current folders and server order will be replaced.':'Saved placements and folder names stay; imported appearance replaces current appearance.'));
        const list=node('ul');for(const e of preview.layout)list.append(node('li','',e.kind==='folder'?e.name+' ('+e.serverIds.length+' servers)':server(e.id)?.name||'Server'));result.append(list,button('Apply Imported Settings',quiet(async()=>{await tail.catch(()=>{});const id=getState()?.me.id,epoch=generation;try{const next=await api('/me/workspace/import','POST',{version:preview.version,settings,mode:chosenMode});if(getState()?.me.id!==id||epoch!==generation)return;apply(next);renderRail();openSettings('Settings Backup');toast('Settings imported.');}catch(e){await load().catch(()=>{});result.replaceChildren();error.textContent=e.message;}}),'primary'));
      }catch(e){error.textContent=e.message;}
    }));
    const invalidate=()=>{result.replaceChildren();error.textContent='';};file.onchange=invalidate;mode.onchange=invalidate;content.append(field('SETTINGS FILE',file),field('IMPORT MODE',mode),preview,error,result);
  }
  return {apply,reset,initialize,saveAppearance,items,render,organization,portability,dropTarget};
}
