import { randomUUID } from "node:crypto";
import { isSuspended } from "./platform.js";

export function initializeConversationUser(user) { user.savedItems ||= []; user.threadReadState ||= {}; }
export function initializeConversations(state) {
  state.threads ||= []; state.threadMessages ||= []; state.threadMessageSequence ||= 0;
  for (const u of state.users) initializeConversationUser(u);
}
export function conversationService({ state, body, json, fail, save, refresh, notifyUser, canRead, canChannel, serverFor, userById, messageView, channelEvent, expressions, checkSlowmode, management, cleanupFiles }) {
  const title = (value) => { if (typeof value !== "string" || !value.trim() || value.length > 80) fail(400, "Use a thread name of 1–80 characters."); return value.trim(); };
  const note = (value) => { if (typeof value !== "string" || value.length > 500) fail(400, "Notes can have up to 500 characters."); return value; };
  const replies = (id) => state.threadMessages.filter((m) => m.threadId === id);
  function summary(parentId) {
    const t = state.threads.find((t) => t.parentId === parentId); if (!t) return undefined;
    return { id: t.id, name: t.name, replyCount: replies(t.id).length, archived: t.archived, locked: t.locked, lastActivityAt: t.lastActivityAt };
  }
  const parent = (t) => state.messages.find((m) => m.id === t.parentId && m.channel === t.channelId);
  function readable(t, me) { return !!(t && parent(t) && !isSuspended(me) && canRead(me, t.channelId)); }
  function getThread(id, me, options = {}) {
    const t = state.threads.find((t) => t.id === id); if (!readable(t, me)) fail(404, "Thread not found.");
    options.authorize?.(t.channelId, "viewChannel"); return t;
  }
  function threadView(t, me) {
    const list = replies(t.id), through = me.threadReadState?.[t.id] || 0;
    const manager = canChannel(me, t.channelId, "manageThreads"), creator = t.creatorId === me.id && canChannel(me, t.channelId, "sendMessages");
    return { ...summary(t.parentId), parentId: t.parentId, channelId: t.channelId, serverId: t.serverId, creatorId: t.creatorId, createdAt: t.createdAt, readSequence: through, unreadCount: list.filter((m) => m.authorId !== me.id && m.sequence > through).length, latestSequence: list.at(-1)?.sequence || 0, canManage: manager, canArchive: manager || creator && !t.locked, canReact: !t.archived && !t.locked && canChannel(me, t.channelId, "addReactions"), canSend: !t.archived && !t.locked && canChannel(me, t.channelId, "sendMessages") };
  }
  function replyView(m) {
    const original = m.replyTo && state.threadMessages.find((x) => x.id === m.replyTo && x.threadId === m.threadId);
    return { ...messageView(m), reply: original ? { id: original.id, author: userById(original.authorId)?.displayName || original.author, text: original.text.slice(0, 180) } : null };
  }
  function changed(t) {
    const m = parent(t);
    channelEvent(t.channelId, { type: "thread-state", threadId: t.id });
    if (m) channelEvent(t.channelId, { type: "message-update", message: messageView(m) });
  }
  function requireSend(t, me, options) {
    options.authorize?.(t.channelId, "sendMessages");
    if (t.archived || t.locked || !canChannel(me, t.channelId, "sendMessages")) fail(403, "This thread is archived, locked, or you cannot send messages here.");
  }
  function removeParents(ids) {
    const removed = state.threads.filter((t) => ids.has(t.parentId)); if (!removed.length) return 0;
    const threads = new Set(removed.map((t) => t.id));
    const files = state.threadMessages.filter((m) => threads.has(m.threadId)).flatMap((m) => m.files);
    state.threads = state.threads.filter((t) => !threads.has(t.id)); state.threadMessages = state.threadMessages.filter((m) => !threads.has(m.threadId));
    cleanupFiles(files);
    for (const user of state.users) for (const id of threads) delete user.threadReadState?.[id];
    for (const t of removed) channelEvent(t.channelId, { type: "thread-deleted", threadId: t.id });
    return removed.length;
  }
  function savedSource(item, me) {
    const m = item.threadId ? state.threadMessages.find((m) => m.id === item.messageId && m.threadId === item.threadId) : state.messages.find((m) => m.id === item.messageId);
    if (!m || !canRead(me, m.channel)) return null;
    if (item.threadId && !readable(state.threads.find((t) => t.id === item.threadId), me)) return null;
    const dm = state.conversations.find((c) => c.id === m.channel);
    if (dm?.members.some((id) => me.blocked?.includes(id) || userById(id)?.blocked?.includes(me.id))) return null;
    return m;
  }
  async function handle(req, res, url, me, options = {}) {
    const path = options.bot ? url.pathname.replace(/^\/api\/bot\//, "/api/") : url.pathname;
    const threads = path.match(/^\/api\/threads(?:\/([\w-]+)(?:\/(messages|read))?)?$/);
    const messages = path.match(/^\/api\/thread-messages\/([\w-]+)(?:\/(reactions))?$/);
    const saved = path.match(/^\/api\/saved-messages(?:\/([\w-]+))?$/);
    if (!threads && !messages && !saved) return false;
    if (options.bot && saved) fail(403, "Saved messages are private to human accounts.");
    const method = req.method, d = options.data ?? (["POST", "PATCH"].includes(method) ? await body(req) : {});
    if (isSuspended(me)) fail(403, "This account is suspended."); initializeConversationUser(me);
    if (saved) {
      const id = saved[1];
      if (!id && method === "GET") {
        const q = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 100), offset = Number(url.searchParams.get("offset") || 0);
        if (!Number.isSafeInteger(offset) || offset < 0) fail(400, "Invalid saved-message page.");
        const unavailable = [], matches = [];
        for (const item of [...me.savedItems].reverse()) {
          const m = savedSource(item, me); if (!m) { unavailable.push({ id: item.id, addedAt: item.addedAt }); continue; }
          const message = item.threadId ? replyView(m) : messageView(m);
          if ((message.text + " " + message.author + " " + item.note).toLowerCase().includes(q)) matches.push({ ...item, message, serverId: serverFor(m.channel)?.id || null });
        }
        json(res, 200, { items: matches.slice(offset, offset + 20), total: matches.length, hasMore: offset + 20 < matches.length, offset, unavailable }); return true;
      }
      if (!id && method === "POST") {
        const reference = { messageId: d.messageId, threadId: d.threadId || null };
        if (!savedSource(reference, me)) fail(404, "Message not found or no longer accessible.");
        const existing = me.savedItems.find((i) => i.messageId === reference.messageId && i.threadId === reference.threadId);
        if (existing) { json(res, 200, existing); return true; }
        if (me.savedItems.length >= 1000) fail(400, "Remove an older save before saving more than 1,000 messages.");
        const item = { id: randomUUID(), ...reference, note: d.note === undefined ? "" : note(d.note), addedAt: Date.now() };
        me.savedItems.push(item); await save(); notifyUser(me.id, { type: "saved-update" }); json(res, 201, item); return true;
      }
      if (id === "unavailable" && method === "DELETE") {
        me.savedItems = me.savedItems.filter((i) => savedSource(i, me)); await save(); notifyUser(me.id, { type: "saved-update" }); json(res, 200, { ok: true }); return true;
      }
      const item = me.savedItems.find((i) => i.id === id); if (!item) fail(404, "Saved message not found.");
      if (method === "PATCH") item.note = note(d.note);
      else if (method === "DELETE") me.savedItems = me.savedItems.filter((i) => i !== item);
      else fail(405, "Method not allowed.");
      await save(); notifyUser(me.id, { type: "saved-update" }); json(res, 200, method === "DELETE" ? { ok: true } : item); return true;
    }
    if (threads && !threads[1]) {
      if (method === "GET") {
        const channel = url.searchParams.get("channel"); options.authorize?.(channel, "viewChannel");
        if (!serverFor(channel) || !canRead(me, channel)) fail(403, "You cannot view threads in this channel.");
        const archived = url.searchParams.get("archived") === "1";
        json(res, 200, state.threads.filter((t) => t.channelId === channel && t.archived === archived && readable(t, me)).sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, 100).map((t) => threadView(t, me))); return true;
      }
      if (method !== "POST") fail(405, "Method not allowed.");
      const m = state.messages.find((m) => m.id === d.messageId), s = m && serverFor(m.channel);
      if (!m || !s || !canRead(me, m.channel)) fail(404, "Parent message not found.");
      options.authorize?.(m.channel, "createThreads");
      if (!canChannel(me, m.channel, "createThreads") || !canChannel(me, m.channel, "sendMessages")) fail(403, "You need Create Threads and Send Messages in this channel.");
      const existing = state.threads.find((t) => t.parentId === m.id);
      if (existing) { json(res, 200, threadView(existing, me)); return true; }
      if (state.threads.filter((t) => t.serverId === s.id).length >= 1000) fail(400, "A server can have up to 1,000 threads. Delete older threads to make space.");
      const t = { id: randomUUID(), parentId: m.id, channelId: m.channel, serverId: s.id, name: title(d.name), creatorId: me.id, createdAt: Date.now(), lastActivityAt: Date.now(), archived: false, locked: false };
      state.threads.push(t); management.log(s, me, "Thread created", t.name); await save(); changed(t); json(res, 201, threadView(t, me)); return true;
    }
    const t = threads ? getThread(threads[1], me, options) : getThread(state.threadMessages.find((m) => m.id === messages[1])?.threadId, me, options);
    if (threads) {
      const action = threads[2];
      if (action === "messages" && method === "GET") {
        let list = replies(t.id); const before = url.searchParams.get("before"), around = url.searchParams.get("around");
        if (before && around) fail(400, "Choose one reply position.");
        if (around) {
          const index = list.findIndex((m) => m.id === around); if (index < 0) fail(404, "Reply not found.");
          const start = Math.max(0, index - 40), end = Math.min(list.length, start + 100);
          json(res, 200, { thread: threadView(t, me), parent: messageView(parent(t)), messages: list.slice(start, end).map(replyView), hasOlder: start > 0, hasNewer: end < list.length }); return true;
        }
        if (before) { const index = list.findIndex((m) => m.id === before); if (index < 0) fail(404, "Reply not found."); list = list.slice(0, index); }
        json(res, 200, { thread: threadView(t, me), parent: messageView(parent(t)), messages: list.slice(-100).map(replyView), hasOlder: list.length > 100, hasNewer: false }); return true;
      }
      if (action === "read" && method === "POST") {
        const latest = replies(t.id).at(-1)?.sequence || 0;
        if (!Number.isSafeInteger(d.through) || d.through < 0 || d.through > latest) fail(400, "Choose a valid thread read position.");
        me.threadReadState[t.id] = Math.max(me.threadReadState[t.id] || 0, d.through); await save(); if (!options.bot) notifyUser(me.id, { type: "thread-read", threadId: t.id }); json(res, 200, { through: me.threadReadState[t.id] }); return true;
      }
      if (action === "messages" && method === "POST") {
        requireSend(t, me, options); options.post?.();
        if (typeof (d.text ?? "") !== "string" || (d.text || "").length > 2000 || (!(d.text || "").trim() && !d.files?.length)) fail(400, "Write a reply or attach a file (up to 2,000 characters).");
        const files = Array.isArray(d.files) ? [...new Set(d.files)] : [];
        if (files.length && (!canChannel(me, t.channelId, "attachFiles") || files.length > 5 || files.some((id) => !state.files.some((f) => f.id === id && f.channel === t.channelId && f.userId === me.id)))) fail(403, "You cannot attach those files here.");
        if (d.replyTo && !replies(t.id).some((m) => m.id === d.replyTo)) fail(404, "Reply target not found.");
        expressions.validateText(d.text || "", t.channelId); checkSlowmode(me, t.channelId);
        const m = { id: randomUUID(), threadId: t.id, channel: t.channelId, authorId: me.id, author: me.displayName, sequence: ++state.threadMessageSequence, text: (d.text || "").trim(), files, replyTo: d.replyTo || null, time: Date.now(), reactions: [], pinned: false };
        state.threadMessages.push(m); t.lastActivityAt = m.time; state.cooldowns[t.channelId] ||= {}; state.cooldowns[t.channelId][me.id] = m.time;
        await save(); channelEvent(t.channelId, { type: "thread-message", threadId: t.id, message: replyView(m) }); changed(t); json(res, 201, replyView(m)); return true;
      }
      if (action) fail(405, "Method not allowed.");
      if (method === "GET") { json(res, 200, threadView(t, me)); return true; }
      const manager = canChannel(me, t.channelId, "manageThreads"), creator = me.id === t.creatorId && canChannel(me, t.channelId, "sendMessages") && !t.locked;
      if (method === "DELETE") {
        if (!manager) fail(403, "You need Manage Threads to delete a thread.");
        removeParents(new Set([t.parentId])); management.log(serverFor(t.channelId), me, "Thread deleted", t.name); await save(); const m = parent(t); if (m) channelEvent(t.channelId, { type: "message-update", message: messageView(m) }); json(res, 200, { ok: true }); return true;
      }
      if (method !== "PATCH") fail(405, "Method not allowed.");
      if (!manager && !creator) fail(403, "Only the thread creator or a thread manager can change this thread.");
      const patch = {};
      if (d.name !== undefined) patch.name = title(d.name);
      if (d.archived !== undefined) { if (typeof d.archived !== "boolean") fail(400, "Invalid archive setting."); patch.archived = d.archived; }
      if (d.locked !== undefined) { if (!manager) fail(403, "You need Manage Threads to lock a thread."); if (typeof d.locked !== "boolean") fail(400, "Invalid lock setting."); patch.locked = d.locked; }
      Object.assign(t, patch); if (d.archived === false) t.lastActivityAt = Date.now(); management.log(serverFor(t.channelId), me, "Thread updated", t.name); await save(); changed(t); json(res, 200, threadView(t, me)); return true;
    }
    const m = state.threadMessages.find((m) => m.id === messages[1]);
    if (messages[2] === "reactions" && method === "POST") {
      if (t.archived || t.locked) fail(403, "This thread is read-only.");
      options.authorize?.(t.channelId, "addReactions"); if (!canChannel(me, t.channelId, "addReactions")) fail(403, "You need Add Reactions here.");
      d.emoji = expressions.validateReaction(d.emoji, t.channelId); let reaction = m.reactions.find((r) => r.emoji === d.emoji);
      if (!reaction) { if (m.reactions.length >= 20) fail(400, "Too many reactions."); reaction = { emoji: d.emoji, userIds: [] }; m.reactions.push(reaction); }
      reaction.userIds = reaction.userIds.includes(me.id) ? reaction.userIds.filter((id) => id !== me.id) : [...reaction.userIds, me.id]; m.reactions = m.reactions.filter((r) => r.userIds.length);
    } else if (!messages[2] && method === "PATCH") {
      requireSend(t, me, options); if (m.authorId !== me.id) fail(403, "You can edit only your own replies.");
      if (typeof d.text !== "string" || !d.text.trim() || d.text.length > 2000) fail(400, "Write a reply of up to 2,000 characters.");
      expressions.validateText(d.text, t.channelId); m.text = d.text.trim(); m.editedAt = Date.now();
    } else if (!messages[2] && method === "DELETE") {
      if (m.authorId !== me.id && !canChannel(me, t.channelId, "manageMessages")) fail(403, "You cannot delete this reply.");
      state.threadMessages = state.threadMessages.filter((item) => item !== m); cleanupFiles(m.files); await save(); channelEvent(t.channelId, { type: "thread-message-delete", threadId: t.id, id: m.id }); changed(t); json(res, 200, { ok: true }); return true;
    } else fail(405, "Method not allowed.");
    await save(); channelEvent(t.channelId, { type: "thread-message-update", threadId: t.id, message: replyView(m) }); json(res, 200, replyView(m)); return true;
  }
  async function sweep() {
    const removed = removeParents(new Set(state.threads.filter((t) => !parent(t) || !serverFor(t.channelId)).map((t) => t.parentId)));
    const archived = state.threads.filter((t) => !t.archived && t.lastActivityAt < Date.now() - 86400000);
    if (archived.length || removed) { for (const t of archived) t.archived = true; await save(); for (const t of archived) changed(t); }
  }
  return { handle, summary, removeParents, sweep, hasReplyAccess: (m, me) => readable(state.threads.find((t) => t.id === m.threadId), me), refs: (me) => (me.savedItems || []).map(({ id, messageId, threadId }) => ({ id, messageId, threadId })) };
}
