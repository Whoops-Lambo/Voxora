import { createHash, randomUUID } from 'node:crypto';
import { premiumPerks } from './premium.js';
import { isSuspended } from './platform.js';
import { serverPermissions } from './public/permissions.js';

export function forumSettings(value, fail, previous = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['tags', 'requireTag', 'version'].includes(k))) fail(400, 'Invalid forum settings.');
  const tags = value.tags ?? [], names = new Set(), ids = new Set();
  if (!Array.isArray(tags) || tags.length > 20 || value.requireTag !== undefined && typeof value.requireTag !== 'boolean') fail(400, 'Use up to 20 forum tags and a valid tag requirement.');
  const normalized = tags.map(tag => {
    if (!tag || typeof tag.name !== 'string' || !tag.name.trim() || tag.name.trim().length > 24 || Object.keys(tag).some(k => !['id','name','color'].includes(k))) fail(400, 'Tag names must contain 1–24 characters.');
    const name = tag.name.trim(), key = name.toLowerCase();
    if (names.has(key)) fail(400, 'Forum tag names must be unique.'); names.add(key);
    if (tag.id !== undefined && !previous?.tags.some(t => t.id === tag.id)) fail(400, 'A tag no longer exists in this forum.');
    const id = tag.id ?? randomUUID(); if (ids.has(id)) fail(400, 'A tag can appear only once.'); ids.add(id);
    const color = tag.color ?? '#5865f2'; if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) fail(400, 'Choose a valid tag color.');
    return { id, name, color };
  });
  if (value.requireTag && !normalized.length) fail(400, 'Add at least one tag before requiring tags.');
  return { version: previous ? previous.version + 1 : 0, tags: normalized, requireTag: !!value.requireTag };
}

export function forumService({ state, body, json, fail, save, management, serverFor, canRead, canChannel, messageView, channelEvent, createMessage, collaboration, expressions, moderation }) {
  const channel = id => serverFor(id)?.channels.find(c => c.id === id);
  const threadFor = m => state.threads.find(t => t.parentId === m.id);
  function title(value) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) fail(400, 'Post titles must contain 1–80 characters.'); return value.trim(); }
  function tags(c, value) {
    if (!Array.isArray(value) || value.length > 5 || new Set(value).size !== value.length || value.some(id => !c.forum.tags.some(t => t.id === id))) fail(400, 'Choose up to five tags from this forum.');
    if (c.forum.requireTag && !value.length) fail(400, 'Choose at least one tag for this post.');
    return [...value];
  }
  function prepare(me, d) {
    const c = channel(d.channel);
    if (!c?.forum) { if (d.forumPost !== undefined) fail(400, 'This channel is not a forum.'); return null; }
    if (!d.forumPost || typeof d.forumPost !== 'object' || Array.isArray(d.forumPost) || Object.keys(d.forumPost).some(k => !['title','tagIds'].includes(k))) fail(400, 'Create a titled forum post instead of sending a channel message.');
    if (!canChannel(me, c.id, 'createThreads')) fail(403, 'You need Create Threads to create forum posts.');
    if (d.poll !== undefined || d.replyTo) fail(400, 'Use threaded replies inside a forum post.');
    if (state.threads.filter(t => t.serverId === serverFor(c.id).id).length >= 1000) fail(400, 'This server has reached its 1,000-thread limit.');
    const name = title(d.forumPost.title); expressions.validateText(name, c.id);
    return { title: name, tagIds: tags(c, d.forumPost.tagIds ?? []) };
  }
  function attach(me, m, draft) {
    if (!draft) return;
    m.forumPost = { tagIds: draft.tagIds };
    const s = serverFor(m.channel);
    state.threads.push({ id: randomUUID(), parentId: m.id, channelId: m.channel, serverId: s.id, name: draft.title, creatorId: me.id, createdAt: m.time, lastActivityAt: m.time, archived: false, locked: false });
    management.log(s, me, 'Forum post created', draft.title);
  }
  const titleFor = m => m.forumPost ? threadFor(m)?.name || '' : '';
  const moderationText = (m, text = m.text, name = titleFor(m)) => m.forumPost ? name + '\n' + text : text;
  function revision(m, c, t) { return createHash('sha256').update(JSON.stringify([m.id, m.text, m.editedAt, m.pinned, m.forumPost.tagIds, t.name, t.archived, t.locked, c.forum.version])).digest('hex').slice(0, 24); }
  function view(m, me) {
    const c = channel(m.channel), t = threadFor(m), own = m.authorId === me.id && canChannel(me, c.id, 'sendMessages');
    const manager = canChannel(me, c.id, 'manageThreads'), moderator = canChannel(me, c.id, 'manageMessages');
    const thread = collaboration.viewThread(t, me);
    const cursor = me.readState?.[c.id]?.sequence ?? me.readBaseline ?? 0;
    return { message: messageView(m), thread, title: t.name, tags: c.forum.tags.filter(tag => m.forumPost.tagIds.includes(tag.id)), revision: revision(m,c,t), unread: m.authorId !== me.id && m.sequence > cursor || thread.unreadCount > 0, canEditText: own, canEditTitle: manager || own && !t.locked, canEditTags: own || manager || moderator, canPin: moderator, canDelete: m.authorId === me.id || moderator };
  }
  function validateTitleEdit(t, me, name) {
    const m = state.messages.find(m => m.id === t.parentId); if (!m?.forumPost) return;
    const next = title(name); expressions.validateText(next, m.channel);
    const decision = moderation.inspect(me, m.channel, moderationText(m, m.text, next), { operation: 'edit', messageId: m.id });
    return { message: m, decision, content: moderationText(m,m.text,next) };
  }
  async function handle(req,res,url,me,options = {}) {
    const route = options.bot ? url.pathname.replace(/^\/api\/bot\//,'/api/') : url.pathname;
    const match = route.match(/^\/api\/forums\/([\w-]+)(?:\/(posts))?$/), post = route.match(/^\/api\/forum-posts\/([\w-]+)$/);
    if (!match && !post) return false;
    const method = req.method, d = options.data ?? (['POST','PATCH'].includes(method) ? await body(req) : {});
    if (isSuspended(me)) fail(403, 'This account is suspended.');
    const m = post && state.messages.find(m => m.id === post[1] && m.forumPost), c = channel(match ? match[1] : m?.channel);
    if (!c?.forum || !canRead(me,c.id)) fail(404, 'Forum or post not found.');
    options.authorize?.(c.id, 'viewChannel');
    const s = serverFor(c.id), t = m && threadFor(m);
    if (post && !t) fail(404, 'Forum post not found.');
    if (match && !match[2]) {
      if (method === 'GET') { json(res,200,{ channelId:c.id, ...c.forum, canManage: !options.bot && serverPermissions(s,me.id).includes('manageChannels') }); return true; }
      if (method !== 'PATCH') fail(405, 'Method not allowed.');
      if (options.bot) fail(403, 'Only human channel managers can configure forums.');
      management.requirePermission(s,me,'manageChannels');
      if (d.version !== c.forum.version) fail(409, 'Forum settings changed. Reopen settings and try again.');
      c.forum = forumSettings(d,fail,c.forum); management.log(s,me,'Forum settings updated',c.name); await management.commit(s); json(res,200,c.forum); return true;
    }
    if (match && method === 'POST') {
      if(Object.keys(d).some(k=>!['title','text','tagIds','files'].includes(k)))fail(400,'Invalid forum post fields.');
      options.authorize?.(c.id,'sendMessages'); options.authorize?.(c.id,'createThreads'); if(d.files?.length)options.authorize?.(c.id,'attachFiles'); options.post?.();
      const result = await createMessage(me,{ channel:c.id, text:d.text, files:d.files, forumPost:{title:d.title,tagIds:d.tagIds} });
      json(res,201,view(state.messages.find(m=>m.id===result.id),me)); return true;
    }
    if (match && method === 'GET') {
      options.authorize?.(c.id,'viewChannel');
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const sort = url.searchParams.get('sort') || 'active', archived = url.searchParams.get('archived') || '0', tagIds = url.searchParams.getAll('tag');
      const offset = Number(url.searchParams.get('offset') || 0), unreadOnly = url.searchParams.get('unread') === '1';
      if (q.length > 100 || !['active','newest','oldest','replies'].includes(sort) || !['0','1','all'].includes(archived) || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || tagIds.length > 5 || tagIds.some(id=>!c.forum.tags.some(t=>t.id===id))) fail(400, 'Invalid forum search or page.');
      const threads = new Map(state.threads.filter(t=>t.channelId===c.id).map(t=>[t.parentId,t]));
      const counts = new Map(); for (const r of state.threadMessages) if(r.channel===c.id)counts.set(r.threadId,(counts.get(r.threadId)||0)+1);
      let list = state.messages.filter(m=>m.channel===c.id && m.forumPost && threads.has(m.id));
      list = list.filter(m=>{const t=threads.get(m.id);return (archived==='all'||t.archived===(archived==='1')) && tagIds.every(id=>m.forumPost.tagIds.includes(id)) && (t.name+' '+m.text).toLowerCase().includes(q) && (!unreadOnly || view(m,me).unread);});
      const rank = m => sort==='newest'||sort==='oldest' ? m.time : sort==='replies' ? counts.get(threads.get(m.id).id)||0 : threads.get(m.id).lastActivityAt;
      list.sort((a,b)=>Number(b.pinned)-Number(a.pinned) || (sort==='oldest'?rank(a)-rank(b):rank(b)-rank(a)) || b.sequence-a.sequence);
      json(res,200,{ channel:{id:c.id,name:c.name,topic:c.topic,forum:c.forum}, posts:list.slice(offset,offset+20).map(m=>view(m,me)), total:list.length, offset, hasMore:offset+20<list.length }); return true;
    }
    if (post && method === 'GET') { options.authorize?.(c.id,'viewChannel'); json(res,200,view(m,me)); return true; }
    if (!post || method !== 'PATCH') fail(405, 'Method not allowed.');
    if (d.revision !== revision(m,c,t)) fail(409, 'This post changed. Reopen it before saving your changes.');
    if (Object.keys(d).some(k=>!['revision','title','text','tagIds','pinned'].includes(k)) || Object.keys(d).length<2) fail(400,'Invalid post changes.');
    const current = view(m,me), patch = {}, nextTitle = d.title === undefined ? t.name : title(d.title);
    if (d.title !== undefined) { if(!current.canEditTitle)fail(403,'You cannot rename this post.'); options.authorize?.(c.id,m.authorId===me.id&&!t.locked?'sendMessages':'manageThreads'); }
    if (d.text !== undefined) {
      if(!current.canEditText)fail(403,'You can only edit your own post content.'); options.authorize?.(c.id,'sendMessages');
      if(typeof d.text!=='string'||d.text.length>premiumPerks(me).messageCharacters||!d.text.trim()&&!m.files.length)fail(400,'Enter post content within your current plan’s limit.');
      patch.text=d.text.trim();
    }
    let nextTags;
    if(d.tagIds!==undefined){if(!current.canEditTags)fail(403,'You cannot edit these tags.');options.authorize?.(c.id,m.authorId===me.id&&canChannel(me,c.id,'sendMessages')?'sendMessages':canChannel(me,c.id,'manageMessages')?'manageMessages':'manageThreads');nextTags=tags(c,d.tagIds);}
    if(d.pinned!==undefined){if(!current.canPin)fail(403,'You need Manage Messages to pin forum posts.');options.authorize?.(c.id,'manageMessages');if(typeof d.pinned!=='boolean')fail(400,'Invalid pin setting.');patch.pinned=d.pinned;}
    let decision;
    if(d.title!==undefined||d.text!==undefined){
      expressions.validateText(nextTitle,c.id);expressions.validateText(patch.text??m.text,c.id);
      decision=moderation.inspect(me,c.id,moderationText(m,patch.text??m.text,nextTitle),{operation:'edit',messageId:m.id});
      if(decision?.blocked)await moderation.reject(me,decision,{...m,text:moderationText(m,patch.text??m.text,nextTitle)});
      patch.editedAt=Date.now();
    }
    Object.assign(m,patch);if(nextTags)m.forumPost.tagIds=nextTags;t.name=nextTitle;
    moderation.accept(me,m,decision); if(d.pinned!==undefined)management.log(s,me,d.pinned?'Forum post pinned':'Forum post unpinned',t.name);
    await save();moderation.notify(decision);channelEvent(c.id,{type:'message-update',message:messageView(m)});json(res,200,view(m,me));return true;
  }
  return { prepare, attach, titleFor, moderationText, validateTitleEdit, handle };
}
