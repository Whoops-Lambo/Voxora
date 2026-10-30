import { hasPersonalMention, notificationPolicy } from "./public/activity.js";

export function initializeActivityUser(user, through) {
  user.readBaseline ??= through;
  user.readState ||= {};
  user.activityRevision ||= 0;
  user.notificationSettings ||= { servers: {}, channels: {} };
}
export function initializeActivityState(state) {
  let sequence = 0;
  for (const message of state.messages) {
    if (!Number.isSafeInteger(message.sequence) || message.sequence <= sequence)
      message.sequence = sequence + 1;
    sequence = message.sequence;
  }
  state.messageSequence = Math.max(state.messageSequence || 0, sequence);
  for (const user of state.users)
    initializeActivityUser(user, state.messageSequence);
}
export function readService({
  state,
  canRead,
  body,
  json,
  fail,
  save,
  notify,
  messageView,
  userById,
  onJoined,
}) {
  const blockedDM = (me, c) =>
    c.members.some(
      (id) =>
        me.blocked?.includes(id) || userById(id)?.blocked?.includes(me.id),
    );
  function accessible(me) {
    const entries = new Map();
    for (const s of state.servers.filter((s) => s.members.includes(me.id)))
      for (const c of s.channels)
        if (c.type === "text" && canRead(me, c.id))
          entries.set(c.id, { kind: "channel", serverId: s.id });
    for (const c of state.conversations)
      if (c.members.includes(me.id) && !blockedDM(me, c))
        entries.set(c.id, { kind: "dm", serverId: null });
    return entries;
  }
  const cursor = (me, id) => me.readState[id]?.sequence ?? me.readBaseline;
  const version = (me, id) => me.readState[id]?.version || 0;
  function mentioned(m, me, messages) {
    return (
      !me.blocked?.includes(m.authorId) &&
      (hasPersonalMention(m.text, me.username) ||
        messages.get(m.replyTo)?.authorId === me.id)
    );
  }
  function snapshot(me) {
    const access = accessible(me),
      channels = {};
    const messages = new Map(state.messages.map((m) => [m.id, m]));
    for (const [id, entry] of access)
      channels[id] = {
        ...entry,
        unread: 0,
        mentions: 0,
        cursor: cursor(me, id),
        version: version(me, id),
        manualUnread: !!me.readState[id]?.manualUnread,
        latestId: null,
        latestOtherId: null,
        latestSequence: 0,
        firstUnreadId: null,
        ...notificationPolicy(me.notificationSettings, entry.serverId, id),
      };
    for (const m of state.messages) {
      const entry = channels[m.channel];
      if (!entry) continue;
      entry.latestId = m.id;
      entry.latestSequence = m.sequence;
      if (m.authorId === me.id) continue;
      entry.latestOtherId = m.id;
      if (m.sequence <= entry.cursor) continue;
      entry.unread++;
      entry.firstUnreadId ||= m.id;
      if (entry.kind === "dm" || mentioned(m, me, messages)) entry.mentions++;
    }
    const servers = new Set(
      state.servers.filter((s) => s.members.includes(me.id)).map((s) => s.id),
    );
    return {
      revision: me.activityRevision,
      through: state.messageSequence,
      channels,
      doNotDisturb: me.status === "dnd",
      settings: {
        servers: Object.fromEntries(
          Object.entries(me.notificationSettings.servers).filter(([id]) =>
            servers.has(id),
          ),
        ),
        channels: Object.fromEntries(
          Object.entries(me.notificationSettings.channels).filter(([id]) =>
            access.has(id),
          ),
        ),
      },
    };
  }
  async function changed(me, res) {
    me.activityRevision++;
    await save();
    notify(me.id);
    json(res, 200, { activity: snapshot(me) });
  }
  function joined(me, server) {
    onJoined?.(server, me);
    for (const c of server.channels)
      if (c.type === "text" && canRead(me, c.id))
        me.readState[c.id] = {
          sequence: state.messageSequence,
          version: version(me, c.id) + 1,
        };
    me.activityRevision++;
  }
  async function handle(req, res, url, me) {
    const route = url.pathname,
      method = req.method;
    if (
      ![
        "/api/activity",
        "/api/inbox",
        "/api/read-state",
        "/api/notification-settings",
      ].includes(route)
    )
      return false;
    if (route === "/api/activity" && method === "GET") {
      json(res, 200, snapshot(me));
      return true;
    }
    if (route === "/api/inbox" && method === "GET") {
      const overview = snapshot(me),
        type = url.searchParams.get("type") || "mentions";
      if (type === "unread") {
        const last = new Map(state.messages.map((m) => [m.channel, m]));
        json(res, 200, {
          items: Object.entries(overview.channels)
            .filter(([, c]) => c.unread)
            .map(([channel, c]) => ({
              channel,
              ...c,
              message: messageView(last.get(channel)),
            }))
            .sort((a, b) => b.latestSequence - a.latestSequence),
          hasMore: false,
        });
      } else if (type === "mentions") {
        const messages = new Map(state.messages.map((m) => [m.id, m]));
        const list = state.messages.filter((m) => {
          const c = overview.channels[m.channel];
          return (
            c &&
            m.sequence > c.cursor &&
            m.authorId !== me.id &&
            !me.blocked?.includes(m.authorId) &&
            (c.kind === "dm" || mentioned(m, me, messages))
          );
        });
        const before = url.searchParams.get("before");
        let end = list.length;
        if (before) {
          end = list.findIndex((m) => m.id === before);
          if (end < 0) fail(400, "Inbox position changed. Refresh the inbox.");
        }
        json(res, 200, {
          items: list
            .slice(Math.max(0, end - 100), end)
            .reverse()
            .map(messageView),
          hasMore: end > 100,
        });
      } else fail(400, "Invalid inbox tab.");
      return true;
    }
    if (route === "/api/read-state" && method === "POST") {
      const d = await body(req),
        access = accessible(me);
      if (d.channel !== undefined) {
        if (
          Object.keys(d).some(
            (k) => !["channel", "messageId", "version", "unread"].includes(k),
          )
        )
          fail(400, "Invalid read-state fields.");
        if (!access.has(d.channel))
          fail(403, "No access to this conversation.");
        if (
          !Number.isSafeInteger(d.version) ||
          d.version !== version(me, d.channel)
        )
          fail(
            409,
            "Read position changed on another device. Refresh and try again.",
          );
        if (d.unread !== undefined && typeof d.unread !== "boolean")
          fail(400, "Invalid unread setting.");
        const m = state.messages.find(
          (m) => m.id === d.messageId && m.channel === d.channel,
        );
        if (!m) fail(404, "Message no longer exists.");
        const sequence = d.unread
          ? m.sequence - 1
          : Math.max(cursor(me, d.channel), m.sequence);
        if (!d.unread && sequence === cursor(me, d.channel)) {
          json(res, 200, { activity: snapshot(me) });
          return true;
        }
        me.readState[d.channel] = {
          sequence,
          version: d.version + 1,
          manualUnread: !!d.unread,
        };
      } else {
        if (
          Object.keys(d).some(
            (k) => !["serverId", "all", "through", "revision"].includes(k),
          )
        )
          fail(400, "Invalid read-state fields.");
        if ((d.all !== true && !d.serverId) || (d.all && d.serverId))
          fail(400, "Choose a server or all conversations.");
        if (
          d.serverId &&
          !state.servers.some(
            (s) => s.id === d.serverId && s.members.includes(me.id),
          )
        )
          fail(403, "No access to this server.");
        if (
          !Number.isSafeInteger(d.through) ||
          d.through < 0 ||
          d.through > state.messageSequence
        )
          fail(400, "Invalid read position.");
        if (d.revision !== me.activityRevision)
          fail(409, "Read positions changed. Refresh and try again.");
        for (const [id, c] of access)
          if (
            (!d.serverId || c.serverId === d.serverId) &&
            d.through > cursor(me, id)
          )
            me.readState[id] = {
              sequence: d.through,
              version: version(me, id) + 1,
            };
      }
      await changed(me, res);
      return true;
    }
    if (route === "/api/notification-settings" && method === "PATCH") {
      const d = await body(req);
      if (
        Object.keys(d).some(
          (k) => !["serverId", "channel", "mode", "muteFor"].includes(k),
        )
      )
        fail(400, "Invalid notification settings.");
      if (!!d.serverId === !!d.channel)
        fail(400, "Choose one server or conversation.");
      const access = accessible(me),
        c = access.get(d.channel);
      if (
        d.serverId
          ? !state.servers.some(
              (s) => s.id === d.serverId && s.members.includes(me.id),
            )
          : !c
      )
        fail(403, "No access to this server or conversation.");
      const modes = d.serverId
        ? ["all", "mentions", "nothing"]
        : c.kind === "dm"
          ? ["inherit", "all", "nothing"]
          : ["inherit", "all", "mentions", "nothing"];
      if (d.mode !== undefined && !modes.includes(d.mode))
        fail(400, "Invalid notification mode.");
      if (
        d.muteFor !== undefined &&
        ![-1, 0, 900, 3600, 28800, 86400].includes(d.muteFor)
      )
        fail(400, "Invalid mute duration.");
      const map = d.serverId
        ? me.notificationSettings.servers
        : me.notificationSettings.channels;
      const id = d.serverId || d.channel;
      map[id] = {
        ...(map[id] || {}),
        ...(d.mode !== undefined ? { mode: d.mode } : {}),
        ...(d.muteFor !== undefined
          ? {
              mutedUntil:
                d.muteFor > 0 ? Date.now() + d.muteFor * 1000 : d.muteFor,
            }
          : {}),
      };
      await changed(me, res);
      return true;
    }
    fail(405, "Method not allowed.");
  }
  return { snapshot, handle, joined };
}
