import { randomUUID } from 'node:crypto';
import { activePremium } from './premium.js';
import { isSuspended } from './platform.js';
import { searchQuery } from './search-filters.js';

export function initializePersonalTools(user) {
  user.tools ||= { revision: 0, collections: [], snippets: [], aliases: {}, themes: {}, userNotes: {}, searches: [], drafts: [], profilePresets: [], sound: 'classic', unreadOnly: false };
}

export function personalToolsService({ state, body, json, fail, save, refresh, notify, canRead, serverFor, messageView, collaboration, serverPermissions, revokeSession }) {
  const keys = (data, allowed) => { if (Object.keys(data).some(key => !allowed.includes(key))) fail(400, 'Unsupported field.'); };
  const text = (value, max, required = false) => {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) fail(400, `Use ${required ? '1–' : 'up to '}${max} characters.`);
    return value.trim();
  };
  const deleteVersion = (url, item) => { if (!url.searchParams.has('revision')) fail(409, 'Reopen this item before deleting.'); version({ revision: Number(url.searchParams.get('revision')) }, item); };
  const version = (data, item) => { if (!Number.isSafeInteger(data.revision) || data.revision !== item.revision) fail(409, 'This changed on another device. Reopen it before saving.'); };
  const plus = me => { if (!activePremium(me)) fail(403, 'Voxora Plus is required for this feature.'); };
  const channelAccess = (me, id) => canRead(me, id) && !state.conversations.some(c => c.id === id && c.members.some(uid => me.blocked?.includes(uid) || state.users.find(u => u.id === uid)?.blocked?.includes(me.id)));
  const source = (me, reference) => {
    const message = (reference.kind === 'thread' ? state.threadMessages : state.messages).find(m => m.id === reference.id);
    return message && channelAccess(me, message.channel) && !me.blocked?.includes(message.authorId) && (!message.threadId || collaboration.hasReplyAccess(message, me)) ? message : null;
  };
  const knownUser = (me, id) => id === me.id || state.servers.some(s => s.members.includes(me.id) && s.members.includes(id)) || state.conversations.some(c => c.members.includes(me.id) && c.members.includes(id)) || state.friendships.some(f => f.status === 'accepted' && [f.from, f.to].includes(me.id) && [f.from, f.to].includes(id));
  const webURL = value => {
    let url; try { url = new URL(text(value, 2048, true)); } catch { fail(400, 'Enter a complete HTTP or HTTPS address.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail(400, 'Use HTTP or HTTPS without embedded credentials.');
    return url.href;
  };
  const color = value => { if (!/^#[a-f0-9]{6}$/i.test(value || '')) fail(400, 'Choose a valid color.'); return value.toLowerCase(); };
  const style = data => { keys(data, ['bannerStart', 'bannerEnd', 'accent', 'showBadge']); if (typeof data.showBadge !== 'boolean') fail(400, 'Choose badge visibility.'); return { bannerStart: color(data.bannerStart), bannerEnd: color(data.bannerEnd), accent: color(data.accent), showBadge: data.showBadge }; };
  const changed = async (me, res, value, status = 200) => { await save(); notify(me.id); json(res, status, value); return true; };
  const collectionView = (me, collection) => ({ ...collection, entries: collection.entries.flatMap(entry => { const message = source(me, entry); return message ? [{ ...entry, message: messageView(message), serverId: serverFor(message.channel)?.id || null }] : []; }), unavailable: collection.entries.filter(entry => !source(me, entry)).length });
  function snapshot(me) {
    initializePersonalTools(me); const p = me.tools, active = activePremium(me);
    return { revision: p.revision, plus: active, sound: active ? p.sound : 'classic', unreadOnly: p.unreadOnly, aliases: Object.fromEntries(Object.entries(p.aliases).filter(([id]) => channelAccess(me, id))), themes: active ? Object.fromEntries(Object.entries(p.themes).filter(([id]) => channelAccess(me, id))) : {}, focusUntil: me.focusUntil || 0, collections: p.collections.length, snippets: p.snippets.length };
  }
  async function handle(req, res, url, me, session) {
    const own = url.pathname.match(/^\/api\/me\/(toolbox|focus|collections|snippets|user-notes|channel-tools|saved-searches|cloud-drafts|profile-presets|sessions)(?:\/([\w-]+))?(?:\/(messages|export|expand|apply|run|revoke-others)(?:\/([\w-]+))?)?$/);
    const library = url.pathname.match(/^\/api\/channels\/([\w-]+)\/library$/);
    const resources = url.pathname.match(/^\/api\/servers\/([\w-]+)\/resources(?:\/([\w-]+))?$/);
    if (!own && !library && !resources) return false;
    if (me.bot || isSuspended(me)) fail(403, 'These tools require an active human account.');
    const method = req.method, data = ['POST', 'PATCH'].includes(method) ? await body(req) : {};
    initializePersonalTools(me); const p = me.tools;
    if (library) {
      if (method !== 'GET') fail(405, 'Method not allowed.');
      const channel = library[1]; if (!channelAccess(me, channel)) fail(404, 'Conversation not found.');
      const kind = url.searchParams.get('kind') || 'media', q = (url.searchParams.get('q') || '').toLowerCase(), offset = Number(url.searchParams.get('offset') || 0);
      if (!['media', 'files', 'voice', 'links'].includes(kind) || q.length > 100 || !Number.isSafeInteger(offset) || offset < 0) fail(400, 'Invalid library filter or page.');
      const items = [...state.messages, ...state.threadMessages].filter(m => m.channel === channel && !me.blocked?.includes(m.authorId) && (!m.threadId || collaboration.hasReplyAccess(m, me))).sort((a, b) => b.time - a.time).flatMap(m => {
        const message = messageView(m), common = { messageId: m.id, threadId: m.threadId || null, channel, author: message.author, time: m.time };
        if (kind === 'links') return [...new Set((m.text.match(/https?:\/\/[^\s<>]+/g) || []).slice(0, 20))].flatMap(value => { let link; try { link = new URL(value); } catch { return []; } return !link.username && !link.password && (link.href + ' ' + m.text).toLowerCase().includes(q) ? [{ ...common, url: link.href, text: m.text.slice(0, 240) }] : []; });
        return message.attachments.filter(file => (kind === 'files' || kind === 'voice' && file.voiceNote || kind === 'media' && /^(image|video)\//.test(file.mime)) && (file.name + ' ' + m.text).toLowerCase().includes(q)).map(file => ({ ...common, file }));
      });
      json(res, 200, { items: items.slice(offset, offset + 40), total: items.length, hasMore: offset + 40 < items.length }); return true;
    }
    if (resources) {
      const server = state.servers.find(s => s.id === resources[1] && s.members.includes(me.id)); if (!server) fail(404, 'Server not found.');
      server.resources ||= []; const manager = serverPermissions(server, me.id).includes('manageChannels'), item = server.resources.find(r => r.id === resources[2]);
      if (method === 'GET' && !resources[2]) { json(res, 200, { canManage: manager, items: server.resources.filter(r => !r.channelId || channelAccess(me, r.channelId)) }); return true; }
      if (!manager) fail(403, 'Manage Channels is required to curate server resources.');
      if (resources[2] && !item) fail(404, 'Resource not found.');
      if (method === 'DELETE' && item) { deleteVersion(url, item); server.resources = server.resources.filter(r => r !== item); await save(); refresh(); json(res, 200, { ok: true }); return true; }
      if (!(method === 'POST' && !resources[2] || method === 'PATCH' && item)) fail(405, 'Method not allowed.');
      keys(data, ['revision', 'title', 'description', 'url', 'channelId']); if (item) version(data, item);
      const channelId = data.channelId || null; if (channelId && !server.channels.some(c => c.id === channelId && channelAccess(me, c.id))) fail(403, 'Choose an accessible channel in this server.');
      const fields = { title: text(data.title, 100, true), description: text(data.description || '', 1000), url: webURL(data.url), channelId };
      if (!item && server.resources.length >= 100) fail(400, 'A server supports up to 100 resources.');
      const next = item || { id: randomUUID(), revision: -1 }; Object.assign(next, fields, { revision: next.revision + 1 }); if (!item) server.resources.push(next);
      await save(); refresh(); json(res, item ? 200 : 201, next); return true;
    }
    const [, kind, id, action, entryId] = own;
    if (kind === 'toolbox') {
      if (id || action) fail(404, 'Tool not found.');
      if (method === 'GET') { json(res, 200, snapshot(me)); return true; }
      if (method !== 'PATCH') fail(405, 'Method not allowed.'); keys(data, ['revision', 'sound', 'unreadOnly']); version(data, p);
      if (data.sound !== undefined) { plus(me); if (!['classic', 'bell', 'arcade', 'soft', 'orbit'].includes(data.sound)) fail(400, 'Choose a notification sound.'); }
      if (data.unreadOnly !== undefined && typeof data.unreadOnly !== 'boolean') fail(400, 'Choose the unread filter.');
      if (data.sound !== undefined) p.sound = data.sound; if (data.unreadOnly !== undefined) p.unreadOnly = data.unreadOnly; p.revision++;
      return changed(me, res, snapshot(me));
    }
    if (kind === 'focus') {
      if (id || action || method !== 'POST') fail(405, 'Method not allowed.'); keys(data, ['minutes']);
      if (![0, 15, 25, 50, 90].includes(data.minutes)) fail(400, 'Choose a focus duration.');
      me.focusUntil = data.minutes ? Date.now() + data.minutes * 60000 : 0;
      await save(); refresh(); json(res, 200, { focusUntil: me.focusUntil }); return true;
    }
    if (kind === 'sessions') {
      if (action) fail(405, 'Method not allowed.');
      if (method === 'GET' && !id) { json(res, 200, { items: state.sessions.filter(s => s.userId === me.id && s.expires > Date.now()).map(s => ({ id: s.id, current: s.hash === session.hash, agent: s.agent || 'Earlier Voxora session', createdAt: s.createdAt || null, expiresAt: s.expires })) }); return true; }
      if (method === 'POST' && id === 'revoke-others') { keys(data, []); const victims = state.sessions.filter(s => s.userId === me.id && s.hash !== session.hash); for (const item of victims) await revokeSession(item.hash); return changed(me, res, { revoked: victims.length }); }
      if (method !== 'DELETE' || !id) fail(405, 'Method not allowed.'); const item = state.sessions.find(s => s.id === id && s.userId === me.id); if (!item) fail(404, 'Session not found.'); if (item.hash === session.hash) fail(400, 'Use Log Out to end this session.'); await revokeSession(item.hash); return changed(me, res, { ok: true });
    }
    if (kind === 'channel-tools') {
      if (!id || action || !channelAccess(me, id)) fail(404, 'Conversation not found.');
      if (method === 'GET') { json(res, 200, { revision: p.revision, alias: p.aliases[id] || '', theme: activePremium(me) ? p.themes[id] || null : null }); return true; }
      if (method !== 'PATCH') fail(405, 'Method not allowed.'); keys(data, ['revision', 'alias', 'theme']); version(data, p);
      const alias = data.alias === undefined ? undefined : text(data.alias, 40); let theme;
      if (data.theme !== undefined) { theme = data.theme; if (theme !== null) { plus(me); keys(theme, ['start', 'end']); theme = { start: color(theme.start), end: color(theme.end) }; } }
      if(alias&&!p.aliases[id]&&Object.keys(p.aliases).length>=200)fail(400,'Keep up to 200 conversation aliases.');
      if(theme&&!p.themes[id]&&Object.keys(p.themes).length>=200)fail(400,'Keep up to 200 conversation themes.');
      if (alias) { p.aliases[id] = alias; } else if (alias !== undefined) delete p.aliases[id];
      if (theme) { p.themes[id] = theme; } else if (theme === null) delete p.themes[id];
      p.revision++; return changed(me, res, snapshot(me));
    }
    if (kind === 'user-notes') {
      if (!id || action) fail(404, 'User note not found.'); const previous = p.userNotes[id];
      if (method === 'GET') { json(res, 200, { text: previous?.text || '', revision: previous?.revision || 0 }); return true; }
      if (method === 'DELETE') { delete p.userNotes[id]; return changed(me, res, { ok: true }); }
      if (method !== 'PATCH') fail(405, 'Method not allowed.'); keys(data, ['revision', 'text']); version(data, previous || { revision: 0 });
      if (!knownUser(me, id) || !state.users.some(u => u.id === id)) fail(404, 'User not found.'); if (!previous && Object.keys(p.userNotes).length >= 500) fail(400, 'Keep notes for up to 500 people.');
      const value = text(data.text, 2000); if (value) p.userNotes[id] = { text: value, revision: (previous?.revision || 0) + 1 }; else delete p.userNotes[id]; return changed(me, res, { text: value, revision: p.userNotes[id]?.revision || 0 });
    }
    if (kind === 'collections') {
      const collection = p.collections.find(c => c.id === id); if (id && !collection) fail(404, 'Collection not found.');
      if (action === 'export' && method === 'GET') { plus(me); const view = collectionView(me, collection), lines = ['# ' + collection.name, '', ...view.entries.flatMap(e => ['## ' + e.message.author + ' · ' + new Date(e.message.time).toISOString(), '', e.message.text, '', ...e.message.attachments.map(f => '- ' + f.name), ''])]; json(res, 200, { name: collection.name, markdown: lines.join('\n') }); return true; }
      if (action === 'messages') {
        if (method === 'POST' && !entryId) { keys(data, ['revision', 'kind', 'id']); version(data, collection); if (!['message', 'thread'].includes(data.kind) || typeof data.id !== 'string' || !source(me, data)) fail(404, 'Message not available.'); if (collection.entries.some(e => e.kind === data.kind && e.id === data.id)) fail(409, 'That message is already in this collection.'); if (collection.entries.length >= 200) fail(400, 'A collection supports up to 200 messages.'); collection.entries.push({ id: data.id, kind: data.kind, addedAt: Date.now() }); collection.revision++; return changed(me, res, collectionView(me, collection), 201); }
        if (method === 'DELETE' && entryId) { deleteVersion(url, collection); collection.entries = collection.entries.filter(e => e.id !== entryId); collection.revision++; return changed(me, res, collectionView(me, collection)); }
        fail(405, 'Method not allowed.');
      }
      if (action) fail(405, 'Method not allowed.');
      if (method === 'GET') { json(res, 200, collection ? collectionView(me, collection) : { items: p.collections.map(c => ({ id: c.id, name: c.name, revision: c.revision, count: c.entries.length })) }); return true; }
      if (method === 'DELETE' && collection) { deleteVersion(url, collection); p.collections = p.collections.filter(c => c !== collection); return changed(me, res, { ok: true }); }
      if (!(method === 'POST' && !id || method === 'PATCH' && collection)) fail(405, 'Method not allowed.'); keys(data, ['revision', 'name']); if (collection) version(data, collection);
      const name = text(data.name, 60, true); if (!collection && p.collections.length >= 30) fail(400, 'Keep up to 30 message collections.'); const next = collection || { id: randomUUID(), entries: [], revision: -1 }; next.name = name; next.revision++; if (!collection) p.collections.push(next); return changed(me, res, collectionView(me, next), collection ? 200 : 201);
    }
    if (kind === 'cloud-drafts') {
      if (action) fail(405, 'Method not allowed.'); const draft = p.drafts.find(d => d.channel === id);
      if (method === 'GET') { if (id && !channelAccess(me, id)) fail(404, 'Conversation not found.'); json(res, 200, id ? draft || { channel: id, revision: 0, text: '' } : { items: p.drafts.filter(d => channelAccess(me, d.channel)) }); return true; }
      if (method === 'DELETE' && draft) { deleteVersion(url, draft); p.drafts = p.drafts.filter(d => d !== draft); return changed(me, res, { ok: true }); }
      if (method !== 'PATCH' || !id) fail(405, 'Method not allowed.'); plus(me); keys(data, ['revision', 'text']); if (!channelAccess(me, id)) fail(404, 'Conversation not found.'); version(data, draft || { revision: 0 });
      if (!draft && p.drafts.length >= 100) fail(400, 'Keep up to 100 cloud drafts.'); const value = text(data.text, 4000, true), next = draft || { id: randomUUID(), channel: id, revision: 0 }; Object.assign(next, { text: value, revision: next.revision + 1, updatedAt: Date.now() }); if (!draft) p.drafts.push(next); return changed(me, res, next);
    }
    const listKey = { snippets: 'snippets', 'saved-searches': 'searches', 'profile-presets': 'profilePresets' }[kind];
    if (!listKey) fail(404, 'Tool not found.'); const list = p[listKey], item = list.find(i => i.id === id); if (id && !item) fail(404, 'Item not found.');
    if (kind !== 'snippets' && !['DELETE','GET'].includes(method)) plus(me);
    if (kind === 'saved-searches' && action === 'run' && method === 'POST') { keys(data, []); searchQuery(item.query, fail); json(res, 200, {query:item.query}); return true; }
    if (method === 'POST' && action === 'expand' && kind === 'snippets') {
      keys(data, ['channel']); if (!channelAccess(me, data.channel)) fail(404, 'Conversation not found.'); const dynamic = /\{\{(?:username|date|time|channel)\}\}/.test(item.content); if (dynamic) plus(me);
      const server = serverFor(data.channel), channel = server?.channels.find(c => c.id === data.channel), now = new Date(), values = { username: me.displayName, date: now.toLocaleDateString('en-CA', { timeZone: me.timeZone || 'UTC' }), time: now.toLocaleTimeString('en-GB', { timeZone: me.timeZone || 'UTC', hour: '2-digit', minute: '2-digit' }), channel: channel?.name || 'Direct Message' };
      json(res, 200, { text: item.content.replace(/\{\{(username|date|time|channel)\}\}/g, (_, key) => values[key]) }); return true;
    }
    if (method === 'POST' && action === 'apply' && kind === 'profile-presets') { keys(data, ['revision']); version(data, item); me.premium.profile = { ...item.style }; me.premium.version++; await save(); refresh(); json(res, 200, { ok: true }); return true; }
    if (action) fail(405, 'Method not allowed.');
    if (method === 'GET' && !id) { json(res, 200, { items: list }); return true; }
    if (method === 'DELETE' && item) { deleteVersion(url, item); p[listKey] = list.filter(i => i !== item); return changed(me, res, { ok: true }); }
    if (!(method === 'POST' && !id || method === 'PATCH' && item)) fail(405, 'Method not allowed.');
    keys(data, ['revision', 'name', ...(kind === 'snippets' ? ['content'] : kind === 'saved-searches' ? ['query'] : ['style'])]); if (item) version(data, item);
    if (!item && list.length >= (kind === 'snippets' ? 100 : kind === 'saved-searches' ? 30 : 12)) fail(400, 'This library is full. Remove an older item first.');
    const fields = { name: text(data.name, 60, true) };
    if (kind === 'snippets') { fields.content = text(data.content, activePremium(me) ? 4000 : 2000, true); if (/\{\{(?:username|date|time|channel)\}\}/.test(fields.content)) plus(me); }
    else if (kind === 'saved-searches') { fields.query = text(data.query, 500, true); searchQuery(fields.query, fail); }
    else { if (!data.style || typeof data.style !== 'object' || Array.isArray(data.style)) fail(400, 'Choose a profile style.'); fields.style = style(data.style); }
    const next = item || { id: randomUUID(), revision: -1 }; Object.assign(next, fields, { revision: next.revision + 1 }); if (!item) list.push(next); return changed(me, res, next, item ? 200 : 201);
  }
  const expirySignature = user => [user.customStatusExpiresAt && user.customStatusExpiresAt > Date.now() ? user.customStatusExpiresAt : 0, user.focusUntil > Date.now() ? user.focusUntil : 0].join(':');
  let expiries = new Map(state.users.map(u => [u.id, expirySignature(u)]));
  const timer = setInterval(() => { const next = new Map(state.users.map(u => [u.id, expirySignature(u)])); if ([...next].some(([id, value]) => expiries.has(id) && expiries.get(id) !== value)) refresh(); expiries = next; }, 5000); timer.unref();
  return { handle, snapshot, close: () => clearInterval(timer) };
}
