import {groupService} from './groups.js';
import {planningService} from './planning.js';
import {eventCenterService} from './event-center.js';
import {forwardingService} from './forwarding.js';
import {initializePersonalTools, personalToolsService} from './personal-tools.js';
import {voiceNoteService} from './voice-notes.js';
import {searchQuery,matchesSearch} from './search-filters.js';
import {
  initializeServer,
  serverView,
  managementService,
} from "./management.js";
import { serverPermissions, channelPermissions, activeLockdown } from "./public/permissions.js";
import { channelService } from "./channels.js";
import { forumService } from './forums.js';
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
import { initializeWorkspaceUser, workspaceService } from './workspace.js';
import { initializeHubUser, hubService } from './hub.js';
import { initializeScheduledUser, scheduledService } from './scheduled.js';
import { initializePremium, initializePremiumUser, activePremium, premiumPerks, publicPremium, premiumService } from './premium.js';
import { billingService, billingConfig } from './billing.js';
import {
  initializePlatform,
  platformService,
  isSuspended,
} from "./platform.js";
import {initializeStudio,studioService} from "./studio.js";
import {notebookService} from "./notebook.js";
import {resolveInvite,inviteService} from "./invites.js";
import {serverBoostService} from "./server-boosts.js";
import {pictureURL,profileImageService} from "./profile-images.js";
import {initializeCare,careService,assertJoiningAllowed} from './care.js';
import {mentionService} from "./mentions.js";
import http from "node:http";
import { createPresence } from './presence.js';
import { syncBoosterRoles, serverTagFor } from './premium.js';
import {platformReportService} from './platform-reports.js';
import {serverAssetService} from './server-assets.js';
import {voicePolicyService} from './voice-policy.js';
import {publicSafetyService} from './public-safety.js';
import {serverVerificationService,invalidateChangedVerifications} from './server-verification.js';
import {backgroundPushService} from './background-push.js';
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
initializeStudio(state);
initializeCare(state);
initializeExpressions(state);
initializeConversations(state);
initializeActivityState(state);
for (const user of state.users) { initializeWorkspaceUser(user); initializeHubUser(user); initializeScheduledUser(user); initializePersonalTools(user); }
for (const session of state.sessions) session.id ||= randomUUID();
const billingSettings=billingConfig();
initializePremium(state,{billingMode:billingSettings.mode});
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
const presence = createPresence();
const online = id => [...clients].some(c => c.userId === id) || presence.online(id);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  color: user.color,
  avatarUrl: pictureURL(user,"avatar"),
  avatarVersion: user.avatarVersion||0,
  pronouns: user.pronouns||"",
  profileLinks: user.profileLinks||[],
  bio: (user.bio || '').slice(0,premiumPerks(user).bioCharacters),
  premium: publicPremium(user),
  bot: !!user.bot,
  applicationId: user.bot ? user.applicationId : undefined,
  staffRoles: platform.badges(user),
  serverTag:serverTagFor(state,user),
  status: user.bot
    ? bots.online(user.id)
      ? "online"
      : "offline"
    : user.status === "invisible"
      ? "offline"
      : online(user.id)
        ? user.status || "online"
        : "offline",
  customStatus: user.customStatusExpiresAt && user.customStatusExpiresAt <= Date.now() ? "" : user.customStatus || "",
  timeZone: user.timeZone || "",
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
      v.baseSpeak !== p.includes("speak") ||
      v.baseVideo !== p.includes("video") ||
      v.baseScreen !== p.includes('stream') ||
      v.baseStage !== p.includes('manageStage') ||
      v.canVoiceActivity !== p.includes('useVoiceActivity')
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
  const boosted=syncBoosterRoles(state),verificationChanged=invalidateChangedVerifications(state,s=>platform.log({id:null,displayName:'Voxora'},'Server verification invalidated',s.name+' · '+s.id,'Server name or ownership changed.'));
  if(boosted||verificationChanged)save().catch(console.error);
  broadcast({ type: "refresh" });
  bots.refresh();
};
function channelEvent(channel, event) {
  broadcast(event, (c) => canRead(userById(c.userId), channel));
  bots.publish(channel, event);
  if(['message','thread-message'].includes(event.type))backgroundPush.notifyMessage(event.message).catch(()=>console.warn('A background notification could not be processed.'));
}
function messageView(m) {
  const user = userById(m.authorId);
  return {
    ...m,
    forumPost: m.forumPost ? { ...m.forumPost, title: forums.titleFor(m) } : undefined,
    thread: collaboration.summary(m.id),
    customEmojis: expressions.messageEmojis([m.text, ...(m.reactions || []).map((r) => r.emoji)].join(" "), m.channel, m.emojiAssets),
    poll: m.poll ? { ...m.poll, closed: pollClosed(m.poll) } : undefined,
    bot: !!user?.bot,
    command: bots.commandView(m.command),
    author: serverFor(m.channel)?.nicknames?.[m.authorId] || user?.displayName || m.author || "Voxora",
    username: user?.username || "voxora",
    color: user?.color || "#5865f2",
    attachments: (m.files || [])
      .map((id) => state.files.find((f) => f.id === id))
      .filter(Boolean)
      .map(({ id, name, mime, size, stickerId, stickerName,voiceNote,durationMs }) => ({
        id,
        name,
        mime,
        size,
        sticker:!!stickerId,stickerName:stickerName||null,
        ...(voiceNote?{voiceNote:true,durationMs,playbackUrl:"/api/voice-notes/"+id}:{}),
        url: "/api/files/" + id,
      })),
    reply: m.replyTo
      ? (() => {
          const r = state.messages.find((x) => x.id === m.replyTo);
          return r
            ? {
                id: r.id,
                authorId: r.authorId,
                author: serverFor(r.channel)?.nicknames?.[r.authorId] || userById(r.authorId)?.displayName || r.author,
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
    me: {...publicUser(me),focusUntil:me.focusUntil||0,customStatusExpiresAt:me.customStatusExpiresAt||null},
    tools: personalTools.snapshot(me),
    groups:groups.overview(me),
    planning:planning.home(me),
    eventCenter:eventCenter.home(me),
    savedMessageRefs: collaboration.refs(me),
    serverEmojis: expressions.forUser(me),
    platform: platform.self(me),
    activity: reads.snapshot(me),
    workspace: workspace.view(me),
    hub: hub.view(me),
    studio: studio.home(me),
    care:care.home(me),
    scheduled: scheduled.view(me),
    premium: premium.self(me),
    servers: servers.map((s) => serverView(s, me, state)),
    users: state.users.filter((u) => related.has(u.id)).map(publicUser),
    friendships: state.friendships.filter(
      (f) => f.from === me.id || f.to === me.id,
    ),
    blocked: me.blocked || [],
    conversations: state.conversations.filter((c) => c.members.includes(me.id)).map(groups.view),
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
  if(Number(req.headers['content-length'])>max)fail(413,'File or request is too large for the current limit.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max)
      fail(
        413,
        "File or request is too large for the current limit.",
      );
    chunks.push(chunk);
  }
  if (req.voxoraActor && isSuspended(req.voxoraActor))
    fail(403, "This account is suspended.");
  return Buffer.concat(chunks);
}
async function body(req, limit = 32000) {
  try {
    const value = JSON.parse((await bytes(req, limit)).toString());
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
const mentions = mentionService({state,serverFor,canRead,canChannel,publicUser,fail});
const collaboration = conversationService({ mentions, state, body, json, fail, save, refresh, notifyUser: (id, event) => broadcast(event, (c) => c.userId === id), canRead, canChannel, serverFor, userById, messageView, channelEvent, expressions, checkSlowmode, management, cleanupFiles, getModeration: () => safety, validateForumTitle: (t,me,name) => forums.validateTitleEdit(t,me,name) });
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
const workspace = workspaceService({ state, body, json, fail, save, notify: id => broadcast({type:'workspace-update'}, client => client.userId === id) });
const forums = forumService({ state, body, json, fail, save, management, serverFor, canRead, canChannel, messageView, channelEvent, createMessage, collaboration, expressions, moderation: safety });
const billing = billingService({state,bytes,json,fail,save,refresh,config:billingSettings});
async function createMessage(
  me,
  d,
  { pollCreatorId = me.id, command = null, beforeSave = null, forwardSource = null, authorize = null } = {},
) {
  if (!canChannel(me, d.channel, "sendMessages") || !isText(d.channel))
    fail(403, "You cannot message this channel.");
  const forumDraft = forums.prepare(me,d);
  const stickers=serverAssets.stickers(me,d.channel,d.stickerIds);
  if(d.files!==undefined&&!Array.isArray(d.files))fail(400,'Invalid attachments.');
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
    !text(d.text ?? "", premiumPerks(me).messageCharacters) ||
    (!(d.text || "").trim() && !d.files?.length && !stickers.length && d.poll === undefined)
  )
    fail(400, "Write a message or attach a file.");
  const poll =
    d.poll === undefined ? null : normalizePoll(d.poll, pollCreatorId, fail);
  if(poll&&!canChannel(me,d.channel,'createPolls'))fail(403,'Create Polls is required.');
  if(/https?:\/\//i.test(d.text||'')&&!canChannel(me,d.channel,'sendLinks'))fail(403,'Send Links is required.');
  expressions.validateText(d.text || "", d.channel,me);
  const files = Array.isArray(d.files) ? [...new Set(d.files)] : [];
  if (poll && (files.length||stickers.length)) fail(400, "Polls cannot include attachments or stickers.");
  if(files.some(id=>{const f=state.files.find(f=>f.id===id);return f?.voiceNote&&(f.durationMs>premiumPerks(me).voiceDurationMs||f.size>premiumPerks(me).voiceBytes);}))fail(403,'This recording exceeds your current voice message plan limits.');
  if(files.some(id=>state.files.find(f=>f.id===id)?.voiceNote)&&!canChannel(me,d.channel,"sendVoiceMessages"))fail(403,"Send Voice Messages is required.");
  if (files.length && !canChannel(me, d.channel, "attachFiles"))
    fail(403, "You do not have permission to attach files.");
  if (
    files.length+stickers.length > 5 ||
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
  if(server?.channels.find(c=>c.id===d.channel)?.media&&!stickers.length&&!files.some(id=>/^(image|video|audio)\//.test(state.files.find(f=>f.id===id)?.mime||'')))fail(400,'Media channels require an image, video, audio clip or sticker.');
  checkSlowmode(me, d.channel);
  const moderationText = (forumDraft ? forumDraft.title + '\n' + (d.text || '') : d.text || '')+(stickers.length?'\n'+stickers.map(s=>'Sticker: '+s.name).join('\n'):'');
  const decision = safety.inspect(me, d.channel, moderationText, { poll, files });
  if (decision?.blocked) await safety.reject(me, decision, { channel: d.channel, text: moderationText, files });
  const resolvedMentions = forwardSource?{recipients:[],references:[]}:mentions.resolve(me,d.channel,(d.text || "").trim() || poll?.question || "");
  let preparedStickers=[];
  if(stickers.length){const cloned=await serverAssets.cloneStickers(me,d.channel,d.stickerIds);try{if(!canChannel(me,d.channel,'sendMessages')||!isText(d.channel)||isSuspended(me)||dm?.members.some(id=>userById(id)?.blocked?.includes(me.id)||me.blocked?.includes(id)))fail(403,'Your messaging access changed.');serverAssets.stickers(me,d.channel,d.stickerIds);expressions.validateText(d.text||'',d.channel,me);if(/https?:\/\//i.test(d.text||'')&&!canChannel(me,d.channel,'sendLinks'))fail(403,'Send Links is required.');}catch(error){for(const file of cloned)await unlink(path.join(dataDir,'uploads',file.id)).catch(()=>{});throw error;}preparedStickers=cloned;files.push(...cloned.map(f=>f.id));}
  const m = {
    mentions: resolvedMentions,
    ...(forwardSource?{forwardSource}:{}),
    id: randomUUID(),
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
  try{await expressions.stamp(m,me,m.text,()=>{if(!canChannel(me,d.channel,'sendMessages')||!isText(d.channel)||isSuspended(me)||dm?.members.some(id=>userById(id)?.blocked?.includes(me.id)||me.blocked?.includes(id)))fail(403,'Your messaging access changed.');checkSlowmode(me,d.channel);authorize?.();if(files.some(id=>{const f=state.files.find(f=>f.id===id);return f?.voiceNote&&(f.durationMs>premiumPerks(me).voiceDurationMs||f.size>premiumPerks(me).voiceBytes);}))fail(403,'Your voice message plan changed.');if(!forwardSource)mentions.resolve(me,d.channel,m.text);serverAssets.stickers(me,d.channel,d.stickerIds);if(files.some(id=>state.files.find(f=>f.id===id)?.voiceNote)&&!canChannel(me,d.channel,'sendVoiceMessages'))fail(403,'Send Voice Messages is required.');if(d.files?.length&&!canChannel(me,d.channel,'attachFiles')||poll&&!canChannel(me,d.channel,'createPolls'))fail(403,'Your channel permissions changed.');});}catch(error){for(const file of preparedStickers)await unlink(path.join(dataDir,'uploads',file.id)).catch(()=>{});throw error;}
  m.mentions=forwardSource?{recipients:[],references:[]}:mentions.resolve(me,d.channel,m.text);state.files.push(...preparedStickers);m.sequence=++state.messageSequence;m.time=Date.now();
  state.messages.push(m);
  forums.attach(me,m,forumDraft);
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
  forumTools: (req,res,url,me,options) => forums.handle(req,res,url,me,options),
  studioTools: (req,res,url,me,options) => studio.handle(req,res,url,me,options),
  knowledgeTools:(req,res,url,me,options)=>care.handle(req,res,url,me,options),
  removeMessageThreads: (ids) => collaboration.removeParents(ids),
  expressions,
});
const platform = platformService({
  privateWorkspace: process.env.VOXORA_PRIVATE_WORKSPACE === '1',
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
    presence.forgetUser(id);
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
const publicSafety=publicSafetyService({state,body,json,fail,save,notifyStaff:()=>broadcast({type:'platform-reports-update'},client=>platform.permissions(userById(client.userId)).includes('reviewReports'))});
const serverVerification=serverVerificationService({state,body,json,fail,save,refresh,platform,userById});
const backgroundPush=await backgroundPushService({state,dataDir,body,json,fail,save,rate,userById,serverFor,canRead,getMessage:(id,threadId)=>{const m=(threadId?state.threadMessages:state.messages).find(m=>m.id===id);return m&&(threadId?collaboration.replyView(m):messageView(m));},hasReplyAccess:(m,me)=>collaboration.hasReplyAccess(m,me)});
const platformReports=platformReportService({state,body,json,fail,save,refresh,platform,canRead,userById});
const premium = premiumService({state,body,json,fail,save,refresh,userById,platform,billing});
const hub = hubService({state,body,json,fail,save,canRead,notify:(id,event)=>broadcast(event,c=>c.userId===id&&!isSuspended(userById(id))),sourceView:(me,ref)=>{
  const m=(ref.kind==='message'?state.messages:state.threadMessages).find(m=>m.id===ref.id);
  if(!m||!canRead(me,m.channel))return null;
  if(ref.kind==='thread'&&!state.threads.some(t=>t.id===m.threadId&&state.messages.some(parent=>parent.id===t.parentId)))return null;
  const dm=state.conversations.find(c=>c.id===m.channel);
  if(dm&&dm.members.some(uid=>me.blocked?.includes(uid)||userById(uid)?.blocked?.includes(me.id)))return null;
  const s=serverFor(m.channel),c=s?.channels.find(c=>c.id===m.channel);
  return {id:m.id,channel:m.channel,threadId:m.threadId||null,serverId:s?.id||null,serverName:s?.name||null,channelName:c?.name||'Direct message',text:m.text.slice(0,240),author:s?.nicknames?.[m.authorId]||userById(m.authorId)?.displayName||m.author||'Member'};
}});
const scheduled = scheduledService({state,body,json,fail,save,createMessage,notify:id=>broadcast({type:'scheduled-update'},c=>c.userId===id&&!isSuspended(userById(id))),
  targetView:(me,id)=>{
    if(!canRead(me,id))return null;const s=serverFor(id),c=s?.channels.find(c=>c.id===id),dm=state.conversations.find(c=>c.id===id);
    if(dm&&dm.members.some(uid=>me.blocked?.includes(uid)||userById(uid)?.blocked?.includes(me.id)))return null;
    return c?{name:c.name,serverName:s.name,serverId:s.id,kind:'channel'}:dm?{name:dm.kind==='group'?dm.name:userById(dm.members.find(uid=>uid!==me.id))?.displayName||'Direct message',kind:'dm'}:null;
  },validate:(me,d)=>{
    if(typeof d.channel!=='string'||!canChannel(me,d.channel,'sendMessages')||!isText(d.channel)||serverFor(d.channel)?.channels.find(c=>c.id===d.channel)?.forum)fail(403,'Choose an accessible text channel or direct message.');
    const dm=state.conversations.find(c=>c.id===d.channel);if(dm&&dm.members.some(uid=>me.blocked?.includes(uid)||userById(uid)?.blocked?.includes(me.id)))fail(403,'Messages are blocked for this conversation.');
    if(typeof d.text!=='string'||!d.text.trim()||d.text.length>premiumPerks(me).messageCharacters)fail(400,'Enter a message within your current character limit.');
    if(d.text.trimStart().startsWith('/'))fail(400,'Schedule plain text messages. Run slash commands from the composer.');
    if(d.replyTo!==undefined&&d.replyTo!==null&&(typeof d.replyTo!=='string'||!state.messages.some(m=>m.id===d.replyTo&&m.channel===d.channel)))fail(400,'The original reply message is no longer available.');
    expressions.validateText(d.text,d.channel,me);return d.text.trim();
  }});
const profileImages=profileImageService({state,dataDir,bytes,json,fail,save,refresh,management,userById});
await profileImages.cleanup();
const invites=inviteService({state,body,json,fail,save,refresh,management,serveImage:profileImages.serveInvite});
const serverBoosts=serverBoostService({state,body,json,fail,save,refresh,platform});
const studio=studioService({state,body,json,fail,save,canRead,canChannel,userById,management,onTaskChange:(s,t,me,action)=>planning.recordChange(s,t,me,action),notify:(serverId,channel)=>channelEvent(channel,{type:'studio-update',serverId})});
const planning=planningService({state,body,json,fail,save,canRead,canChannel,userById,management,notify:(serverId,channel)=>channelEvent(channel,{type:'planning-update',serverId})});
const groups=groupService({state,body,json,fail,save,refresh,rate,userById,onMembershipChange:c=>{for(const [id,v]of voice)if(v.channel===c.id&&!c.members.includes(v.userId))leaveVoice(id);}});
const eventCenter=eventCenterService({state,body,json,fail,save,refresh,canRead,userById,management});
const notebook=notebookService({body,json,fail,save,notify:id=>broadcast({type:'notebook-update'},c=>c.userId===id)});
const care=careService({state,body,json,fail,save,rate,canRead,userById,management,refresh,notify:(s,item,{staffOnly=false,kind='care-update',previous=null}={})=>broadcast({type:kind,serverId:s.id,ticketId:kind==='care-update'?item?.id:undefined},c=>{const u=userById(c.userId);return u&&!isSuspended(u)&&s.members.includes(u.id)&&(kind==='knowledge-update'?(care.articleVisible(s,item,u)||previous&&care.articleVisible(s,previous,u)):care.staff(s,u)||!staffOnly&&item?.createdBy===u.id);})});
const serverAssets=serverAssetService({state,dataDir,body,bytes,json,fail,save,refresh,management,serverFor,canRead,canChannel,rate,getVoice:id=>voice.get(id),getVoiceParticipants:channel=>[...voice.values()].filter(v=>v.channel===channel),playSound:(v,event)=>broadcast(event,c=>[...voice.values()].some(peer=>peer.clientId===c.clientId&&peer.channel===v.channel)&&canChannel(userById(c.userId),v.channel,'connect'))});
const forwarding=forwardingService({state,dataDir,body,json,fail,save,canRead,canChannel,collaboration,createMessage,messageView,serverFor,rate,serverAssets});
const voiceNotes=voiceNoteService({state,dataDir,bytes,json,fail,save,rate,canRead,canChannel,isText});
const personalTools=personalToolsService({state,body,json,fail,save,refresh,canRead,serverFor,messageView,collaboration,serverPermissions,notify:id=>broadcast({type:'tools-update'},c=>c.userId===id),revokeSession:async sessionHash=>{state.sessions=state.sessions.filter(s=>s.hash!==sessionHash);presence.forgetSession(sessionHash);await backgroundPush.removeSession(sessionHash);for(const c of clients)if(c.sessionHash===sessionHash){leaveVoice(c.clientId);c.res.end();}}});
const voicePolicy=voicePolicyService({voice,state,body,json,fail,management,canChannel,serverFor,userById,broadcast,leaveVoice,voiceChanged});
const careSweep=setInterval(()=>care.sweep(),1000);careSweep.unref();
const studioSweep=setInterval(()=>studio.sweep().catch(console.error),1000);studioSweep.unref();
const scheduledSweep=setInterval(()=>scheduled.sweep().catch(console.error),1000);scheduledSweep.unref();
const reminderSweep=setInterval(()=>hub.sweep().catch(console.error),1000);reminderSweep.unref();
const timeoutSweep = setInterval(() => {
  if (presence.sweep()) refresh();
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
  serverAssets.sweep().catch(console.error);
  publicSafety.sweep().catch(console.error);
  backgroundPush.sweep().catch(console.error);
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
    if(await publicSafety.handlePublic(req,res,url))return;
    if (await invites.handlePublic(req,res,url))return;
    if (route === "/api/info")
      return json(res, 200, {
        name: "Voxora",
        instanceId: state.platform.instanceId,
        privateWorkspace: process.env.VOXORA_PRIVATE_WORKSPACE === '1',
        version: appVersion,
        appPath: "/app",
        realtimeSync: true,
        capabilities: { botModeration: true, announcements: true, discovery: true, serverTemplates: true, scheduledEvents: true, threads: true, customEmoji: true, savedMessages: true, serverOnboarding: true, serverModeration: true, personalWorkspace: true, forums: true, memberDirectory:true, personalHub:true, scheduledMessages:true, communityStudio:true, projectBoards:true, giveaways:true, communityInsights:true, privateNotebook:true, profilePictures:true, serverBranding:true, customInvites:true, boostGrants:true, supportDesk:true, knowledgeBase:true, serverSafety:true, serverStickers:true, soundboard:true, serverTags:true, rolePreview:true, stageChannels:true, mediaChannels:true, rulesChannels:true, voiceModeration:true, platformReports:true, publicSafety:true, serverVerification:true, backgroundPush:backgroundPush.enabled, externalExpressions:true, messageNotifications:true, mobileLayout:true, voiceMessages:true, messageForwarding:true, advancedSearch:true,personalTools:true,plusStudio:true,groupChats:true,teamPlanning:true,eventCenter:true },
      });
    if (await billing.handlePublic(req,res,url)) return;
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
        initializeWorkspaceUser(user);
        initializeHubUser(user);
        initializeScheduledUser(user);
        initializePremiumUser(user);
        initializePersonalTools(user);
        platform.claimFirstAccount(user);
        const community = state.servers.find((s) => s.id === "community");
        if (community&&!activeLockdown(community)?.pauseInvites) {
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
        id: randomUUID(),
        agent: String(req.headers["user-agent"] || "Voxora").slice(0,160),
        createdAt: Date.now(),
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
        presence.forgetSession(auth.session.hash);
        state.sessions = state.sessions.filter(
          (s) => s.hash !== auth.session.hash,
        );
        await backgroundPush.removeSession(auth.session.hash);
        for (const c of clients)
          if (c.sessionHash === auth.session.hash) {
            leaveVoice(c.clientId);
            c.res.end();
          }
        await save();
        refresh();
        return json(
          res,
          200,
          { ok: true },
          { "Set-Cookie": cookie(req, "", true) },
        );
      }
      if (route === "/api/state" && method === "GET") {
        const clientId = url.searchParams.get('client');
        if (clientId !== null) {
          if (!/^[\w-]{8,80}$/.test(clientId)) fail(400, 'Invalid client identifier.');
          if (![...clients].some(c => c.clientId === clientId && c.sessionHash === auth.session.hash)) {
            const wasOnline = online(me.id);
            presence.touch(me.id, auth.session);
            if (!wasOnline) refresh();
          }
        }
        return json(res, 200, bootstrap(me));
      }
      if (route === '/api/sync' && method === 'GET') {
        const after = Number(url.searchParams.get('after')), threadAfter = Number(url.searchParams.get('threadAfter'));
        if (![after, threadAfter].every(n => Number.isSafeInteger(n) && n >= 0)) fail(400, 'Invalid sync position.');
        if (after > state.messageSequence || threadAfter > state.threadMessageSequence) fail(409, 'The sync position needs to be reset.');
        const allowed = m => canRead(me, m.channel) && !me.blocked?.includes(m.authorId) && !state.conversations.some(c => c.id === m.channel && c.members.some(id => userById(id)?.blocked?.includes(me.id)));
        const pending = state.messages.filter(m => m.sequence > after && allowed(m));
        const threadPending = state.threadMessages.filter(m => m.sequence > threadAfter && allowed(m) && collaboration.hasReplyAccess(m, me));
        const messages = pending.slice(0, 100), replies = threadPending.slice(0, 100);
        return json(res, 200, { messages: messages.map(messageView), threadMessages: replies.map(collaboration.replyView),
          next: pending.length > 100 ? messages.at(-1).sequence : state.messageSequence,
          threadNext: threadPending.length > 100 ? replies.at(-1).sequence : state.threadMessageSequence,
          hasMore: pending.length > 100 || threadPending.length > 100 });
      }
      const memberDirectory = route.match(/^\/api\/servers\/([\w-]+)\/members$/);
      if(memberDirectory && method==='GET'){
        const s=state.servers.find(s=>s.id===memberDirectory[1]&&s.members.includes(me.id));
        if(!s)fail(404,'Server not found.');
        const q=(url.searchParams.get('q')||'').trim().toLowerCase(),offset=Number(url.searchParams.get('offset')||0);
        if(q.length>100||!Number.isSafeInteger(offset)||offset<0)fail(400,'Invalid member search or page.');
        const users=s.members.map(userById).filter(Boolean).filter(u=>(u.username+' '+u.displayName+' '+(s.nicknames[u.id]||'')).toLowerCase().includes(q)).sort((a,b)=>(s.nicknames[a.id]||a.displayName).localeCompare(s.nicknames[b.id]||b.displayName));
        return json(res,200,{members:users.slice(offset,offset+50).map(u=>({...publicUser(u),serverNickname:s.nicknames[u.id]||null,nicknameVersion:s.nicknameRevisions[u.id]||0})),total:users.length,offset,hasMore:offset+50<users.length});
      }
      if(await groups.handle(req,res,url,me))return;
      if(await planning.handle(req,res,url,me))return;
      if(await eventCenter.handle(req,res,url,me))return;
      if(await personalTools.handle(req,res,url,me,auth.session))return;
      if(await backgroundPush.handle(req,res,url,me,auth.session))return;
      if(await voiceNotes.handle(req,res,url,me))return;
      if(await forwarding.handle(req,res,url,me))return;
      if(await care.handle(req,res,url,me))return;
      if (await profileImages.handle(req,res,url,me)) return;
      if(await serverAssets.handle(req,res,url,me))return;
      if(await voicePolicy.handle(req,res,url,me))return;
      if (await invites.handle(req,res,url,me))return;
      if (await serverBoosts.handle(req,res,url,me))return;
      if (await reads.handle(req, res, url, me)) return;
      if (await workspace.handle(req, res, url, me)) return;
      if (await hub.handle(req,res,url,me)) return;
      if (await studio.handle(req,res,url,me)) return;
      if (await notebook.handle(req,res,url,me)) return;
      if (await scheduled.handle(req,res,url,me)) return;
      if (await premium.handle(req,res,url,me)) return;
      if (await polls.handle(req, res, url, me)) return;
      if (await bots.handleHuman(req, res, url, me)) return;
      if(await platformReports.handle(req,res,url,me))return;
      if(await serverVerification.handle(req,res,url,me))return;
      if (await platform.handle(req, res, url, me)) return;
      if (await announcements.handle(req, res, url, me)) return;
      if (await community.handle(req, res, url, me)) return;
      if (await onboarding.handle(req, res, url, me)) return;
      if (await safety.handle(req, res, url, me)) return;
      if (await expressions.handle(req, res, url, me)) return;
      if (await collaboration.handle(req, res, url, me)) return;
      if (await forums.handle(req,res,url,me)) return;
      if (route === "/api/profile" && method === "PATCH") {
        const d = await body(req), next={};
        if (d.displayName !== undefined)
          next.displayName = checkedName(d.displayName, 32);
        if (d.bio !== undefined) {
          requireValue(d.bio, (x) => text(x, premiumPerks(me).bioCharacters), "Bio is too long for your current plan.");
          next.bio = d.bio;
        }
        if (d.color !== undefined) {
          requireValue(
            d.color,
            (x) => /^#[0-9a-f]{6}$/i.test(x),
            "Choose a valid color.",
          );
          next.color = d.color;
        }
        if (d.status !== undefined) {
          requireValue(
            d.status,
            (x) => ["online", "idle", "dnd", "invisible"].includes(x),
            "Invalid status.",
          );
          next.status = d.status;
        }
        if (d.customStatus !== undefined) {
          requireValue(
            d.customStatus,
            (x) => text(x, 80),
            "Status is too long.",
          );
          next.customStatus = d.customStatus;
          next.customStatusExpiresAt = null;
        }
        if(d.customStatusExpiresAt!==undefined){if(d.customStatusExpiresAt!==null&&(!Number.isSafeInteger(d.customStatusExpiresAt)||d.customStatusExpiresAt<=Date.now()||d.customStatusExpiresAt>Date.now()+7*86400000))fail(400,'Choose a status expiration within seven days.');next.customStatusExpiresAt=d.customStatusExpiresAt;}
        if(d.timeZone!==undefined){if(typeof d.timeZone!=='string'||d.timeZone.length>80)fail(400,'Choose a valid time zone.');try{if(d.timeZone)new Intl.DateTimeFormat('en',{timeZone:d.timeZone}).format();}catch{fail(400,'Choose a valid time zone.');}next.timeZone=d.timeZone;}
        if(d.pronouns!==undefined){if(typeof d.pronouns!=='string'||d.pronouns.length>40)fail(400,'Pronouns support up to 40 characters.');next.pronouns=d.pronouns.trim();}
        if(d.profileLinks!==undefined){
          if(!Array.isArray(d.profileLinks)||d.profileLinks.length>3)fail(400,'Add up to three profile links.');
          next.profileLinks=d.profileLinks.map(link=>{if(!link||typeof link!=='object'||Array.isArray(link)||Object.keys(link).some(k=>!['label','url'].includes(k))||typeof link.url!=='string'||link.url.length>2048||link.label!==undefined&&(typeof link.label!=='string'||link.label.length>40))fail(400,'Choose a link label up to 40 characters and a valid web address.');let address;try{address=new URL(link.url);}catch{fail(400,'Enter a complete HTTP or HTTPS profile link.');}if(!['https:','http:'].includes(address.protocol)||address.username||address.password)fail(400,'Profile links must use HTTP or HTTPS without embedded credentials.');return {label:link.label?.trim()||address.hostname,url:address.href};});
        }
        if (next.status !== undefined && next.status !== me.status) me.activityRevision++;
        Object.assign(me,next);
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
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          Connection: "keep-alive",
        });
        res.flushHeaders();
        res.write("retry: 1500\n: connected\n\n");
        const client = {
          userId: me.id,
          clientId,
          sessionHash: auth.session.hash,
          res,
        };
        clients.add(client);
        presence.forgetSession(auth.session.hash);
        emit(client, { type: "connected" });
        refresh();
        const heartbeat = setInterval(() => {
          if (auth.session.expires < Date.now()) res.end();
          else emit(client, { type: 'heartbeat' });
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
        return json(res, 201, serverView(s, me, state));
      }
      if (route === "/api/invites/join" && method === "POST") {
        const d = await body(req);
        const resolved=resolveInvite(state,checkedName(d.code,300));
        if(!resolved)fail(404,'That invite is invalid or has expired.');
        const {server:s,invite}=resolved;
        assertJoiningAllowed(s,me,fail);
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
        return json(res, 200, serverView(s, me, state));
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
          delete s.voiceRestrictions?.[me.id];
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
          return json(res, 200, serverView(s, me, state));
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
          (c) => c.kind!=='group' && c.members.includes(me.id) && c.members.includes(target.id),
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
          d.emoji = expressions.validateReaction(d.emoji, m.channel,me);
          await expressions.stamp(m,me,d.emoji,()=>{if(!state.messages.includes(m)||!canChannel(me,m.channel,'addReactions'))fail(403,'Your reaction access changed.');if(!m.reactions?.some(r=>r.emoji===d.emoji)&&(m.reactions?.length||0)>=20)fail(400,'Too many reactions on this message.');});
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
              !m.forumPost && m.authorId === me.id && canChannel(me, m.channel, "sendMessages")
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
          if(m.forwardSource)fail(403,"Forwarded copies cannot be edited. Delete the copy and forward again.");
          if (!canChannel(me, m.channel, "sendMessages"))
            fail(403, "You cannot edit messages in this channel.");
          if (m.authorId !== me.id)
            fail(403, "You can only edit your own messages.");
          const d = await body(req);
          if (!canChannel(me, m.channel, "sendMessages"))
            fail(403, "You cannot edit messages in this channel.");
          if (m.poll)
            fail(400, "Poll questions cannot be edited after posting.");
          if (!text(d.text, premiumPerks(me).messageCharacters) || !d.text.trim())
            fail(400, "Enter a message.");
          expressions.validateText(d.text, m.channel,me);
          moderationDecision = safety.inspect(me,m.channel,forums.moderationText(m,d.text),{operation:'edit',messageId:m.id});
          if(moderationDecision?.blocked) await safety.reject(me,moderationDecision,{...m,text:d.text});
          await expressions.stamp(m,me,d.text,()=>{if(!state.messages.includes(m)||!canChannel(me,m.channel,'sendMessages')||m.authorId!==me.id)fail(403,'Your edit access changed.');});
          m.mentions = mentions.resolve(me,m.channel,d.text.trim(),m);
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
          cleanupFiles(m.files || []);
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
        const q=searchQuery(url.searchParams.get('q')||'',fail),sid=url.searchParams.get('server'),channel=url.searchParams.get('channel');
        const result=[...state.messages,...state.threadMessages.filter(m=>collaboration.hasReplyAccess(m,me))].filter(m=>canRead(me,m.channel)&&!me.blocked?.includes(m.authorId)&&(!sid||serverFor(m.channel)?.id===sid)&&(!channel||m.channel===channel)&&matchesSearch(q,m,{author:userById(m.authorId),channel:serverFor(m.channel)?.channels.find(c=>c.id===m.channel),files:(m.files||[]).map(id=>state.files.find(f=>f.id===id)).filter(Boolean),title:forums.titleFor(m)})).sort((a,b)=>b.time-a.time).slice(0,100);
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
        const content = await bytes(req, premiumPerks(me).uploadBytes);
        if (
          !canChannel(me, channel, "attachFiles") ||
          !canChannel(me, channel, "sendMessages")
        )
          fail(403, "Your channel permissions changed.");
        if (!content.length) fail(400, "This file is empty.");
        if(content.length>premiumPerks(me).uploadBytes)fail(413,'This attachment exceeds your current plan’s upload limit.');
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
        if(!canChannel(me,channel,'attachFiles')||!canChannel(me,channel,'sendMessages')||content.length>premiumPerks(me).uploadBytes){await unlink(path.join(dataDir,'uploads',id)).catch(()=>{});fail(403,'Your upload access or plan changed.');}
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
        const voiceChannel=s.channels.find(c=>c.id===d.channel);
        if(voiceChannel.userLimit&&voicePeers(d.channel).length>=voiceChannel.userLimit&&!canChannel(me,d.channel,'bypassVoiceLimit'))fail(403,'This voice channel is full.');
        voice.set(d.clientId, {
          clientId: d.clientId,
          userId: me.id,
          channel: d.channel,
          canSpeak: canChannel(me, d.channel, "speak"),
          canVideo: canChannel(me, d.channel, "video"),
          mediaStateKnown:d.mediaStateKnown===true,cameraOn:false,screenOn:false,selfMuted:false,deafened:false,
        });
        voicePolicy.decorate(voice.get(d.clientId));
        voiceChanged(d.channel);
        return json(res, 200, { peers: voicePeers(d.channel) });
      }
      if (route === "/api/voice/leave" && method === "POST") {
        const d = await body(req);
        if (voice.get(d.clientId)?.userId === me.id) leaveVoice(d.clientId);
        return json(res, 200, { ok: true });
      }
      if(route==='/api/voice/state'&&method==='PATCH'){
        const d=await body(req),v=voice.get(d.clientId);
        if(!v||v.userId!==me.id||!canChannel(me,v.channel,'connect'))fail(403,'Join an accessible voice channel first.');
        if(Object.keys(d).some(k=>!['clientId','cameraOn','screenOn','selfMuted','deafened'].includes(k))||['cameraOn','screenOn','selfMuted','deafened'].some(k=>typeof d[k]!=='boolean'))fail(400,'Invalid voice state.');
        voicePolicy.decorate(v);
        if(d.cameraOn&&!v.canVideo||d.screenOn&&!v.canScreen)fail(403,'Your roles or Stage position do not allow this video source.');
        Object.assign(v,{mediaStateKnown:true,cameraOn:d.cameraOn,screenOn:d.screenOn,selfMuted:d.selfMuted,deafened:d.deafened});voiceChanged(v.channel);return json(res,200,{ok:true});
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
      "/plus": "site.html",
      "/developers": "site.html",
      "/developers/docs": "site.html",
      "/admin": "site.html",
      "/site.css": "site.css",
      "/website.css":"website.css",
      "/safety":"safety.html",
      "/terms":"terms.html",
      "/privacy":"privacy.html",
      "/safety-web.js":"safety-web.js",
      "/platform-web.js": "platform-web.js",
      "/bot-ui.js": "bot-ui.js",
      "/polls-ui.js": "polls-ui.js",
      "/community-ui.js": "community-ui.js",
      '/members-ui.js':'members-ui.js',
      '/members.css':'members.css',
      '/forums-ui.js':'forums-ui.js',
      '/forums.css':'forums.css',
      "/community.css": "community.css",
      "/conversations-ui.js": "conversations-ui.js",
      "/expressions-ui.js": "expressions-ui.js",
      "/updates-ui.js": "updates-ui.js",
      "/updates.css": "updates.css",
      "/voxora.css": "voxora.css",
      "/hub.css": "hub.css",
      "/hub-ui.js": "hub-ui.js",
      "/scheduled-ui.js": "scheduled-ui.js",
      "/scheduled.css": "scheduled.css",
      "/settings.css": "settings.css",
      "/settings-ui.js": "settings-ui.js",
      "/mentions-ui.js": "mentions-ui.js",
      "/emoji-completion.js":"emoji-completion.js",
      "/emoji-data.json":"emoji-data.json",
      "/studio-ui.js": "studio-ui.js",
      "/pictures-ui.js": "pictures-ui.js",
      "/care-ui.js": "care-ui.js",
      '/server-assets-ui.js':'server-assets-ui.js',
      '/install': 'install.html',
      '/manifest.webmanifest': 'manifest.webmanifest',
      '/voxora-icon.png': 'voxora-icon.png',
      '/install.js': 'install.js',
      '/sw.js': 'sw.js',
      '/offline.html': 'offline.html',
      "/realtime.js": "realtime.js",
      "/push-ui.js":"push-ui.js",
      "/mobile-ui.js":"mobile-ui.js",
      "/personal-tools-ui.js":"personal-tools-ui.js",
      "/together-ui.js":"together-ui.js",
      "/together.css":"together.css",
      "/personal-tools.css":"personal-tools.css",
      "/voice-notes-ui.js":"voice-notes-ui.js",
      "/mobile.css":"mobile.css",
      "/care.css": "care.css",
      "/invites-ui.js": "invites-ui.js",
      "/pictures.css": "pictures.css",
      "/studio.css": "studio.css",
      "/notebook-ui.js": "notebook-ui.js",
      "/mentions.js": "mentions.js",
      "/mentions.css": "mentions.css",
      "/onboarding-ui.js": "onboarding-ui.js",
      "/onboarding.css": "onboarding.css",
      "/moderation-ui.js": "moderation-ui.js",
      "/moderation.css": "moderation.css",
      "/workspace-ui.js": "workspace-ui.js",
      "/workspace-model.js": "workspace-model.js",
      "/workspace.css": "workspace.css",
      "/premium-ui.js": "premium-ui.js",
      "/premium.css": "premium.css",
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
      'Cache-Control': 'no-cache',
      "Content-Type": file.endsWith(".zip")
        ? "application/zip"
        : file.endsWith('.png') ? 'image/png'
        : file.endsWith('.json') ? 'application/json'
        : file.endsWith('.webmanifest') ? 'application/manifest+json'
        : file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      "Referrer-Policy":file==="safety.html"?"no-referrer":"same-origin",
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
  personalTools.close();
  await backgroundPush.close();
  clearInterval(timeoutSweep);
  clearInterval(reminderSweep);
  clearInterval(scheduledSweep);
  serverBoosts.close();
  clearInterval(careSweep);
  clearInterval(studioSweep);
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
