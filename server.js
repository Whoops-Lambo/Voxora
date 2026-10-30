import {
  initializeServer,
  serverView,
  managementService,
} from "./management.js";
import { serverPermissions, channelPermissions } from "./public/permissions.js";
import { channelService } from "./channels.js";
import {
  readService,
  initializeActivityState,
  initializeActivityUser,
} from "./read-service.js";
import { normalizePoll, pollClosed, pollService } from "./polls.js";
import { initializeBots, botService } from "./bots.js";
import { announcementService } from "./announcements.js";
import { initializeCommunity, communityService } from "./community.js";
import { initializeExpressions, expressionService } from "./expressions.js";
import { initializeConversations, initializeConversationUser, conversationService } from "./conversations.js";
import { onboardingService, onboardingJoined } from './onboarding.js';
import { moderationService } from './moderation.js';
import {
  initializePlatform,
  platformService,
  isSuspended,
} from "./platform.js";
import http from "node:http";
import { readFile, writeFile, mkdir, rename, unlink, copyFile, link } from "node:fs/promises";
import {
  randomUUID,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";

const scrypt = promisify(scryptCallback);
const { version: appVersion } = JSON.parse(
  await readFile(new URL("./package.json", import.meta.url), "utf8"),
);
const dataDir = process.env.VOXORA_DATA_DIR || ".data";
await mkdir(path.join(dataDir, "uploads"), { recursive: true });
const statePath = path.join(dataDir, "state.json");
const colors = [
  "#5865f2",
  "#eb459e",
  "#3ba55c",
  "#faa61a",
  "#9b59b6",
  "#3498db",
];
const defaultChannels = [
  "general",
  "introductions",
  "design",
  "development",
  "off-topic",
];
let state;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  let legacy = [];
  try {
    legacy = JSON.parse(
      await readFile(path.join(dataDir, "messages.json"), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  state = {
    version: 2,
    users: [],
    sessions: [],
    servers: [
      {
        id: "community",
        name: "Voxora Community",
        color: "#5865f2",
        ownerId: null,
        members: [],
        invite: randomBytes(6).toString("hex"),
        channels: [
          ...defaultChannels.map((id) => ({
            id,
            name: id,
            type: "text",
            category: "TEXT CHANNELS",
            permissionSynced: true,
            topic:
              id === "general"
                ? "Welcome to the community. This is the place for everything."
                : "",
          })),
          {
            id: "voice-general",
            name: "General",
            type: "voice",
            category: "VOICE CHANNELS",
            permissionSynced: true,
            topic: "",
          },
          {
            id: "voice-gaming",
            name: "Gaming",
            type: "voice",
            category: "VOICE CHANNELS",
            permissionSynced: true,
            topic: "",
          },
        ],
      },
    ],
    conversations: [],
    friendships: [],
    files: [],
    messages: legacy.map((m) => ({
      ...m,
      id: String(m.id),
      authorId: null,
      reactions: [],
      pinned: false,
    })),
  };
}
for (const s of state.servers) initializeServer(s);
state.cooldowns ||= {};
initializeBots(state);
initializePlatform(state);
initializeCommunity(state);
initializeExpressions(state);
initializeConversations(state);
initializeActivityState(state);
let writes = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(state);
  writes = writes
    .catch(() => {})
    .then(async () => {
      await writeFile(statePath + ".tmp", snapshot);
      await rename(statePath + ".tmp", statePath);
    });
  return writes;
}
await save();
const clients = new Set(),
  voice = new Map(),
  limits = new Map();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  color: user.color,
  bio: user.bio || "",
  bot: !!user.bot,
  applicationId: user.bot ? user.applicationId : undefined,
  staffRoles: platform.badges(user),
  status: user.bot
    ? bots.online(user.id)
      ? "online"
      : "offline"
    : user.status === "invisible"
      ? "offline"
      : [...clients].some((c) => c.userId === user.id)
        ? user.status || "online"
        : "offline",
  customStatus: user.customStatus || "",
  createdAt: user.createdAt,
});
const userById = (id) => state.users.find((u) => u.id === id);
const serverFor = (channel) =>
  state.servers.find((s) => s.channels.some((c) => c.id === channel));
function canRead(user, channel) {
  const s = serverFor(channel);
  if (s) return channelPermissions(s, user.id, channel).includes("viewChannel");
  return state.conversations.some(
    (c) => c.id === channel && c.members.includes(user.id),
  );
}
function canChannel(user, channel, permission) {
  const s = serverFor(channel);
  return s
    ? canRead(user, channel) &&
        channelPermissions(s, user.id, channel).includes(permission)
    : permission !== "manageMessages" && canRead(user, channel);
}
function revalidateVoice(s) {
  for (const [id, v] of voice) {
    if (!s.channels.some((c) => c.id === v.channel)) continue;
    const p = channelPermissions(s, v.userId, v.channel);
    if (
      !p.includes("viewChannel") ||
      !p.includes("connect") ||
      v.canSpeak !== p.includes("speak") ||
      v.canVideo !== p.includes("video")
    ) {
      broadcast(
        {
          type: "voice-disconnected",
          reason:
            "Your voice permissions changed. Rejoin the channel if you still have access.",
        },
        (c) => c.clientId === id,
      );
      leaveVoice(id);
    }
  }
}

function isText(channel) {
  const s = serverFor(channel);
  return s
    ? s.channels.find((c) => c.id === channel)?.type === "text"
    : state.conversations.some((c) => c.id === channel);
}
function fail(status, message, details) {
  const e = new Error(message);
  e.status = status;
  e.details = details;
  throw e;
}
function requireValue(value, test, message) {
  if (!test(value)) fail(400, message);
  return value;
}
const text = (value, max = 2000) =>
  typeof value === "string" && value.length <= max;
function checkedName(value, max = 40) {
  if (!text(value, max) || !value.trim()) fail(400, "Enter a valid name.");
  return value.trim();
}
const emit = (client, event) =>
  client.res.write(`data: ${JSON.stringify(event)}\n\n`);
function broadcast(event, predicate = () => true) {
  for (const client of clients) if (predicate(client)) emit(client, event);
}
const refresh = () => {
  broadcast({ type: "refresh" });
  bots.refresh();
};
function channelEvent(channel, event) {
  broadcast(event, (c) => canRead(userById(c.userId), channel));
  bots.publish(channel, event);
}
function messageView(m) {
  const user = userById(m.authorId);
  return {
    ...m,
    thread: collaboration.summary(m.id),
    customEmojis: expressions.messageEmojis([m.text, ...(m.reactions || []).map((r) => r.emoji)].join(" "), m.channel, m.emojiAssets),
    poll: m.poll ? { ...m.poll, closed: pollClosed(m.poll) } : undefined,
    bot: !!user?.bot,
    command: bots.commandView(m.command),
    author: user?.displayName || m.author || "Voxora",
    username: user?.username || "voxora",
    color: user?.color || "#5865f2",
    attachments: (m.files || [])
      .map((id) => state.files.find((f) => f.id === id))
      .filter(Boolean)
      .map(({ id, name, mime, size }) => ({
        id,
        name,
        mime,
        size,
        url: "/api/files/" + id,
      })),
    reply: m.replyTo
      ? (() => {
          const r = state.messages.find((x) => x.id === m.replyTo);
          return r
            ? {
                id: r.id,
                authorId: r.authorId,
                author: userById(r.authorId)?.displayName || r.author,
                text: r.text.slice(0, 180),
              }
            : null;
        })()
      : null,
  };
}
function bootstrap(me) {
  const servers = state.servers.filter((s) => s.members.includes(me.id));
  const related = new Set([
    me.id,
    ...servers.flatMap((s) => s.members),
    ...state.friendships
      .filter((f) => f.from === me.id || f.to === me.id)
      .flatMap((f) => [f.from, f.to]),
    ...state.conversations
      .filter((c) => c.members.includes(me.id))
      .flatMap((c) => c.members),
    ...(me.blocked || []),
  ]);
  return {
    me: publicUser(me),
    savedMessageRefs: collaboration.refs(me),
    serverEmojis: expressions.forUser(me),
    platform: platform.self(me),
    activity: reads.snapshot(me),
    servers: servers.map((s) => serverView(s, me)),
    users: state.users.filter((u) => related.has(u.id)).map(publicUser),
    friendships: state.friendships.filter(
      (f) => f.from === me.id || f.to === me.id,
    ),
    blocked: me.blocked || [],
    conversations: state.conversations.filter((c) => c.members.includes(me.id)),
    voice: [...voice.values()].filter((v) => canRead(me, v.channel)),
    cooldowns: Object.fromEntries(
      servers.flatMap((s) =>
        s.channels
          .filter(
            (c) =>
              canRead(me, c.id) &&
              c.slowmode &&
              !canChannel(me, c.id, "manageMessages") &&
              !serverPermissions(s, me.id).includes("manageChannels"),
          )
          .map((c) => [
            c.id,
            (state.cooldowns[c.id]?.[me.id] || 0) + c.slowmode * 1000,
          ])
          .filter(([, until]) => until > Date.now()),
      ),
    ),
    iceServers: JSON.parse(
      process.env.VOXORA_ICE_SERVERS ||
        '[{"urls":"stun:stun.l.google.com:19302"}]',
    ),
  };
}
function sessionFor(req) {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("voxora_session="))
    ?.slice(15);
  if (!token) return null;
  const session = state.sessions.find(
    (s) => s.hash === hash(token) && s.expires > Date.now(),
  );
  return session ? { session, user: userById(session.userId) } : null;
}
function cookie(req, token, clear = false) {
  return `voxora_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 2592000}${req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`;
}
function json(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(data));
}
async function bytes(req, max = 12 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max)
      fail(
        413,
        "File or request is too large. Maximum attachment size is 8 MB.",
      );
    chunks.push(chunk);
  }
  if (req.voxoraActor && isSuspended(req.voxoraActor))
    fail(403, "This account is suspended.");
  return Buffer.concat(chunks);
}
async function body(req) {
  try {
    const value = JSON.parse((await bytes(req, 32000)).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "Invalid request.");
    return value;
  } catch (e) {
    if (e.status) throw e;
    fail(400, "Invalid JSON.");
  }
}
function rate(key, max, period) {
  const now = Date.now();
  let value = limits.get(key);
  if (!value || value.until < now) {
    value = { count: 0, until: now + period };
    limits.set(key, value);
  }
  if (++value.count > max)
    fail(429, "Too many requests. Please wait a moment.");
  if (limits.size > 10000)
    for (const [key, value] of limits)
      if (value.until < now) limits.delete(key);
}
function voicePeers(channel) {
  return [...voice.values()].filter((p) => p.channel === channel);
}
function voiceChanged(channel) {
  if (!channel) return;
  const peers = voicePeers(channel);
  broadcast({ type: "voice-peers", channel, peers }, (c) =>
    peers.some((p) => p.clientId === c.clientId),
  );
  refresh();
}
function leaveVoice(clientId) {
  const old = voice.get(clientId);
  if (old) {
    voice.delete(clientId);
    voiceChanged(old.channel);
  }
}
async function removeChannel(channel) {
  collaboration.removeParents(new Set(state.messages.filter((m) => m.channel === channel).map((m) => m.id)));
  for (const e of state.scheduledEvents) if (e.channelId === channel && ["scheduled", "active"].includes(e.status)) e.status = "cancelled";
  state.channelFollows = state.channelFollows.filter((f) => f.sourceId !== channel && f.channelId !== channel);
  state.botInteractions = state.botInteractions.filter(
    (i) => i.channel !== channel,
  );
  delete state.cooldowns[channel];
  for (const user of state.users) {
    delete user.readState[channel];
    delete user.notificationSettings.channels[channel];
  }
  state.messages = state.messages.filter((m) => m.channel !== channel);
  const files = state.files.filter((f) => f.channel === channel);
  state.files = state.files.filter((f) => f.channel !== channel);
  for (const [id, v] of voice) if (v.channel === channel) leaveVoice(id);
  for (const f of files)
    await unlink(path.join(dataDir, "uploads", f.id)).catch(() => {});
}

const management = managementService({
  state,
  save,
  refresh,
  fail,
  body,
  json,
  userById,
  removeChannel,
  revalidateVoice,
});

const channels = channelService({
  state,
  management,
  body,
  json,
  fail,
  removeChannel,
});
const reads = readService({
  onJoined: onboardingJoined,
  state,
  canRead,
  body,
  json,
  fail,
  save,
  messageView,
  userById,
  notify: (id) =>
    broadcast({ type: "activity-update" }, (c) => c.userId === id),
});

function checkSlowmode(me, channelId) {
  const server = serverFor(channelId), channel = server?.channels.find((c) => c.id === channelId);
  const nextAllowedAt = (state.cooldowns[channelId]?.[me.id] || 0) + (channel?.slowmode || 0) * 1000;
  if (!me.bot && channel?.slowmode && nextAllowedAt > Date.now() && !canChannel(me, channelId, "manageMessages") && !serverPermissions(server, me.id).includes("manageChannels")) {
    const retryAfter = Math.ceil((nextAllowedAt - Date.now()) / 1000);
    fail(429, "Slowmode is enabled. Try again in " + retryAfter + " seconds.", { retryAfter, nextAllowedAt });
  }
}
const expressions = expressionService({ state, dataDir, body, bytes, json, fail, save, refresh, management, serverFor, userById });
const onboarding = onboardingService({ state, body, json, fail, save, refresh, management, revalidateVoice });
function cleanupFiles(ids) {
  const used = new Set([...state.messages, ...state.threadMessages].flatMap((m) => [...(m.files || []), ...(m.emojiAssets || []).map((e) => e.fileId)]));
  const unused = state.files.filter((f) => ids.includes(f.id) && !used.has(f.id));
  state.files = state.files.filter((f) => !unused.includes(f));
  for (const f of unused) unlink(path.join(dataDir, "uploads", f.id)).catch(() => {});
}
const collaboration = conversationService({ state, body, json, fail, save, refresh, notifyUser: (id, event) => broadcast(event, (c) => c.userId === id), canRead, canChannel, serverFor, userById, messageView, channelEvent, expressions, checkSlowmode, management, cleanupFiles, getModeration: () => safety });
const safety = moderationService({ state, body, json, fail, save, management, canRead, canChannel, serverFor, userById,
  notify: (s, item) => broadcast({ type: 'moderation-update', serverId: s.id }, client => {
    const user = userById(client.userId); return user && !isSuspended(user) && s.members.includes(user.id) && item && canRead(user,item.channel) && (serverPermissions(s,user.id).includes('manageReports') || item.reporters.some(r => r.userId === user.id));
  }),
  removeMessage: m => {
    if (m.threadId) state.threadMessages = state.threadMessages.filter(item => item !== m);
    else { collaboration.removeParents(new Set([m.id])); state.messages = state.messages.filter(item => item !== m); }
    cleanupFiles(m.files || []);
    return () => { if(m.threadId) { channelEvent(m.channel,{type:'thread-message-delete',threadId:m.threadId,id:m.id});const t=state.threads.find(t=>t.id===m.threadId),parent=t&&state.messages.find(p=>p.id===t.parentId);if(parent)channelEvent(m.channel,{type:'message-update',message:messageView(parent)}); } else channelEvent(m.channel,{type:'message-delete',channel:m.channel,id:m.id}); };
  },
});
async function createMessage(
  me,
  d,
  { pollCreatorId = me.id, command = null, beforeSave = null } = {},
) {
  if (!canChannel(me, d.channel, "sendMessages") || !isText(d.channel))
    fail(403, "You cannot message this channel.");
  const dm = state.conversations.find((c) => c.id === d.channel);
  if (
    dm &&
    dm.members.some(
      (id) =>
        userById(id)?.blocked?.includes(me.id) || me.blocked?.includes(id),
    )
  )
    fail(403, "Messages are blocked for this conversation.");
  if (
    !text(d.text ?? "", 2000) ||
    (!(d.text || "").trim() && !d.files?.length && d.poll === undefined)
  )
    fail(400, "Write a message or attach a file.");
  const poll =
    d.poll === undefined ? null : normalizePoll(d.poll, pollCreatorId, fail);
  expressions.validateText(d.text || "", d.channel);
  const files = Array.isArray(d.files) ? [...new Set(d.files)] : [];
  if (poll && files.length) fail(400, "Polls cannot include attachments.");
  if (files.length && !canChannel(me, d.channel, "attachFiles"))
    fail(403, "You do not have permission to attach files.");
  if (
    files.length > 5 ||
    files.some(
      (id) =>
        !state.files.some(
          (f) => f.id === id && f.userId === me.id && f.channel === d.channel,
        ),
    )
  )
    fail(400, "Invalid attachments.");
  if (
    d.replyTo &&
    !state.messages.some((m) => m.id === d.replyTo && m.channel === d.channel)
  )
    fail(400, "The message you replied to was not found.");
  const server = serverFor(d.channel);
  checkSlowmode(me, d.channel);
  const decision = safety.inspect(me, d.channel, d.text || '', { poll, files });
  if (decision?.blocked) await safety.reject(me, decision, { channel: d.channel, files });
  const m = {
    id: randomUUID(),
    sequence: ++state.messageSequence,
    channel: d.channel,
    authorId: me.id,
    author: me.displayName,
    text: (d.text || "").trim() || poll?.question || "",
    ...(poll ? { poll } : {}),
    ...(command ? { command } : {}),
    time: Date.now(),
    files,
    replyTo: d.replyTo || null,
    pinned: false,
    reactions: [],
  };
  state.messages.push(m);
  beforeSave?.(m);
  safety.accept(me,m,decision);
  if (server) {
    state.cooldowns[d.channel] ||= {};
    state.cooldowns[d.channel][me.id] = m.time;
  }
  await save();
  safety.notify(decision);
  channelEvent(m.channel, { type: "message", message: messageView(m) });
  return messageView(m);
}

const polls = pollService({
  state,
  body,
  fail,
  json,
  canRead,
  canChannel,
  save,
  channelEvent,
  messageView,
});
state.channelFollows ||= [];
const announcements = announcementService({
  expressions,
  state, body, json, fail, save, refresh, serverFor, canRead, canChannel, userById,
  management, messageView, channelEvent,
  discardAttachments: async (files) => {
    for (const f of files) await unlink(path.join(dataDir, "uploads", f.id)).catch(() => {});
  },
  cloneAttachments: async (ids, channel, userId) => {
    const files = [];
    try {
      for (const id of ids) {
        const source = state.files.find((f) => f.id === id);
        if (!source) fail(400, "An attachment is no longer available.");
        const file = { ...source, id: randomUUID(), channel, userId };
        const from = path.join(dataDir, "uploads", source.id), to = path.join(dataDir, "uploads", file.id);
        await link(from, to).catch(() => copyFile(from, to));
        files.push(file);
      }
      return files;
    } catch (error) {
      for (const f of files) await unlink(path.join(dataDir, "uploads", f.id)).catch(() => {});
      throw error;
    }
  },
});
const bots = botService({
  state,
  body,
  fail,
  json,
  save,
  refresh,
  rate,
  serverFor,
  canRead,
  canChannel,
  userById,
  publicUser,
  createMessage,
  messageView,
  channelEvent,
  management,
  threadTools: (req, res, url, me, options) => collaboration.handle(req, res, url, me, options),
  removeMessageThreads: (ids) => collaboration.removeParents(ids),
  expressions,
});
const platform = platformService({
  appVersion,
  notifyDesktopUpdates: () => broadcast({ type: "desktop-update-check" }),
  state,
  body,
  fail,
  json,
  save,
  refresh,
  userById,
  removeChannel,
  revokeUser: (id) => {
    for (const c of clients)
      if (c.userId === id) {
        emit(c, {
          type: "account-suspended",
          reason: "This account has been suspended by platform staff.",
        });
        clients.delete(c);
        leaveVoice(c.clientId);
        c.res.end();
      }
  },
});

const community = communityService({ state, body, json, fail, save, refresh, management, canRead, canChannel, userById, reads });
const timeoutSweep = setInterval(() => {
  let changed = false;
  for (const s of state.servers)
    for (const [id, until] of Object.entries(s.timeouts)) {
      if (until <= Date.now()) {
        delete s.timeouts[id];
        changed = true;
      }
    }
  if (changed) save().then(refresh).catch(console.error);
  polls.sweep().catch(console.error);
  bots.sweep().catch(console.error);
  community.sweep().catch(console.error);
  collaboration.sweep().catch(console.error);
  expressions.sweep().catch(console.error);
}, 1000);
timeoutSweep.unref();
export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const route = url.pathname;
    const method = req.method;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    if (!["GET", "HEAD"].includes(method) && req.headers.origin) {
      let origin;
      try {
        origin = new URL(req.headers.origin);
      } catch {
        fail(403, "Invalid origin.");
      }
      if (origin.host !== req.headers.host)
        fail(403, "Cross-site requests are not allowed.");
    }
    if (route === "/api/info")
      return json(res, 200, {
        name: "Voxora",
        version: appVersion,
        appPath: "/app",
        capabilities: { botModeration: true, announcements: true, discovery: true, serverTemplates: true, scheduledEvents: true, threads: true, customEmoji: true, savedMessages: true, serverOnboarding: true, serverModeration: true },
      });
    if (await bots.handleBot(req, res, url)) return;
    if (route === "/api/auth/register" || route === "/api/auth/login") {
      if (method !== "POST") fail(405, "Method not allowed.");
      rate("auth:" + req.socket.remoteAddress, 30, 15 * 60 * 1000);
      const data = await body(req);
      const username = checkedName(data.username, 24).toLowerCase();
      if (!/^[a-z0-9_.]{3,24}$/.test(username))
        fail(
          400,
          "Username must have 3–24 letters, numbers, underscores or periods.",
        );
      if (!text(data.password, 128) || data.password.length < 8)
        fail(400, "Use a password between 8 and 128 characters.");
      let user = state.users.find((u) => u.username === username);
      if (route.endsWith("register")) {
        if (user) fail(409, "That username is already taken.");
        const salt = randomBytes(16).toString("hex");
        const password = (await scrypt(data.password, salt, 64)).toString(
          "hex",
        );
        if (state.users.some((u) => u.username === username))
          fail(409, "That username is already taken.");
        user = {
          id: randomUUID(),
          username,
          displayName: checkedName(data.displayName || data.username, 32),
          salt,
          password,
          color: colors[state.users.length % colors.length],
          bio: "",
          customStatus: "",
          status: "online",
          blocked: [],
          createdAt: Date.now(),
        };
        state.users.push(user);
        initializeActivityUser(user, state.messageSequence);
        initializeConversationUser(user);
        platform.claimFirstAccount(user);
        const community = state.servers.find((s) => s.id === "community");
        if (community) {
          community.members.push(user.id);
          if (!community.ownerId) community.ownerId = user.id;
          onboardingJoined(community, user);
        }
      } else {
        const salt = user?.salt || "00000000000000000000000000000000";
        const supplied = await scrypt(data.password, salt, 64);
        if (
          !user ||
          user.bot ||
          !timingSafeEqual(supplied, Buffer.from(user.password, "hex"))
        )
          fail(401, "Incorrect username or password.");
      }
      const token = randomBytes(32).toString("hex");
      if (isSuspended(user))
        fail(
          403,
          "This account is suspended. " + (user.suspensionReason || ""),
        );
      state.sessions = state.sessions.filter((s) => s.expires > Date.now());
      state.sessions.push({
        hash: hash(token),
        userId: user.id,
        expires: Date.now() + 2592000000,
      });
      await save();
      refresh();
      return json(res, 200, bootstrap(user), {
        "Set-Cookie": cookie(req, token),
      });
    }
    if (route.startsWith("/api/")) {
      const auth = sessionFor(req);
      if (!auth?.user) fail(401, "Please log in.");
      const me = auth.user;
      if (isSuspended(me)) fail(403, "This account is suspended.");
      req.voxoraActor = me;
      if (method !== "GET")
        rate(
          (route === "/api/read-state" ? "reads:" : "user:") + me.id,
          route === "/api/read-state" ? 240 : 180,
          60000,
        );
      if (route === "/api/auth/logout" && method === "POST") {
        state.sessions = state.sessions.filter(
          (s) => s.hash !== auth.session.hash,
        );
        for (const c of clients)
          if (c.sessionHash === auth.session.hash) {
            leaveVoice(c.clientId);
            c.res.end();
          }
        await save();
        return json(
          res,
          200,
          { ok: true },
          { "Set-Cookie": cookie(req, "", true) },
        );
      }
      if (route === "/api/state" && method === "GET")
        return json(res, 200, bootstrap(me));
      if (await reads.handle(req, res, url, me)) return;
      if (await polls.handle(req, res, url, me)) return;
      if (await bots.handleHuman(req, res, url, me)) return;
      if (await platform.handle(req, res, url, me)) return;
      if (await announcements.handle(req, res, url, me)) return;
      if (await community.handle(req, res, url, me)) return;
      if (await onboarding.handle(req, res, url, me)) return;
      if (await safety.handle(req, res, url, me)) return;
      if (await expressions.handle(req, res, url, me)) return;
      if (await collaboration.handle(req, res, url, me)) return;
      if (route === "/api/profile" && method === "PATCH") {
        const d = await body(req);
        if (d.displayName !== undefined)
          me.displayName = checkedName(d.displayName, 32);
        if (d.bio !== undefined) {
          requireValue(d.bio, (x) => text(x, 190), "Bio is too long.");
          me.bio = d.bio;
        }
        if (d.color !== undefined) {
          requireValue(
            d.color,
            (x) => /^#[0-9a-f]{6}$/i.test(x),
            "Choose a valid color.",
          );
          me.color = d.color;
        }
        if (d.status !== undefined) {
          requireValue(
            d.status,
            (x) => ["online", "idle", "dnd", "invisible"].includes(x),
            "Invalid status.",
          );
          me.status = d.status;
        }
        if (d.customStatus !== undefined) {
          requireValue(
            d.customStatus,
            (x) => text(x, 80),
            "Status is too long.",
          );
          me.customStatus = d.customStatus;
        }
        await save();
        refresh();
        return json(res, 200, publicUser(me));
      }
      if (route === "/api/events" && method === "GET") {
        const clientId = url.searchParams.get("client");
        if (!/^[\w-]{8,80}$/.test(clientId || ""))
          fail(400, "Invalid client identifier.");
        if (
          [...clients].some(
            (c) => c.clientId === clientId && c.userId !== me.id,
          )
        )
          fail(409, "This client identifier is already in use.");
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(": connected\n\n");
        const client = {
          userId: me.id,
          clientId,
          sessionHash: auth.session.hash,
          res,
        };
        clients.add(client);
        emit(client, { type: "connected" });
        refresh();
        const heartbeat = setInterval(() => {
          if (auth.session.expires < Date.now()) res.end();
          else res.write(": heartbeat\n\n");
        }, 15000);
        heartbeat.unref();
        res.on("close", () => {
          clearInterval(heartbeat);
          clients.delete(client);
          if (![...clients].some((c) => c.clientId === clientId))
            leaveVoice(clientId);
          refresh();
        });
        return;
      }
      if (route === "/api/servers" && method === "POST") {
        const d = await body(req);
        const s = {
          id: randomUUID(),
          name: checkedName(d.name, 60),
          color: colors[state.servers.length % colors.length],
          ownerId: me.id,
          createdAt: Date.now(),
          members: [me.id],
          invite: randomBytes(6).toString("hex"),
          channels: [
            {
              id: randomUUID(),
              name: "general",
              type: "text",
              category: "TEXT CHANNELS",
              permissionSynced: true,
              topic: "",
            },
            {
              id: randomUUID(),
              name: "General",
              type: "voice",
              category: "VOICE CHANNELS",
              permissionSynced: true,
              topic: "",
            },
          ],
        };
        initializeServer(s);
        state.servers.push(s);
        management.log(s, me, "Server created", s.name);
        await save();
        refresh();
        return json(res, 201, serverView(s, me));
      }
      if (route === "/api/invites/join" && method === "POST") {
        const d = await body(req);
        const code = checkedName(d.code, 300).split("/").filter(Boolean).pop();
        const s = state.servers.find((s) =>
          s.invites.some((i) => i.code === code),
        );
        if (!s) fail(404, "That invite is invalid or has expired.");
        const invite = s.invites.find((i) => i.code === code);
        if (
          (invite.expiresAt && invite.expiresAt <= Date.now()) ||
          (invite.maxUses && invite.uses >= invite.maxUses)
        )
          fail(404, "That invite has expired or reached its usage limit.");
        if (s.bans.some((b) => b.userId === me.id))
          fail(403, "You are banned from this server.");
        if (!s.members.includes(me.id)) {
          s.members.push(me.id);
          reads.joined(me, s);
          invite.uses++;
          management.log(s, me, "Member joined", me.displayName);
        }
        await save();
        refresh();
        return json(res, 200, serverView(s, me));
      }
      if (await management.handle(req, res, url, me)) return;
      if (await channels.handle(req, res, url, me)) return;
      const serverMatch = route.match(
        /^\/api\/servers\/([\w-]+)(?:\/(leave))?$/,
      );
      if (serverMatch) {
        const s = state.servers.find(
          (s) => s.id === serverMatch[1] && s.members.includes(me.id),
        );
        if (!s) fail(404, "Server not found.");
        const action = serverMatch[2];
        if (action === "leave" && method === "POST") {
          if (s.ownerId === me.id)
            fail(
              400,
              "The owner must delete the server instead of leaving it.",
            );
          s.members = s.members.filter((id) => id !== me.id);
          delete s.memberRoles[me.id];
          delete s.timeouts[me.id];
          delete s.onboardingMembers?.[me.id];
          for (const c of [...s.channels, ...s.categories])
            c.overwrites = c.overwrites.filter(
              (o) => o.type !== "member" || o.id !== me.id,
            );
          management.log(s, me, "Member left", me.displayName);
          for (const [id, v] of voice)
            if (
              v.userId === me.id &&
              s.channels.some((c) => c.id === v.channel)
            )
              leaveVoice(id);
          await management.commit(s);
          return json(res, 200, { ok: true });
        }
        if (!action && method === "PATCH") {
          const d = await body(req);
          management.requirePermission(s, me, "manageServer");
          const patch = {};
          if (d.name !== undefined) patch.name = checkedName(d.name, 60);
          if (d.description !== undefined) {
            requireValue(
              d.description,
              (x) => text(x, 500),
              "Description is too long.",
            );
            patch.description = d.description;
          }
          if (d.color !== undefined) {
            requireValue(
              d.color,
              (x) => /^#[0-9a-f]{6}$/i.test(x),
              "Invalid color.",
            );
            patch.color = d.color;
          }
          Object.assign(s, patch);
          management.log(s, me, "Server updated", s.name);
          await management.commit(s);
          return json(res, 200, serverView(s, me));
        }
        if (!action && method === "DELETE") {
          if (s.ownerId !== me.id)
            fail(403, "Only the owner can delete the server.");
          for (const c of s.channels) await removeChannel(c.id);
          state.servers = state.servers.filter((x) => x.id !== s.id);
          await save();
          refresh();
          return json(res, 200, { ok: true });
        }
        fail(405, "Method not allowed.");
      }
      if (route === "/api/friends/request" && method === "POST") {
        const d = await body(req);
        const target = state.users.find(
          (u) => u.username === String(d.username).trim().toLowerCase(),
        );
        if (!target)
          fail(404, "No one with that username was found on this server.");
        if (target.bot) fail(400, "Bots do not accept friend requests.");
        if (target.id === me.id) fail(400, "You cannot add yourself.");
        if (target.blocked?.includes(me.id) || me.blocked?.includes(target.id))
          fail(403, "You cannot send this friend request.");
        const existing = state.friendships.find(
          (f) =>
            [f.from, f.to].includes(me.id) &&
            [f.from, f.to].includes(target.id),
        );
        if (existing)
          fail(
            409,
            existing.status === "accepted"
              ? "You are already friends."
              : "A friend request is already pending.",
          );
        const f = {
          id: randomUUID(),
          from: me.id,
          to: target.id,
          status: "pending",
        };
        state.friendships.push(f);
        await save();
        refresh();
        return json(res, 201, f);
      }
      const friendMatch = route.match(/^\/api\/friends\/([\w-]+)$/);
      if (friendMatch) {
        const f = state.friendships.find(
          (f) =>
            f.id === friendMatch[1] && (f.from === me.id || f.to === me.id),
        );
        if (!f) fail(404, "Friend request not found.");
        if (method === "PATCH") {
          if (f.to !== me.id || f.status !== "pending")
            fail(403, "You cannot accept that request.");
          f.status = "accepted";
        } else if (method === "DELETE")
          state.friendships = state.friendships.filter((x) => x.id !== f.id);
        else fail(405, "Method not allowed.");
        await save();
        refresh();
        return json(res, 200, { ok: true });
      }
      const blockMatch = route.match(/^\/api\/blocks\/([\w-]+)$/);
      if (blockMatch) {
        if (blockMatch[1] === me.id || !userById(blockMatch[1]))
          fail(400, "Invalid user.");
        me.blocked ||= [];
        if (method === "POST") {
          if (!me.blocked.includes(blockMatch[1]))
            me.blocked.push(blockMatch[1]);
          state.friendships = state.friendships.filter(
            (f) =>
              !(
                [f.from, f.to].includes(me.id) &&
                [f.from, f.to].includes(blockMatch[1])
              ),
          );
        } else if (method === "DELETE")
          me.blocked = me.blocked.filter((id) => id !== blockMatch[1]);
        else fail(405, "Method not allowed.");
        await save();
        refresh();
        return json(res, 200, { ok: true });
      }
      if (route === "/api/conversations" && method === "POST") {
        const d = await body(req);
        const target = userById(d.userId);
        if (!target || target.id === me.id) fail(400, "Choose another member.");
        if (target.bot)
          fail(
            400,
            "Bots do not support direct messages. Use commands in a server.",
          );
        if (target.blocked?.includes(me.id) || me.blocked?.includes(target.id))
          fail(403, "Unblock this user before messaging.");
        const known =
          state.servers.some(
            (s) => s.members.includes(me.id) && s.members.includes(target.id),
          ) ||
          state.friendships.some(
            (f) =>
              f.status === "accepted" &&
              [f.from, f.to].includes(me.id) &&
              [f.from, f.to].includes(target.id),
          );
        if (!known) fail(403, "Add this person as a friend first.");
        let c = state.conversations.find(
          (c) => c.members.includes(me.id) && c.members.includes(target.id),
        );
        if (!c) {
          c = { id: "dm-" + randomUUID(), members: [me.id, target.id] };
          state.conversations.push(c);
          await save();
          refresh();
        }
        return json(res, 200, c);
      }
      if (route === "/api/messages") {
        if (method === "GET") {
          const channel = url.searchParams.get("channel");
          if (!canRead(me, channel))
            fail(403, "You do not have access to this channel.");
          let list = state.messages.filter((m) => m.channel === channel);
          if (url.searchParams.get("pins") === "1")
            list = list.filter((m) => m.pinned);
          const before = url.searchParams.get("before");
          const after = url.searchParams.get("after"),
            around = url.searchParams.get("around");
          if ([before, after, around].filter(Boolean).length > 1)
            fail(400, "Choose one message position.");
          if (after || around) {
            const index = list.findIndex((m) => m.id === (after || around));
            if (index < 0)
              fail(404, "Message no longer exists in this channel.");
            const start = after ? index + 1 : Math.max(0, index - 40);
            return json(
              res,
              200,
              list.slice(start, start + 200).map(messageView),
            );
          }
          if (before) {
            const index = list.findIndex((m) => m.id === before);
            list =
              index >= 0
                ? list.slice(0, index)
                : list.filter((m) => m.time < Number(before));
          }
          return json(res, 200, list.slice(-200).map(messageView));
        }
        if (method === "POST") {
          const d = await body(req);
          return json(res, 201, await createMessage(me, d));
        }
      }
      const messageMatch = route.match(
        /^\/api\/messages\/([\w-]+)(?:\/(reactions|pin))?$/,
      );
      if (messageMatch) {
        const m = state.messages.find((m) => m.id === messageMatch[1]);
        if (!m || !canRead(me, m.channel)) fail(404, "Message not found.");
        const action = messageMatch[2];
        let moderationDecision;
        if (action === "reactions" && method === "POST") {
          if (!canChannel(me, m.channel, "addReactions"))
            fail(403, "You cannot add reactions in this channel.");
          const d = await body(req);
          if (!canChannel(me, m.channel, "addReactions"))
            fail(403, "You cannot add reactions in this channel.");
          d.emoji = expressions.validateReaction(d.emoji, m.channel);
          m.reactions ||= [];
          let r = m.reactions.find((r) => r.emoji === d.emoji);
          if (!r) {
            if (m.reactions.length >= 20)
              fail(400, "Too many reactions on this message.");
            r = { emoji: d.emoji, userIds: [] };
            m.reactions.push(r);
          }
          r.userIds = r.userIds.includes(me.id)
            ? r.userIds.filter((id) => id !== me.id)
            : [...r.userIds, me.id];
          m.reactions = m.reactions.filter((r) => r.userIds.length);
        } else if (action === "pin" && method === "POST") {
          if (
            !(
              m.authorId === me.id && canChannel(me, m.channel, "sendMessages")
            ) &&
            !canChannel(me, m.channel, "manageMessages")
          )
            fail(403, "You cannot pin this message.");
          const s = serverFor(m.channel);
          if (s)
            management.log(
              s,
              me,
              m.pinned ? "Message unpinned" : "Message pinned",
              m.id,
            );
          m.pinned = !m.pinned;
        } else if (!action && method === "PATCH") {
          if (!canChannel(me, m.channel, "sendMessages"))
            fail(403, "You cannot edit messages in this channel.");
          if (m.authorId !== me.id)
            fail(403, "You can only edit your own messages.");
          const d = await body(req);
          if (!canChannel(me, m.channel, "sendMessages"))
            fail(403, "You cannot edit messages in this channel.");
          if (m.poll)
            fail(400, "Poll questions cannot be edited after posting.");
          if (!text(d.text, 2000) || !d.text.trim())
            fail(400, "Enter a message.");
          expressions.validateText(d.text, m.channel);
          moderationDecision = safety.inspect(me,m.channel,d.text,{operation:'edit',messageId:m.id});
          if(moderationDecision?.blocked) await safety.reject(me,moderationDecision,{...m,text:d.text});
          m.text = d.text.trim();
          m.editedAt = Date.now();
          safety.accept(me,m,moderationDecision);
        } else if (!action && method === "DELETE") {
          if (
            m.authorId !== me.id &&
            !canChannel(me, m.channel, "manageMessages")
          )
            fail(403, "You can only delete your own messages.");
          const s = serverFor(m.channel);
          if (s && m.authorId !== me.id)
            management.log(s, me, "Message deleted", m.id);
          collaboration.removeParents(new Set([m.id]));
          state.messages = state.messages.filter((x) => x.id !== m.id);
          await save();
          channelEvent(m.channel, {
            type: "message-delete",
            id: m.id,
            channel: m.channel,
          });
          return json(res, 200, { ok: true });
        } else fail(405, "Method not allowed.");
        await save();
        safety.notify(moderationDecision);
        channelEvent(m.channel, {
          type: "message-update",
          message: messageView(m),
        });
        return json(res, 200, messageView(m));
      }
      if (route === "/api/search" && method === "GET") {
        const q = (url.searchParams.get("q") || "").toLowerCase().slice(0, 200),
          sid = url.searchParams.get("server"),
          channel = url.searchParams.get("channel");
        const result = [...state.messages, ...state.threadMessages.filter((m) => collaboration.hasReplyAccess(m, me))]
          .filter(
            (m) =>
              canRead(me, m.channel) &&
              (!sid || serverFor(m.channel)?.id === sid) &&
              (!channel || m.channel === channel) &&
              m.text.toLowerCase().includes(q),
          )
          .sort((a, b) => a.time - b.time).slice(-100)
          .reverse();
        return json(res, 200, result.map(messageView));
      }
      if (route === "/api/files" && method === "POST") {
        const channel = url.searchParams.get("channel");
        if (
          !canChannel(me, channel, "attachFiles") ||
          !canChannel(me, channel, "sendMessages") ||
          !isText(channel)
        )
          fail(403, "No access to this channel.");
        const content = await bytes(req, 8 * 1024 * 1024);
        if (
          !canChannel(me, channel, "attachFiles") ||
          !canChannel(me, channel, "sendMessages")
        )
          fail(403, "Your channel permissions changed.");
        if (!content.length) fail(400, "This file is empty.");
        let name;
        try {
          name = decodeURIComponent(req.headers["x-file-name"] || "attachment");
        } catch {
          fail(400, "Invalid filename.");
        }
        name =
          path
            .basename(name)
            .replace(/[\r\n"\\]/g, "_")
            .slice(0, 150) || "attachment";
        const id = randomUUID(),
          file = {
            id,
            name,
            channel,
            userId: me.id,
            mime: String(
              req.headers["content-type"] || "application/octet-stream",
            ).slice(0, 100),
            size: content.length,
          };
        await writeFile(path.join(dataDir, "uploads", id), content);
        state.files.push(file);
        await save();
        return json(res, 201, file);
      }
      const fileMatch = route.match(/^\/api\/files\/([\w-]+)$/);
      if (fileMatch && method === "GET") {
        const f = state.files.find((f) => f.id === fileMatch[1]);
        if (!f || !canRead(me, f.channel)) fail(404, "Attachment not found.");
        const safeImage = [
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
        ].includes(f.mime);
        res.writeHead(200, {
          "Content-Type": safeImage ? f.mime : "application/octet-stream",
          "Content-Disposition": `${safeImage && !url.searchParams.has("download") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          "Content-Security-Policy": "default-src 'none'; sandbox",
        });
        return res.end(await readFile(path.join(dataDir, "uploads", f.id)));
      }
      if (route === "/api/typing" && method === "POST") {
        const d = await body(req);
        if (!canChannel(me, d.channel, "sendMessages")) fail(403, "No access.");
        channelEvent(d.channel, {
          type: "typing",
          channel: d.channel,
          user: publicUser(me),
        });
        return json(res, 200, { ok: true });
      }
      if (route === "/api/voice/join" && method === "POST") {
        const d = await body(req);
        const s = serverFor(d.channel);
        if (
          !s ||
          !canChannel(me, d.channel, "connect") ||
          s.channels.find((c) => c.id === d.channel)?.type !== "voice"
        )
          fail(403, "No access to this voice channel.");
        if (
          ![...clients].some(
            (c) => c.clientId === d.clientId && c.userId === me.id,
          )
        )
          fail(400, "Reconnect before joining voice.");
        for (const [id, v] of voice) if (v.userId === me.id) leaveVoice(id);
        voice.set(d.clientId, {
          clientId: d.clientId,
          userId: me.id,
          channel: d.channel,
          canSpeak: canChannel(me, d.channel, "speak"),
          canVideo: canChannel(me, d.channel, "video"),
        });
        voiceChanged(d.channel);
        return json(res, 200, { peers: voicePeers(d.channel) });
      }
      if (route === "/api/voice/leave" && method === "POST") {
        const d = await body(req);
        if (voice.get(d.clientId)?.userId === me.id) leaveVoice(d.clientId);
        return json(res, 200, { ok: true });
      }
      if (route === "/api/voice/signal" && method === "POST") {
        const d = await body(req);
        const from = voice.get(d.clientId),
          to = voice.get(d.to);
        if (
          !from ||
          from.userId !== me.id ||
          !to ||
          from.channel !== to.channel
        )
          fail(403, "Voice participant is unavailable.");
        if (!d.description && !d.candidate) fail(400, "No signal.");
        broadcast(
          {
            type: "signal",
            from: from.clientId,
            description: d.description,
            candidate: d.candidate,
          },
          (c) => c.clientId === to.clientId && c.userId === to.userId,
        );
        return json(res, 200, { ok: true });
      }
      fail(404, "Not found.");
    }
    const files = {
      "/": "site.html",
      "/app": "index.html",
      "/developers": "site.html",
      "/developers/docs": "site.html",
      "/admin": "site.html",
      "/site.css": "site.css",
      "/platform-web.js": "platform-web.js",
      "/bot-ui.js": "bot-ui.js",
      "/polls-ui.js": "polls-ui.js",
      "/community-ui.js": "community-ui.js",
      "/community.css": "community.css",
      "/conversations-ui.js": "conversations-ui.js",
      "/expressions-ui.js": "expressions-ui.js",
      "/updates-ui.js": "updates-ui.js",
      "/onboarding-ui.js": "onboarding-ui.js",
      "/onboarding.css": "onboarding.css",
      "/moderation-ui.js": "moderation-ui.js",
      "/moderation.css": "moderation.css",
      "/conversations.css": "conversations.css",
      "/bots.css": "bots.css",
      "/downloads/voxora-bot-starter.zip": "bot-starter.zip",
      "/app.js": "app.js",
      "/voice.js": "voice.js",
      "/permissions.js": "permissions.js",
      "/management-ui.js": "management-ui.js",
      "/channel-ui.js": "channel-ui.js",
      "/activity.js": "activity.js",
      "/activity-ui.js": "activity-ui.js",
      "/style.css": "style.css",
      "/icons.js": "icons.js",
    };
    const file =
      files[route] || (/^\/invite\/[\w-]+$/.test(route) ? "index.html" : null);
    if (!file) fail(404, "Not found.");
    if (file.endsWith(".zip"))
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="voxora-bot-starter.zip"',
      );
    res.writeHead(200, {
      "Content-Type": file.endsWith(".zip")
        ? "application/zip"
        : file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(await readFile(new URL("./public/" + file, import.meta.url)));
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent) {
      if (error.details?.retryAfter)
        res.setHeader("Retry-After", String(error.details.retryAfter));
      json(res, error.status || 500, {
        error: error.status
          ? error.message
          : "Something went wrong. Please try again.",
        ...(error.details || {}),
      });
    } else res.end();
  }
});
export const ready = new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(
    Number(process.env.PORT ?? 3000),
    process.env.VOXORA_HOST || "0.0.0.0",
    () => {
      console.log("Voxora running on port " + server.address().port);
      resolve(server.address());
    },
  );
});
export async function shutdown() {
  clearInterval(timeoutSweep);
  bots.close();
  for (const client of clients) client.res.end();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await writes;
}
ready.catch((error) => {
  console.error("Voxora could not start:", error.message);
  process.exitCode = 1;
});
