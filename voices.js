import { randomUUID } from 'node:crypto';
import { activePremium } from './premium.js';
import { isSuspended } from './platform.js';
import { serverPermissions, timedOut, screeningPending, activeLockdown, outranks } from './public/permissions.js';

export function voicesService({ state, body, json, fail, save, refresh, rate, canRead, canChannel, userById, publicUser, management, moderate }) {
  state.communityProfiles ||= [];
  state.suggestions ||= [];
  const statuses = ['open', 'planned', 'in-progress', 'completed', 'declined'];
  const categories = ['idea', 'feature', 'bug', 'community'];
  const human = u => !!u && !u.bot && !isSuspended(u);
  const blocked = (a, b) => a?.blocked?.includes(b?.id) || b?.blocked?.includes(a?.id);
  const keys = (d, allowed) => { if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).some(k => !allowed.includes(k))) fail(400, 'Unsupported community field.'); };
  const text = (v, max, required = false) => {
    if (typeof v !== 'string' || v.length > max || required && !v.trim() || /[\p{Cc}\p{Cf}]/u.test(v.replace(/[\r\n\t]/g, ''))) fail(400, 'Use ' + (required ? 'nonempty ' : '') + 'text up to ' + max + ' characters.');
    return v.trim();
  };
  const version = (item, d) => { if (!Number.isSafeInteger(d.revision) || d.revision !== item.revision) fail(409, 'This changed. Refresh before saving.'); };
  const deletion = (item, url) => { if (!url.searchParams.has('revision')) fail(409, 'Refresh before deleting.'); version(item, { revision: Number(url.searchParams.get('revision')) }); };
  const server = (id, me) => { const s = state.servers.find(s => s.id === id && s.members.includes(me.id)); if (!s) fail(404, 'Community not found.'); return s; };
  const participant = (s, u) => human(u) && s.members.includes(u.id) && !timedOut(s, u.id) && !screeningPending(s, u.id);
  const name = (s, id) => s.members.includes(id) ? s.nicknames[id] || userById(id)?.displayName || 'Member' : 'Former member';
  const readable = (s, t, u) => human(u) && s.members.includes(u.id) && canRead(u, t.channelId) && !blocked(u, userById(t.authorId));
  const manager = (t, u) => canChannel(u, t.channelId, 'manageSuggestions');
  function writable(s, t, u) {
    if (!state.servers.includes(s) || !participant(s, u) || !canChannel(u, t.channelId, 'sendMessages') || !canChannel(u, t.channelId, 'createSuggestions')) fail(403, 'You need Send Messages and Create Suggestions, and must complete onboarding and any timeout.');
  }
  function channel(s, id, me) {
    if (!s.channels.some(c => c.id === id && c.type === 'text') || !canRead(me, id)) fail(403, 'Choose a text channel you can view.');
  }
  const eligibleVote = (s, t, id) => participant(s, userById(id)) && readable(s, t, userById(id)) && canChannel(userById(id), t.channelId, 'createSuggestions') && canChannel(userById(id), t.channelId, 'sendMessages');
  const author = (s, id) => ({ id: s.members.includes(id) && human(userById(id)) ? id : null, name: name(s, id) });
  function suggestionView(s, t, me, detail = false) {
    const canManage = manager(t, me), votes = t.voterIds.filter(id => eligibleVote(s, t, id) && !blocked(me, userById(id))).length;
    const comments = t.comments.filter(c => !blocked(me, userById(c.authorId)));
    const result = { id: t.id, serverId: s.id, channelId: t.channelId, title: t.title, description: t.description, category: t.category, status: t.status, pinned: t.pinned, locked: t.locked, archived: t.archived, revision: t.revision, createdAt: t.createdAt, updatedAt: t.updatedAt, author: author(s, t.authorId), votes, voted: t.voterIds.includes(me.id), watching: t.watcherIds.includes(me.id), commentCount: comments.length, response: t.response, canManage, canEdit: canManage || me.id === t.authorId, canVote: participant(s, me) && canChannel(me, t.channelId, 'sendMessages') && canChannel(me, t.channelId, 'createSuggestions'), canParticipate: participant(s, me) && canChannel(me, t.channelId, 'sendMessages') && canChannel(me, t.channelId, 'createSuggestions') && !t.archived && !t.locked };
    if (detail) {
      result.comments = comments.map(c => ({ id: c.id, text: c.text, author: author(s, c.authorId), createdAt: c.createdAt, editedAt: c.editedAt || null, revision: c.revision, canEdit: c.authorId === me.id && !t.locked && !t.archived, canDelete: c.authorId === me.id || canManage || canChannel(me, t.channelId, 'manageMessages') }));
      result.history = t.history.map(e => ({ action: e.action, time: e.time, actor: author(s, e.actorId) }));
    }
    return result;
  }
  function record(s, t, me, action) {
    t.updatedAt = Date.now();
    t.history.push({ action, time: t.updatedAt, actorId: me.id });
    t.history = t.history.slice(-50);
    for (const id of new Set([t.authorId, ...t.watcherIds])) {
      const u = userById(id);
      if (id === me.id || !readable(s, t, u) || blocked(me, u)) continue;
      u.voicesInbox ||= { revision: 0, items: [] };
      u.voicesInbox.items.push({ id: randomUUID(), serverId: s.id, suggestionId: t.id, action, time: t.updatedAt, read: false });
      u.voicesInbox.items = u.voicesInbox.items.slice(-100);
      u.voicesInbox.revision++;
    }
  }
  const commit = async (res, value, status = 200) => { await save(); refresh(); json(res, status, value); return true; };
  function inbox(me) {
    const store = me.voicesInbox || { revision: 0, items: [] };
    const items = store.items.flatMap(i => {
      const s = state.servers.find(s => s.id === i.serverId), t = state.suggestions.find(t => t.id === i.suggestionId);
      return s && t && readable(s, t, me) ? [{ ...i, title: t.title, status: t.status }] : [];
    }).reverse();
    return { revision: store.revision, items, unread: items.filter(i => !i.read).length };
  }
  const defaultStyle = () => ({ accent: '#55e6bc', bannerStart: '#142332', bannerEnd: '#123d39', headline: '', links: [], pattern: 'none', communityTitle: '' });
  function profileView(s, target, me, own = false) {
    const p = state.communityProfiles.find(p => p.serverId === s.id && p.userId === target.id);
    const basic = { bio: p?.bio || '', pronouns: p?.pronouns || '', interests: p?.interests || [], lookingForGroup: p?.lookingForGroup || false, availability: p?.availability || 'ask' };
    const style = activePremium(target) ? { ...defaultStyle(), ...p?.style } : defaultStyle();
    const u = publicUser(target);
    return { userId: target.id, serverId: s.id, name: name(s, target.id), username: target.username, avatarUrl: u.avatarUrl, color: u.color, status: u.status, timeZone: u.timeZone, roles: (s.memberRoles[target.id] || []).map(id => s.roles.find(r => r.id === id)).filter(Boolean).map(r => ({ id: r.id, name: r.name, color: r.color })), revision: p?.revision || 0, ...basic, style, plusStyle: activePremium(target), canReset: me.id === target.id || serverPermissions(s, me.id).includes('manageNicknames') && outranks(s, me.id, target.id), ...(own ? { storedStyle: { ...defaultStyle(), ...p?.style } } : {}) };
  }
  function profileFields(d, old, me) {
    const next = {};
    for (const [key, max] of [['bio', 1000], ['pronouns', 40]]) if (d[key] !== undefined) next[key] = text(d[key], max);
    if (d.interests !== undefined) {
      if (!Array.isArray(d.interests) || d.interests.length > 8) fail(400, 'Choose up to eight interests.');
      next.interests = [...new Set(d.interests.map(t => text(t, 24, true).toLowerCase()))];
    }
    if (d.lookingForGroup !== undefined) { if (typeof d.lookingForGroup !== 'boolean') fail(400, 'Choose whether you are looking for a group.'); next.lookingForGroup = d.lookingForGroup; }
    if (d.availability !== undefined) { if (!['ask', 'open', 'busy'].includes(d.availability)) fail(400, 'Choose a valid availability.'); next.availability = d.availability; }
    if (d.style !== undefined) {
      if (!activePremium(me)) fail(403, 'Voxora Plus is required to save server profile styles.');
      keys(d.style, ['accent', 'bannerStart', 'bannerEnd', 'headline', 'links', 'pattern', 'communityTitle']);
      const style = { ...defaultStyle(), ...old?.style, ...d.style };
      for (const key of ['accent', 'bannerStart', 'bannerEnd']) if (!/^#[a-f0-9]{6}$/i.test(style[key])) fail(400, 'Choose valid profile colors.');
      style.headline = text(style.headline, 100); style.communityTitle = text(style.communityTitle, 40);
      if (!['none', 'dots', 'grid', 'diagonal'].includes(style.pattern)) fail(400, 'Choose a valid banner pattern.');
      if (!Array.isArray(style.links) || style.links.length > 4) fail(400, 'Use up to four profile links.');
      style.links = style.links.map(link => {
        keys(link, ['label', 'url']); const label = text(link.label, 40, true); let url;
        try { url = new URL(text(link.url, 2048, true)); } catch { fail(400, 'Use a complete HTTP or HTTPS link.'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail(400, 'Use HTTP or HTTPS without embedded credentials.');
        return { label, url: url.href };
      });
      next.style = style;
    }
    return next;
  }
  async function handle(req, res, url, me) {
    const updates = url.pathname === '/api/me/community-updates';
    const route = url.pathname.match(/^\/api\/servers\/([\w-]+)\/voices\/(profiles|suggestions)(?:\/([\w-]+)(?:\/(vote|watch|comments|moderation)(?:\/([\w-]+))?)?)?$/);
    if (!updates && !route) return false;
    if (!human(me)) fail(403, 'Community Voices requires an active human account.');
    const method = req.method, d = ['POST', 'PATCH'].includes(method) ? await body(req) : {};
    if (!human(me)) fail(403, 'This account is no longer active.');
    if (updates) {
      if (method === 'GET') { json(res, 200, inbox(me)); return true; }
      if (method !== 'POST') fail(405, 'Method not allowed.');
      keys(d, ['revision']); version(me.voicesInbox || { revision: 0 }, d);
      me.voicesInbox ||= { revision: 0, items: [] }; for (const item of me.voicesInbox.items) item.read = true; me.voicesInbox.revision++;
      return commit(res, inbox(me));
    }
    const [, sid, kind, id, action, commentId] = route, s = server(sid, me);
    if (kind === 'profiles') {
      if (action) fail(404, 'Profile action not found.');
      if (!id && method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase(), role = url.searchParams.get('role') || '', interest = url.searchParams.get('interest') || '', presence = url.searchParams.get('presence') || 'all', lfg = url.searchParams.get('lfg') || '0', sort = url.searchParams.get('sort') || 'name', offset = Number(url.searchParams.get('offset') || 0);
        if (q.length > 100 || role && !s.roles.some(r => r.id === role) || !['all', 'online', 'offline'].includes(presence) || !['0', '1'].includes(lfg) || !['name', 'available'].includes(sort) || !Number.isSafeInteger(offset) || offset < 0 || interest.length > 24) fail(400, 'Invalid directory filter.');
        const all = s.members.map(userById).filter(u => human(u) && !blocked(me, u)).map(u => profileView(s, u, me));
        const tags = [...new Set(all.flatMap(p => p.interests))].sort();
        const items = all.filter(p => (!q || (p.name + ' ' + p.username + ' ' + p.bio + ' ' + p.interests.join(' ')).toLowerCase().includes(q)) && (!role || role === 'everyone' || p.roles.some(r => r.id === role)) && (!interest || p.interests.includes(interest)) && (presence === 'all' || (presence === 'online' ? p.status !== 'offline' : p.status === 'offline')) && (lfg === '0' || p.lookingForGroup)).sort((a, b) => (sort === 'available' ? Number(b.availability === 'open') - Number(a.availability === 'open') : 0) || a.name.localeCompare(b.name));
        json(res, 200, { items: items.slice(offset, offset + 30), total: items.length, hasMore: offset + 30 < items.length, interests: tags, roles: s.roles.map(r => ({ id: r.id, name: r.name })) }); return true;
      }
      const target = userById(id === 'me' ? me.id : id);
      if (!target || !human(target) || !s.members.includes(target.id) || blocked(me, target)) fail(404, 'Server profile not found.');
      const old = state.communityProfiles.find(p => p.serverId === sid && p.userId === target.id);
      if (method === 'GET') { json(res, 200, profileView(s, target, me, target.id === me.id)); return true; }
      if (method === 'DELETE') {
        deletion(old || { revision: 0 }, url);
        if (target.id !== me.id && (!serverPermissions(s, me.id).includes('manageNicknames') || !outranks(s, me.id, target.id))) fail(403, 'You can reset only your profile or a lower-ranked member with Manage Nicknames.');
        if (old) { const revision = old.revision + 1; Object.keys(old).forEach(k => delete old[k]); Object.assign(old, { serverId: sid, userId: target.id, revision }); }
        management.log(s, me, 'Server profile reset', target.id);
        return commit(res, profileView(s, target, me, target.id === me.id));
      }
      if (method !== 'PATCH' || target.id !== me.id) fail(403, 'Only the member can edit their server profile.');
      keys(d, ['revision', 'bio', 'pronouns', 'interests', 'lookingForGroup', 'availability', 'style']); version(old || { revision: 0 }, d);
      if (!participant(s, me) || activeLockdown(s)?.pauseChat && !serverPermissions(s, me.id).includes('manageServer')) fail(403, 'Complete onboarding and wait until restrictions end before editing a profile.');
      const next = profileFields(d, old, me);
      if (!old && state.communityProfiles.length >= 100000) fail(400, 'The profile storage limit has been reached.');
      const p = old || { serverId: sid, userId: me.id, revision: 0 }; Object.assign(p, next, { revision: p.revision + 1 }); if (!old) state.communityProfiles.push(p);
      return commit(res, profileView(s, me, me, true));
    }
    const list = state.suggestions.filter(t => t.serverId === sid && readable(s, t, me));
    if (!id && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase(), status = url.searchParams.get('status') || 'all', category = url.searchParams.get('category') || 'all', cid = url.searchParams.get('channel') || '', mine = url.searchParams.get('mine') || '0', watched = url.searchParams.get('watched') || '0', archived = url.searchParams.get('archived') || '0', sort = url.searchParams.get('sort') || 'top', offset = Number(url.searchParams.get('offset') || 0);
      if (q.length > 100 || !['all', ...statuses].includes(status) || !['all', ...categories].includes(category) || !['0', '1'].includes(mine) || !['0', '1'].includes(watched) || !['0', '1'].includes(archived) || !['top', 'recent', 'updated'].includes(sort) || !Number.isSafeInteger(offset) || offset < 0) fail(400, 'Invalid suggestion filter.');
      if (cid) channel(s, cid, me);
      const items = list.filter(t => (archived === '1' || !t.archived) && (status === 'all' || t.status === status) && (category === 'all' || t.category === category) && (!cid || t.channelId === cid) && (mine === '0' || t.authorId === me.id) && (watched === '0' || t.watcherIds.includes(me.id)) && (!q || (t.title + ' ' + t.description).toLowerCase().includes(q))).map(t => suggestionView(s, t, me)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (sort === 'top' ? b.votes - a.votes : sort === 'recent' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id));
      json(res, 200, { items: items.slice(offset, offset + 30), total: items.length, hasMore: offset + 30 < items.length, channels: s.channels.filter(c => c.type === 'text' && canRead(me, c.id)).map(c => ({ id: c.id, name: c.name, canCreate: participant(s, me) && canChannel(me, c.id, 'createSuggestions') && canChannel(me, c.id, 'sendMessages') })) }); return true;
    }
    if (!id && method === 'POST') {
      keys(d, ['title', 'description', 'category', 'channelId', 'nonce']); channel(s, d.channelId, me);
      const title = text(d.title, 120, true), description = text(d.description || '', 4000), category = d.category || 'idea';
      if (!categories.includes(category) || typeof d.nonce !== 'string' || !/^[a-f0-9-]{36}$/i.test(d.nonce)) fail(400, 'Choose a category and valid request identifier.');
      const request = JSON.stringify([title, description, category, d.channelId]);
      const duplicate = state.suggestions.find(t => t.serverId === sid && t.authorId === me.id && t.nonce === d.nonce);
      if (duplicate) { if (duplicate.request !== request || !readable(s, duplicate, me)) fail(409, 'That request identifier was already used.'); json(res, 200, suggestionView(s, duplicate, me, true)); return true; }
      const t = { id: randomUUID(), serverId: sid, channelId: d.channelId, title, description, category, authorId: me.id, status: 'open', response: '', pinned: false, locked: false, archived: false, voterIds: [], watcherIds: [], comments: [], history: [], revision: 0, nonce: d.nonce, request, createdAt: Date.now(), updatedAt: Date.now() };
      writable(s, t, me); if (state.suggestions.length >= 50000 || state.suggestions.filter(t => t.serverId === sid).length >= 1000) fail(400, 'This server has reached 1,000 suggestions. Remove old entries first.');
      rate('suggestion-create:' + me.id, 5, 3600000); await moderate(me, t.channelId, title + '\n' + description); writable(s, t, me);
      const retry = state.suggestions.find(item => item.serverId === sid && item.authorId === me.id && item.nonce === d.nonce);
      if (retry) { if (retry.request !== request || !readable(s, retry, me)) fail(409, 'That request identifier was already used.'); json(res, 200, suggestionView(s, retry, me, true)); return true; }
      state.suggestions.push(t); record(s, t, me, 'Suggestion created'); management.log(s, me, 'Suggestion created', t.id);
      return commit(res, suggestionView(s, t, me, true), 201);
    }
    const t = list.find(t => t.id === id); if (!t) fail(404, 'Suggestion not found.');
    if (!action && method === 'GET') { json(res, 200, suggestionView(s, t, me, true)); return true; }
    if (!action && method === 'PATCH') {
      keys(d, ['revision', 'title', 'description', 'category']); version(t, d); writable(s, t, me);
      if (t.archived || t.locked || t.authorId !== me.id && !manager(t, me)) fail(403, 'Only the author or a suggestion manager can edit an unlocked active suggestion.');
      const next = { title: d.title === undefined ? t.title : text(d.title, 120, true), description: d.description === undefined ? t.description : text(d.description, 4000), category: d.category || t.category };
      if (!categories.includes(next.category)) fail(400, 'Choose a valid category.');
      await moderate(me, t.channelId, next.title + '\n' + next.description, 'edit'); version(t, d); writable(s, t, me);
      if (!state.suggestions.includes(t) || !readable(s, t, me)) fail(404, 'Suggestion not found.');
      if (t.authorId !== me.id && !manager(t, me)) fail(403, 'Your suggestion management access changed.');
      if (t.archived || t.locked) fail(409, 'This suggestion was closed while you edited it.');
      Object.assign(t, next); t.revision++; record(s, t, me, 'Suggestion edited'); return commit(res, suggestionView(s, t, me, true));
    }
    if (!action && method === 'DELETE') {
      deletion(t, url);
      if (t.authorId !== me.id && !manager(t, me)) fail(403, 'Only the author or a suggestion manager can delete this.');
      state.suggestions = state.suggestions.filter(item => item !== t); management.log(s, me, 'Suggestion deleted', t.id); return commit(res, { ok: true });
    }
    if (action === 'vote' && method === 'POST') {
      keys(d, ['voted']); if (typeof d.voted !== 'boolean') fail(400, 'Choose whether to vote.'); writable(s, t, me);
      if (d.voted && (t.locked || t.archived || ['completed', 'declined'].includes(t.status))) fail(409, 'Voting is closed for this suggestion.');
      if (d.voted && !t.voterIds.includes(me.id)) t.voterIds.push(me.id); else if (!d.voted) t.voterIds = t.voterIds.filter(id => id !== me.id);
      return commit(res, suggestionView(s, t, me, true));
    }
    if (action === 'watch' && method === 'POST') {
      keys(d, ['watching']); if (typeof d.watching !== 'boolean') fail(400, 'Choose whether to watch.');
      if (d.watching && !t.watcherIds.includes(me.id)) { if (t.watcherIds.length >= 1000) fail(400, 'This suggestion has reached its watcher limit.'); t.watcherIds.push(me.id); } else if (!d.watching) t.watcherIds = t.watcherIds.filter(id => id !== me.id);
      return commit(res, suggestionView(s, t, me, true));
    }
    if (action === 'moderation' && method === 'PATCH') {
      keys(d, ['revision', 'status', 'response', 'pinned', 'locked', 'archived']); version(t, d);
      if (!manager(t, me)) fail(403, 'You need Manage Suggestions in this channel.');
      const next = {}; if (d.status !== undefined) { if (!statuses.includes(d.status)) fail(400, 'Choose a valid roadmap status.'); next.status = d.status; }
      if (d.response !== undefined) next.response = text(d.response, 2000);
      for (const key of ['pinned', 'locked', 'archived']) if (d[key] !== undefined) { if (typeof d[key] !== 'boolean') fail(400, 'Choose a valid moderation option.'); next[key] = d[key]; }
      await moderate(me, t.channelId, next.response || '', 'edit'); version(t, d); if (!state.suggestions.includes(t) || !readable(s, t, me)) fail(404, 'Suggestion not found.'); if (!manager(t, me)) fail(403, 'Your suggestion management access changed.');
      Object.assign(t, next); t.revision++; record(s, t, me, 'Roadmap / official response updated'); management.log(s, me, 'Suggestion moderated', t.id);
      return commit(res, suggestionView(s, t, me, true));
    }
    if (action === 'comments') {
      const c = t.comments.find(c => c.id === commentId);
      if (commentId && !c) fail(404, 'Comment not found.');
      if (commentId && method === 'DELETE') {
        deletion(c, url); if (c.authorId !== me.id && !manager(t, me) && !canChannel(me, t.channelId, 'manageMessages')) fail(403, 'You cannot remove this comment.');
        t.comments = t.comments.filter(item => item !== c); record(s, t, me, 'Comment removed'); management.log(s, me, 'Suggestion comment deleted', c.id); return commit(res, { ok: true });
      }
      if (!commentId && method === 'POST' || commentId && method === 'PATCH') {
        keys(d, commentId ? ['revision', 'text'] : ['nonce', 'text']); writable(s, t, me);
        if (t.locked || t.archived) fail(409, 'Discussion is closed.');
        const value = text(d.text, 2000, true);
        if (c) { if (c.authorId !== me.id) fail(403, 'Only the comment author can edit it.'); version(c, d); }
        else {
          if (typeof d.nonce !== 'string' || !/^[a-f0-9-]{36}$/i.test(d.nonce)) fail(400, 'Use a valid comment request identifier.');
          const duplicate = t.comments.find(c => c.authorId === me.id && c.nonce === d.nonce);
          if (duplicate) { if (duplicate.text !== value) fail(409, 'That comment request identifier was already used.'); json(res, 200, suggestionView(s, t, me, true)); return true; }
          if (t.comments.length >= 200) fail(400, 'This discussion has reached 200 comments.');
        }
        rate('suggestion-comment:' + me.id, 20, 60000); await moderate(me, t.channelId, value, c ? 'edit' : 'create'); writable(s, t, me);
        if (!state.suggestions.includes(t) || !readable(s, t, me)) fail(404, 'Suggestion not found.');
        if (c && !t.comments.includes(c)) fail(409, 'This comment was removed.');
        if (!c) { const retry = t.comments.find(item => item.authorId === me.id && item.nonce === d.nonce); if (retry) { if (retry.text !== value) fail(409, 'That comment request identifier was already used.'); json(res, 200, suggestionView(s, t, me, true)); return true; } }
        if (t.locked || t.archived) fail(409, 'Discussion closed while you wrote.');
        if (c) { version(c, d); c.text = value; c.revision++; c.editedAt = Date.now(); }
        else t.comments.push({ id: randomUUID(), authorId: me.id, text: value, nonce: d.nonce, createdAt: Date.now(), revision: 0 });
        record(s, t, me, c ? 'Comment edited' : 'Comment added'); return commit(res, suggestionView(s, t, me, true), c ? 200 : 201);
      }
    }
    fail(405, 'Method not allowed.');
  }
  return { handle, home: me => ({ unread: inbox(me).unread }) };
}
