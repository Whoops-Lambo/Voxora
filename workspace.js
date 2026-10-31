import { isSuspended } from './platform.js';

export const DEFAULT_APPEARANCE = { theme: 'dark', compact: false, fontSize: 15, reducedMotion: false };
export function initializeWorkspaceUser(user) { user.workspace ||= { version: 0, appearance: null, layout: [] }; }

export function workspaceService({ state, body, json, fail, save, notify }) {
  const keys = (value, allowed) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) fail(400, 'Unsupported settings field.'); };
  const identifier = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
  const joined = me => new Set(state.servers.filter(s => s.members.includes(me.id)).map(s => s.id));
  function appearance(value) {
    keys(value, Object.keys(DEFAULT_APPEARANCE));
    if (!['dark','light'].includes(value.theme) || typeof value.compact !== 'boolean' || !Number.isInteger(value.fontSize) || value.fontSize < 13 || value.fontSize > 20 || typeof value.reducedMotion !== 'boolean') fail(400, 'Choose a supported theme, message display and font size from 13 to 20.');
    return { theme: value.theme, compact: value.compact, fontSize: value.fontSize, reducedMotion: value.reducedMotion };
  }
  function layout(value, me, importing = false) {
    if (!Array.isArray(value) || value.length > 520) fail(400, 'A layout supports up to 500 servers and 20 folders.');
    const access = joined(me), seen = new Set(), folders = new Set(); let count = 0, ignored = 0;
    const server = id => {
      if (!identifier(id) || seen.has(id) || folders.has(id) || ++count > 500) fail(400, 'Each server can appear once, with up to 500 servers in a layout.');
      seen.add(id); if (access.has(id)) return true;
      if (!importing) fail(403, 'Only servers you currently belong to can be organized.'); ignored++; return false;
    };
    const result = value.flatMap(entry => {
      if (entry?.kind === 'server') { keys(entry,['kind','id']); return server(entry.id) ? [{kind:'server',id:entry.id}] : []; }
      keys(entry,['kind','id','name','color','serverIds']);
      if (entry.kind !== 'folder' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(entry.id || '') || folders.has(entry.id) || seen.has(entry.id) || access.has(entry.id) || folders.size >= 20 || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 64 || /[\p{Cc}\p{Cf}]/u.test(entry.name) || !/^#[a-f0-9]{6}$/i.test(entry.color || '') || !Array.isArray(entry.serverIds)) fail(400, 'Use up to 20 named folders with unique IDs and valid colors.');
      folders.add(entry.id); return [{kind:'folder',id:entry.id,name:entry.name.trim(),color:entry.color.toLowerCase(),serverIds:entry.serverIds.filter(server)}];
    });
    return { layout: result, ignored };
  }
  function view(me) {
    initializeWorkspaceUser(me); const access = joined(me), placed = new Set();
    const entries = me.workspace.layout.flatMap(entry => {
      if (entry.kind === 'server') { if (!access.has(entry.id)) return []; placed.add(entry.id); return [{...entry}]; }
      const serverIds = entry.serverIds.filter(id => access.has(id)); for (const id of serverIds) placed.add(id); return [{...entry,serverIds}];
    });
    for (const id of access) if (!placed.has(id)) entries.push({kind:'server',id});
    return { version: me.workspace.version, appearance: me.workspace.appearance && {...me.workspace.appearance}, layout: entries };
  }
  function imported(me, d) {
    keys(d.settings,['format','schema','exportedAt','appearance','layout']);
    if (d.settings.format !== 'voxora-settings' || d.settings.schema !== 1 || typeof d.settings.exportedAt !== 'string' || !Number.isFinite(Date.parse(d.settings.exportedAt))) fail(400, 'Choose a supported Voxora settings export.');
    if (!['merge','replace'].includes(d.mode)) fail(400, 'Choose Merge or Replace.');
    const incoming = layout(d.settings.layout, me, true), current = view(me); let entries = incoming.layout;
    if (d.mode === 'merge') {
      // Merge preserves existing placement. Imported folder membership is used for servers
      // that have not yet been explicitly placed in the stored layout.
      const explicit = new Set(me.workspace.layout.flatMap(e=>e.kind==='folder'?e.serverIds:[e.id]));
      const movable = new Set(incoming.layout.flatMap(e=>e.kind==='folder'?e.serverIds:[]).filter(id=>!explicit.has(id)));
      entries = current.layout.flatMap(e=>e.kind==='server'&&movable.has(e.id)?[]:[e]);
      for(const e of incoming.layout.filter(e=>e.kind==='folder')) {
        const target=entries.find(x=>x.kind==='folder'&&x.id===e.id);
        const ids=e.serverIds.filter(id=>movable.has(id));
        if(target)target.serverIds.push(...ids);else entries.push({...e,serverIds:ids});
      }
    }
    const checked=layout(entries,me);const placed=new Set(checked.layout.flatMap(e=>e.kind==='folder'?e.serverIds:[e.id]));
    for(const id of joined(me))if(!placed.has(id))checked.layout.push({kind:'server',id});
    return { appearance: appearance(d.settings.appearance), layout: checked.layout, ignoredServers: incoming.ignored, mode:d.mode };
  }
  async function handle(req,res,url,me) {
    const match=url.pathname.match(/^\/api\/me\/workspace(?:\/(export|import|import-preview))?$/);if(!match)return false;
    const method=req.method,d=['POST','PATCH'].includes(method)?await body(req,128000):{};
    if(me.bot||isSuspended(me))fail(403,'Personal settings require an active human account.');initializeWorkspaceUser(me);
    const action=match[1];
    if(method==='GET'&&!action){json(res,200,view(me));return true;}
    if(method==='GET'&&action==='export'){const current=view(me);json(res,200,{format:'voxora-settings',schema:1,exportedAt:new Date().toISOString(),appearance:current.appearance||{...DEFAULT_APPEARANCE},layout:current.layout});return true;}
    if(method==='POST'&&action==='import-preview'){keys(d,['settings','mode']);json(res,200,{version:me.workspace.version,...imported(me,d)});return true;}
    if(method==='PATCH'&&!action||method==='POST'&&action==='import'){
      keys(d,action?['version','settings','mode']:['version','appearance','layout']);
      if(!Number.isSafeInteger(d.version)||d.version!==me.workspace.version)fail(409,'Settings changed on another device. Refresh and try again.');
      let next;
      if(action)next=imported(me,d);else{
        if(d.appearance===undefined&&d.layout===undefined)fail(400,'Choose appearance or server organization to update.');
        next={...(d.appearance===undefined?{}:{appearance:appearance(d.appearance)}),...(d.layout===undefined?{}:layout(d.layout,me))};
      }
      me.workspace={version:me.workspace.version+1,appearance:next.appearance??me.workspace.appearance,layout:next.layout??me.workspace.layout};
      await save();notify(me.id);json(res,200,{...view(me),...(action?{ignoredServers:next.ignoredServers}:{})});return true;
    }
    fail(405,'Method not allowed.');
  }
  return {handle,view};
}
