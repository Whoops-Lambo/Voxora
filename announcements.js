import { randomUUID } from "node:crypto";
import { isSuspended } from "./platform.js";

export function announcementService({ state, body, json, fail, save, refresh, serverFor, canRead, canChannel, userById, management, messageView, channelEvent, cloneAttachments, discardAttachments, expressions }) {
  const publishing = new Set();
  const source = (id, me) => {
    const s = serverFor(id), c = s?.channels.find((c) => c.id === id);
    if (!c?.announcement || c.type !== "text" || !canRead(me, id)) fail(404, "Announcement channel not found.");
    return { s, c };
  };
  function destination(id, me, needSend = true) {
    const s = serverFor(id), c = s?.channels.find((c) => c.id === id);
    if (!s || c?.type !== "text" || !canRead(me, id)) fail(404, "Destination channel not found.");
    management.requirePermission(s, me, "manageChannels");
    if (needSend && !canChannel(me, id, "sendMessages")) fail(403, "You need Send Messages in the destination channel.");
    return { s, c };
  }
  function active(follow) {
    const user = userById(follow.createdBy), s = serverFor(follow.sourceId), c = s?.channels.find((c) => c.id === follow.sourceId);
    const target = serverFor(follow.channelId)?.channels.find((c) => c.id === follow.channelId);
    return !!(user && !isSuspended(user) && c?.announcement && target?.type === "text" && canRead(user, follow.sourceId) && canChannel(user, follow.channelId, "manageChannels") && canChannel(user, follow.channelId, "sendMessages"));
  }
  function view(follow) {
    return { id: follow.id, channelId: follow.channelId, sourceId: follow.sourceId, sourceName: follow.sourceName, serverName: follow.serverName, active: active(follow) };
  }
  async function handle(req, res, url, me) {
    const method = req.method;
    const follow = url.pathname.match(/^\/api\/announcements\/([\w-]+)\/follows$/);
    const remove = url.pathname.match(/^\/api\/announcement-follows\/([\w-]+)$/);
    const publish = url.pathname.match(/^\/api\/messages\/([\w-]+)\/publish$/);
    if (!follow && !remove && !publish && url.pathname !== "/api/announcement-subscriptions") return false;
    const d = method === "POST" ? await body(req) : {};
    if (isSuspended(me)) fail(403, "This account is suspended.");
    if (follow) {
      const { s, c } = source(follow[1], me);
      if (method === "GET") {
        json(res, 200, state.channelFollows.filter((f) => f.sourceId === c.id && canRead(me, f.channelId) && canChannel(me, f.channelId, "manageChannels")).map(view));
        return true;
      }
      if (method !== "POST") fail(405, "Method not allowed.");
      const target = destination(d.channelId, me);
      if (target.s.id === s.id) fail(400, "Choose a channel in another server.");
      const existing = state.channelFollows.find((f) => f.sourceId === c.id && f.channelId === target.c.id);
      if (existing) {
        existing.createdBy = me.id; existing.sourceName = c.name; existing.serverName = s.name;
        await save(); json(res, 200, view(existing)); return true;
      }
      if (state.channelFollows.filter((f) => f.sourceId === c.id).length >= 50) fail(400, "An announcement channel can have up to 50 followers.");
      const record = { id: randomUUID(), sourceId: c.id, channelId: target.c.id, sourceName: c.name, serverName: s.name, createdBy: me.id, createdAt: Date.now() };
      state.channelFollows.push(record);
      management.log(target.s, me, "Announcement channel followed", s.name + " #" + c.name);
      await save(); refresh(); json(res, 201, view(record)); return true;
    }
    if (url.pathname === "/api/announcement-subscriptions" && method === "GET") {
      const { c } = destination(url.searchParams.get("channel"), me, false);
      json(res, 200, state.channelFollows.filter((f) => f.channelId === c.id).map(view)); return true;
    }
    if (remove) {
      if (method !== "DELETE") fail(405, "Method not allowed.");
      const record = state.channelFollows.find((f) => f.id === remove[1]);
      if (!record) fail(404, "Follow not found.");
      const { s } = destination(record.channelId, me, false);
      state.channelFollows = state.channelFollows.filter((f) => f !== record);
      management.log(s, me, "Announcement channel unfollowed", record.serverName + " #" + record.sourceName);
      await save(); refresh(); json(res, 200, { ok: true }); return true;
    }
    if (!publish) return false;
    if (method !== "POST") fail(405, "Method not allowed.");
    const message = state.messages.find((m) => m.id === publish[1]);
    if (!message) fail(404, "Message not found.");
    const { s, c } = source(message.channel, me);
    const authorized = () => state.messages.includes(message) && c.announcement && canRead(me, c.id) && canChannel(me, c.id, "sendMessages") && (message.authorId === me.id || canChannel(me, c.id, "manageMessages")) && !isSuspended(me);
    if (!authorized()) fail(403, "Publish your own posts, or use Manage Messages to publish another member's post.");
    if (message.announcementSource || message.poll || message.command) fail(400, "Publish text and attachments from this channel. Polls, commands, and followed posts cannot be republished.");
    if (message.publishedAt) { json(res, 200, { publishedAt: message.publishedAt, delivered: message.publishedCount }); return true; }
    if (publishing.has(message.id)) fail(409, "This announcement is being published. Try again shortly.");
    publishing.add(message.id);
    const prepared = [], accepted = new Set();
    try {
      const snapshot = { text: message.text, author: messageView(message).author, files: [...(message.files || [])], emojis: expressions.messageEmojis(message.text, message.channel) };
      const followers = state.channelFollows.filter((f) => f.sourceId === c.id && active(f));
      for (const f of followers) {
        const entry = { follow: f, files: await cloneAttachments(snapshot.files, f.channelId, me.id), emojiFiles: [] }; prepared.push(entry);
        entry.emojiFiles = await expressions.cloneAssets(snapshot.emojis, f.channelId, me.id);
      }
      if (!authorized()) fail(403, "Your publishing access changed or the source post was removed.");
      const publishedAt = Date.now(), copies = [];
      for (const entry of prepared) {
        if (!state.channelFollows.includes(entry.follow) || !active(entry.follow)) continue;
        const m = {
          id: randomUUID(), sequence: ++state.messageSequence, channel: entry.follow.channelId,
          authorId: null, author: snapshot.author, text: snapshot.text, time: publishedAt,
          files: entry.files.map((f) => f.id), replyTo: null, pinned: false, reactions: [],
          emojiAssets: entry.emojiFiles.map((f) => ({ id: f.emojiId, name: f.emojiName, fileId: f.id })),
          announcementSource: { serverName: s.name, channelName: c.name, messageId: message.id, channelId: c.id, publishedAt },
        };
        state.files.push(...entry.files, ...entry.emojiFiles); [...entry.files, ...entry.emojiFiles].forEach((f) => accepted.add(f.id));
        state.messages.push(m); copies.push(m);
      }
      message.publishedAt = publishedAt; message.publishedCount = copies.length;
      management.log(s, me, "Announcement published", c.name + " · " + copies.length + " destination(s)");
      await save();
      for (const m of copies) channelEvent(m.channel, { type: "message", message: messageView(m) });
      channelEvent(message.channel, { type: "message-update", message: messageView(message) });
      json(res, 200, { publishedAt, delivered: copies.length }); return true;
    } finally {
      publishing.delete(message.id);
      await discardAttachments(prepared.flatMap((entry) => [...entry.files, ...entry.emojiFiles]).filter((f) => !accepted.has(f.id)));
    }
  }
  return { handle };
}
