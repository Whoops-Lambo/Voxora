export function moveServer(layout, serverId, { folderId, beforeServerId } = {}) {
  const next=structuredClone(layout);
  for(let i=next.length-1;i>=0;i--){const e=next[i];if(e.kind==='folder')e.serverIds=e.serverIds.filter(id=>id!==serverId);else if(e.id===serverId)next.splice(i,1);}
  if(folderId){const folder=next.find(e=>e.kind==='folder'&&e.id===folderId);if(!folder)throw Error('This folder no longer exists.');folder.serverIds.push(serverId);}
  else if(beforeServerId){const folder=next.find(e=>e.kind==='folder'&&e.serverIds.includes(beforeServerId));if(folder)folder.serverIds.splice(folder.serverIds.indexOf(beforeServerId),0,serverId);else{const index=next.findIndex(e=>e.kind==='server'&&e.id===beforeServerId);next.splice(index<0?next.length:index,0,{kind:'server',id:serverId});}}
  else next.push({kind:'server',id:serverId});return next;
}
export function dissolveFolder(layout,id){return layout.flatMap(e=>e.kind==='folder'&&e.id===id?e.serverIds.map(id=>({kind:'server',id})):[structuredClone(e)]);}
export function reorderEntry(layout,id,beforeId){const next=structuredClone(layout),index=next.findIndex(e=>e.id===id);if(index<0||id===beforeId)return next;const [entry]=next.splice(index,1),target=next.findIndex(e=>e.id===beforeId);next.splice(target<0?next.length:target,0,entry);return next;}
