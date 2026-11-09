import {createCareUI} from './care-ui.js';
import './install.js';
import { createRealtime } from './realtime.js';
import {createServerAssetsUI} from './server-assets-ui.js';
import {createPushUI} from './push-ui.js';
import {standardEmoji,emojiChoices,createEmojiCompletion} from './emoji-completion.js';
import {inviteCard,invitePreview} from './invites-ui.js';
import { createManagementUI } from "./management-ui.js";
import { createChannelUI } from "./channel-ui.js";
import { createActivityUI } from "./activity-ui.js";
import { createBotUI } from "./bot-ui.js";
import { createPollUI } from "./polls-ui.js";
import { createCommunityUI } from "./community-ui.js";
import { createConversationUI } from "./conversations-ui.js";
import { createMemberUI } from './members-ui.js';
import { createForumUI } from './forums-ui.js';
import { createScheduledUI } from "./scheduled-ui.js";
import {applyPicture,serverMark,serverBanner,createPictureUI,verificationBadge} from "./pictures-ui.js";
import { createStudioUI } from "./studio-ui.js";
import { createNotebookUI } from "./notebook-ui.js";
import { createHubUI } from './hub-ui.js';
import { createExpressionUI } from "./expressions-ui.js";
import { renderUpdates, mountUpdateNotice } from "./updates-ui.js";
import { createOnboardingUI } from './onboarding-ui.js';
import { createModerationUI } from './moderation-ui.js';
import { createWorkspaceUI } from './workspace-ui.js';
import { createPremiumUI } from './premium-ui.js';
import { createMentionPicker } from "./mentions-ui.js";
import { mentionsUser } from "./activity.js";
import {
  memberRoles,
  highestRole,
  channelPermissions,
  timedOut,
  outranks,
} from "./permissions.js";
import { icon } from "./icons.js";
import { Voice } from "./voice.js";
const $ = (id) => document.getElementById(id);
const node = (tag, cls = "", content) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (content !== undefined)
    e.append(...(Array.isArray(content) ? content : [content]));
  return e;
};
const run = (fn) => async (event) => {
  try {
    return await fn(event);
  } catch (error) {
    toast(error.message, true);
  }
};
function button(label, fn, cls = "secondary", symbol) {
  const b = node("button", cls);
  b.type = "button";
  if (symbol) b.append(icon(symbol));
  if (label) {
    b.append(document.createTextNode(label));
    b.setAttribute("aria-label", label);
  }
  b.onclick = run(fn);
  return b;
}
function ib(name, title, fn, cls = "") {
  const b = button("", fn, "icon-button " + cls, name);
  b.title = title;
  b.setAttribute("aria-label", title);
  return b;
}
function toast(message, error = false) {
  const t = node("div", "toast" + (error ? " error" : ""), message);
  $("toast-stack").append(t);
  setTimeout(() => t.remove(), 5500);
}
async function api(route, method = "GET", data, options = {}) {
  const response = await fetch("/api" + route, {
    method,
    headers:
      data !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: options.signal,
  });
  const result = await response.json();
  if (!response.ok) {
    const e = new Error(result.error || "Request failed.");
    e.status = response.status;
    e.nextAllowedAt = result.nextAllowedAt;
    throw e;
  }
  return result;
}
mountUpdateNotice({node,button});
const storage = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem("voxora:" + key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem("voxora:" + key, JSON.stringify(value));
  },
};
let state,
  route = { kind: "channel", server: "community", channel: "general" },
  messages = [],
  messageRevision = 0,
  eventSource,
  loadId = 0,
  panel = "members",
  signup = false,
  reply = null,
  pendingFiles = [],
  searchQuery = "",
  friendTab = "Online",
  friendQuery = "",
  editing = null,
  hasOlder = false;
let sending = false,
  hasNewer = false,
  viewBoundary = null,
  readSuppression = 0,
  readTimer;
let commandTimer,
  commandChoice = null,
  commandRequest = 0;
let refreshTask = null,
  refreshAgain = false;
const typing = new Map();
const clientId = sessionStorage.getItem("voxora-client") || crypto.randomUUID();
let connectionPhase = 'connecting';
let notificationSequence = 0, threadNotificationSequence = 0, syncSupported = true;
sessionStorage.setItem("voxora-client", clientId);
const preferences = storage.get("preferences", {
  theme: "dark",
  accent: "mint",
  compact: false,
  fontSize: 15,
  reducedMotion: false,
  volume: 1,
  inputDevice: "",
});
const collapsed = storage.get("collapsed", {});
let drafts = {},composerAccount=null;
function writeDraft(channel,value,account=me()?.id){
  if(!account||account!==me()?.id||typeof channel!=='string')return;
  const saved=storage.get('drafts:'+account,{});if(value)saved[channel]=value;else delete saved[channel];drafts=saved;storage.set('drafts:'+account,saved);
}
const voice = new Voice({
  api,
  clientId,
  getState: () => state,
  preferences,
  onChange: () => {
    serverAssetsUI.enforcePlayback();
    renderUserControls();
    renderVoiceSidebar();
    if (route.kind === "voice") renderCall();
  },
  toast,
});
const me = () => state?.me;
const backgroundPushUI=createPushUI({node,button,input,api,getState:()=>state,toast,onOpen:openMessage});
const serverAssetsUI=createServerAssetsUI({node,button,input,field,formDialog,modal,confirmDialog,api,refreshState,getState:()=>state,getRoute:()=>route,getVoice:()=>voice,preferences,toast,onMessage:async m=>{if(me()?.id!==m.authorId||route.channel!==m.channel)return;noteOwnMessage(m);if(hasNewer){hasNewer=false;messages=[];await loadMessages();}if(!messages.some(x=>x.id===m.id))messages.push(m);messageRevision++;renderMessages();scrollBottom();}});
const person = (id) =>
  state?.users.find((u) => u.id === id) || {
    id,
    displayName: "Unknown user",
    username: "unknown",
    color: "#80848e",
    status: "offline",
  };
const selectedServer = () => state?.servers.find((s) => s.id === route.server);
const selectedChannel = () =>
  selectedServer()?.channels.find((c) => c.id === route.channel);
const selectedDM = () =>
  state?.conversations.find((c) => c.id === route.channel);
const dmPerson = (c) => person(c.members.find((id) => id !== me().id));
const channelName = (id) => {
  for (const s of state.servers) {
    const c = s.channels.find((c) => c.id === id);
    if (c) return c.name;
  }
  const c = state.conversations.find((c) => c.id === id);
  return c ? dmPerson(c).displayName : "conversation";
};
const isOwner = () => selectedServer()?.ownerId === me()?.id;
let profilePreviewRender=null;
let memberManagementView=null;
const pictureUI=createPictureUI({node,button,input,getState:()=>state,refreshState,toast,onAvatarChange:()=>profilePreviewRender?.()});
const manage = createManagementUI({
  node,
  button,
  ib,
  input,
  field,
  modal,
  formDialog,
  confirmDialog,
  api,
  getState: () => state,
  getServer: selectedServer,
  person,
  avatar,
  pictureControl:options=>pictureUI.control(options),
  refreshState,
  toast,
  copy,
  profile,
  renderChannels: (s, content) => channelsUI.renderManager(s, content),
  renderBots: (s, content) => botUI.integrations(s, content),
  renderDiscovery: (s, content) => communityUI.listing(s, content),
  renderEmoji: (s, content) => expressionUI.manager(s, content),
  renderAssets:(s,kind,content)=>serverAssetsUI.manager(s,kind,content),
  renderServerTag:(s,content)=>serverAssetsUI.tagSettings(s,content),
  renderOnboarding: (s, content) => onboardingUI.manager(s, content),
  renderAutoMod: (s, content) => safetyUI.rulesManager(s, content),
  renderModeration: s => safetyUI.queue(s),
  openCare:(s,tab)=>careUI.open(s.id,tab),
  openChannelSettings:(s,c,tab)=>channelsUI.openSettings(c,s,tab),
});
const channelsUI = createChannelUI({
  node,
  button,
  ib,
  input,
  field,
  modal,
  formDialog,
  confirmDialog,
  api,
  getState: () => state,
  getRoute:()=>route,
  renderPermissions:(s,c,target,onSaved)=>manage.renderPermissions(s,c,target,onSaved),
  renderForum:(c,target,onSaved)=>forumsUI.settings(c,target,onSaved),
  renderFollowing:(c,target,onSaved)=>followingDialog(c,target,onSaved),
  has: (s, permission) => manage.has(s, permission),
  refreshState,
  navigate,
  permissions: (s,c,back=false)=>channelsUI.openSettings(c,s,"Permissions",back),
  openManager: (s) => s && manage.open(s, "Channels"),
  toast,
});
const activityUI = createActivityUI({
  api,
  node,
  button,
  ib,
  input,
  field,
  formDialog,
  getState: () => state,
  getRoute: () => route,
  channelName,
  storage,
  toast,
  openMessage,
  onAckDone: scheduleRead,
  onUnread: (channel, cursor) => {
    if (route.channel === channel) {
      viewBoundary = cursor;
      const top = $("chat-scroll").scrollTop;
      renderMessages();
      $("chat-scroll").scrollTop = top;
    }
  },
  onChange: () => {
    if (!state) return;
    // Activity summaries may arrive before their live messages. Only a view
    // already browsing older history should stay detached from the live tail.
    if (hasNewer && messages.length && ["channel", "dm"].includes(route.kind))
      hasNewer =
        (activityUI.entry(route.channel)?.latestSequence || 0) >
        messages.at(-1).sequence;
    const active = activityUI.entry(route.channel);
    if (
      active?.unread &&
      viewBoundary === null &&
      ["channel", "dm"].includes(route.kind)
    ) {
      viewBoundary = active.cursor;
      const top = $("chat-scroll").scrollTop;
      renderMessages();
      $("chat-scroll").scrollTop = top;
    }
    renderRail();
    renderSidebar();
    updateNewMessagesBar();
    if (panel === "inbox") renderPanel();
    const mentions = Object.entries(state.activity?.channels || {})
      .filter(([id]) => !activityUI.entry(id)?.muted)
      .reduce((sum, [, c]) => sum + c.mentions, 0);
    const title =
      route.kind === 'home' ? 'Home' : route.kind === "friends"
        ? "Friends"
        : (route.kind === "dm" ? "@" : "#") + channelName(route.channel);
    document.title =
      (mentions ? "(" + mentions + ") " : "") + title + " | Voxora";
    if(route.kind==='home')hubUI.render($('home-view'));
  },
});
const unreadCount = (id) => activityUI.entry(id)?.unread || 0;
const unreadVisible = (id) =>
  unreadCount(id) > 0 && !activityUI.entry(id)?.muted;
const mentionCount = (id) =>
  activityUI.entry(id)?.muted ? 0 : activityUI.entry(id)?.mentions || 0;
const hubUI=createHubUI({node,button,ib,input,field,formDialog,modal,api,getState:()=>state,getRoute:()=>route,navigate,openMessage,toast,
  notifyReminder:()=>activityUI.notifyReminder(),renderExtras:(main,side)=>{careUI.renderHome(main,side);studioUI.renderHome(main,side);notebookUI.renderHome(main,side);scheduledUI.renderHome(main,side);},onChange:()=>{if(state&&!$('shell').hidden){renderAppbar();renderSidebar();const star=$('topbar').querySelector('.star-action');if(star){const label=hubUI.isStarred(route.channel)?'Unstar Channel':'Star Channel';star.title=label;star.setAttribute('aria-label',label);star.classList.toggle('is-starred',hubUI.isStarred(route.channel));}}}});
const scheduledUI=createScheduledUI({node,button,input,field,formDialog,modal,api,getState:()=>state,getRoute:()=>route,getDrafts:()=>storage.get('drafts:'+me()?.id,{}),writeDraft,navigate,openMessage,toast,onChange:()=>{if(state&&!$('shell').hidden){renderAppbar();if(route.kind==='home')hubUI.render($('home-view'));}}});
const careUI=createCareUI({node,button,input,field,formDialog,modal,confirmDialog,api,getState:()=>state,refreshState,toast,formatted});
const studioUI=createStudioUI({node,button,input,field,formDialog,modal,confirmDialog,api,getState:()=>state,toast,refreshState,openMessage,openCare:(id,tab)=>careUI.open(id,tab)});
const notebookUI=createNotebookUI({node,button,input,field,formDialog,modal,api,getState:()=>state,toast});
const botUI = createBotUI({
  node,
  button,
  input,
  field,
  modal,
  formDialog,
  confirmDialog,
  api,
  getState: () => state,
  refreshState,
  toast,
  copy,
  openIntegrations: (s) => s && manage.open(s, "Bots & Apps"),
  assignRoles: (s, id) => manage.assignDialog(s, id),
});
const pollUI = createPollUI({
  node,
  button,
  input,
  field,
  formDialog,
  api,
  getRoute: () => route,
  getMe: me,
  person,
  toast,
  canVote: () => hasChannel("addReactions"),
  canEnd: (m) =>
    hasChannel("manageMessages") ||
    ([m.authorId, m.poll.creatorId].includes(me().id) &&
      hasChannel("sendMessages")),
  onCreated: (m) => {
    if (route.channel === m.channel) {
      messageRevision++;
      if (!messages.some((x) => x.id === m.id)) messages.push(m);
      renderMessages();
      scrollBottom();
    }
  },
});
function staffBadges(user) {
  const badges=(user.staffRoles || []).map((role) => {
    const b = node("span", "staff-tag", role.name);
    b.style.color = role.color;
    return b;
  });
  if(user.serverTag){const tag=node('span','server-tag',user.serverTag.text);tag.style.color=user.serverTag.color;tag.title='Server tag · '+user.serverTag.text;badges.push(tag);}
  if(user.premium?.badge)badges.push(node('span','plus-badge','PLUS'));
  return badges;
}
const hasServer = (p, s = selectedServer()) => (s ? manage.has(s, p) : false);
const communityUI = createCommunityUI({ node, button, input, field, modal, formDialog, confirmDialog, api, getState: () => state, hasServer, refreshState, navigate, toast, copy, onEnter: s => onboardingUI.maybeShow(s) });
const conversationUI = createConversationUI({ node, button, ib, input, field, modal, formDialog, confirmDialog, api, getState: () => state, getRoute: () => route, storage, refreshState, navigate, openMessage, formatted, emojiVisual, emojiPicker, toast, reportMessage: m => safetyUI.report(m), remindMessage: source => hubUI.editor(source), showThreadPanel: () => { panel = "thread"; renderPanel(); }, closeThreadPanel: () => { panel = "members"; renderPanel(); } });
const membersUI=createMemberUI({node,input,button,modal,getState:()=>state,getServer:selectedServer,person,memberRow,memberRoles,invite:s=>inviteDialog(s)});
const forumsUI=createForumUI({node,button,ib,input,field,formDialog,confirmDialog,api,getState:()=>state,getChannel:selectedChannel,storage,refreshState,openThread:(...args)=>conversationUI.openThread(...args),formatted,toast,openSettings:c=>channelsUI.openSettings(c,state.servers.find(s=>s.channels.some(item=>item.id===c.id)),"Forum"),markRead:id=>activityUI.markRead(id),acknowledge:(...args)=>activityUI.acknowledge(...args)});
const expressionUI = createExpressionUI({ node, button, input, field, formDialog, confirmDialog, api, refreshState, toast });
const onboardingUI = createOnboardingUI({ node, button, input, field, modal, api, getState: () => state, getRoute: () => route, navigate, refreshState, toast });
const safetyUI = createModerationUI({ node, button, input, field, modal, formDialog, api, getState: () => state, refreshState, openMessage, openSettings: (s,tab) => manage.open(s,tab), toast });
const workspaceUI = createWorkspaceUI({ node, button, input, field, formDialog, confirmDialog, context, api, getState:()=>state, getRoute:()=>route, storage, preferences, applyPreferences, renderRail, openSettings:settings, toast, serverButton:railServer, unreadCount, mentionCount, unreadVisible, markRead:id=>activityUI.markAll(id) });
const premiumUI=createPremiumUI({node,button,input,field,formDialog,api,getState:()=>state,refreshState,toast});
function hasChannel(p) {
  if (route.kind === "dm") return p !== "manageMessages";
  return selectedChannel()?.permissions?.includes(p) || false;
}
function updateComposerPermissions() {
  if(route.kind==='channel'&&selectedChannel()?.forum){$('composer-wrap').hidden=true;return;}
  $('message-input').maxLength=state?.premium?.perks.messageCharacters||2000;
  const permitted = hasChannel("sendMessages");
  $("message-input").disabled = !permitted;
  $("send-message").disabled = !permitted;
  $("composer-plus").disabled = !permitted || !hasChannel("attachFiles");
  $("composer-emoji").disabled = !permitted;
  $("composer-poll").disabled = !permitted;
  $("composer-schedule").disabled = !permitted || sending;
  if (!permitted)
    $("message-input").placeholder = timedOut(selectedServer(), me().id)
      ? "You are timed out in this server."
      : "You do not have permission to send messages in this channel.";
  else
    $("message-input").placeholder =
      route.kind === "dm"
        ? "Message @" + dmPerson(selectedDM()).displayName
        : "Message #" + selectedChannel()?.name;
  updateSlowmode();
}
function slowmodeRemaining() {
  return route.kind === "channel"
    ? Math.max(0, (state?.cooldowns?.[route.channel] || 0) - Date.now())
    : 0;
}
function updateSlowmode() {
  const status = $("slowmode-status"),
    c = selectedChannel();
  status.hidden = route.kind !== "channel" || !c?.slowmode;
  if (!status.hidden) {
    const exempt = hasChannel("manageMessages") || hasServer("manageChannels");
    const seconds = Math.ceil(slowmodeRemaining() / 1000);
    const waiting =
      Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
    status.textContent = exempt
      ? "Slowmode: " + c.slowmode + "s · You are exempt."
      : seconds > 0
        ? "Slowmode · You can send again in " + waiting
        : "Slowmode is enabled · One message every " + c.slowmode + " seconds.";
    status.classList.toggle("waiting", !exempt && seconds > 0);
  }
  if (state && ["channel", "dm"].includes(route.kind))
    $("send-message").disabled =
      sending || !hasChannel("sendMessages") || slowmodeRemaining() > 0;
}
function noteOwnMessage(m) {
  if (m.authorId !== me()?.id) return;
  const s = state.servers.find((s) =>
    s.channels.some((c) => c.id === m.channel),
  );
  const c = s?.channels.find((c) => c.id === m.channel);
  if (
    c?.slowmode &&
    !c.permissions.includes("manageMessages") &&
    !manage.has(s, "manageChannels")
  ) {
    state.cooldowns ||= {};
    state.cooldowns[m.channel] = m.time + c.slowmode * 1000;
  }
  updateSlowmode();
}
setInterval(() => {
  if (state) updateSlowmode();
}, 1000);

function avatar(user, size = "", presence = false) {
  const a = node(
    "span",
    "avatar " + size,
    [node("span","avatar-initial",String(user.displayName || user.name || "V").slice(0,1).toUpperCase())],
  );
  a.style.background = user.color || "#5865f2";
  applyPicture(a,user.avatarUrl);
  if (presence) a.append(node("i", "status-dot " + (user.status || "offline")));
  return a;
}
function applyPreferences() {
  document.body.dataset.accent=preferences.accent||'mint';
  document.body.classList.toggle("light-mode", preferences.theme === "light");
  document.body.classList.toggle("compact", preferences.compact);
  document.body.classList.toggle('reduced-motion', !!preferences.reducedMotion);
  for(const b of document.querySelectorAll('.theme-choice[data-theme]'))b.classList.toggle('active',b.dataset.theme===preferences.theme);
  const compact=document.getElementById('workspace-compact'),font=document.getElementById('workspace-font'),motion=document.getElementById('workspace-reduced-motion');
  const accent=document.getElementById('workspace-accent');if(accent)accent.value=preferences.accent||'mint';
  if(compact)compact.checked=!!preferences.compact;
  if(font&&document.activeElement!==font)font.value=preferences.fontSize;
  if(motion)motion.checked=!!preferences.reducedMotion;
  document.documentElement.style.setProperty(
    "--font-size",
    (preferences.fontSize || 15) + "px",
  );
  storage.set("preferences", preferences);
}
applyPreferences();
function closeOverlays() {
  $("context-menu").hidden = true;
  $("emoji-picker").hidden = true;
}
$("modal-close").append(icon("close"));
$("modal-close").onclick = () => $("modal").close();
$('modal').addEventListener('close',()=>{const menu=$('context-menu');menu.hidden=true;if(menu.parentElement!==document.body)document.body.append(menu);});
$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) {
    const r = $("modal").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      $("modal").close();
  }
});
function modal(children, cls = "") {
  closeOverlays();
  $("modal").className = cls;
  $("modal-content").replaceChildren(...children);
  if (!$("modal").open) $("modal").showModal();
}
function input(value = "", placeholder = "", type = "text") {
  const e = node("input");
  e.type = type;
  e.value = value;
  e.placeholder = placeholder;
  return e;
}
function field(label, control) {
  const l = node("label", "", label);
  l.append(control);
  return l;
}
function formDialog({
  title,
  description,
  fields,
  submit,
  submitLabel = "Save Changes",
  danger = false,
}) {
  const f = node("form");
  const error = node("div", "form-error");
  const save = node(
    "button",
    danger ? "danger-button" : "primary",
    submitLabel,
  );
  save.type = "submit";
  const footer = node("div", "modal-footer", [
    button("Cancel", () => $("modal").close(), "cancel"),
    save,
  ]);
  f.append(node("h2", "", title));
  if (description) f.append(node("p", "dialog-description", description));
  for (const item of fields) f.append(item);
  f.append(error, footer);
  f.onsubmit = async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      await submit();
      if ($("modal-content").contains(f)) $("modal").close();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      save.disabled = false;
    }
  };
  modal([f]);
  setTimeout(() => { if(f.isConnected&&!f.contains(document.activeElement))f.querySelector('input,textarea')?.focus(); }, 30);
}
function confirmDialog(title, description, fn) {
  formDialog({
    title,
    description,
    fields: [],
    submit: fn,
    submitLabel: "Confirm",
    danger: true,
  });
}
function context(event, items) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const menu = $("context-menu");
  const parent=$('modal').open?$('modal'):document.body;
  if(menu.parentElement!==parent)parent.append(menu);
  menu.replaceChildren();
  for (const item of items) {
    if (!item) {
      menu.append(node("div", "context-separator"));
      continue;
    }
    const b = button(
      item.label,
      async (click) => {
        click.stopPropagation();
        menu.hidden = true;
        await item.run();
      },
      "context-item" + (item.danger ? " danger" : ""),
    );
    if (item.icon) b.append(icon(item.icon, 16));
    menu.append(b);
  }
  menu.hidden = false;
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  menu.style.left =
    Math.min(event?.clientX || rect?.left || 100, innerWidth - 220) + "px";
  menu.style.top =
    Math.min(
      event?.clientY || rect?.bottom || 100,
      innerHeight - menu.offsetHeight - 12,
    ) + "px";
  menu.style.left=Math.max(8,parseFloat(menu.style.left))+'px';menu.style.top=Math.max(8,parseFloat(menu.style.top))+'px';
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#context-menu")) $("context-menu").hidden = true;
  if (!e.target.closest("#emoji-picker") && !e.target.closest("[data-emoji]"))
    $("emoji-picker").hidden = true;
});
const emojiList = [
  ["😀", "grinning smile"],
  ["😂", "joy laugh"],
  ["🤣", "rolling laughing"],
  ["😊", "blush smile"],
  ["😍", "heart eyes"],
  ["🥹", "happy tears"],
  ["😎", "cool sunglasses"],
  ["🤔", "thinking"],
  ["😭", "cry sob"],
  ["😅", "sweat smile"],
  ["👀", "eyes"],
  ["🔥", "fire"],
  ["❤️", "red heart love"],
  ["💜", "purple heart"],
  ["💙", "blue heart"],
  ["✨", "sparkles"],
  ["🎉", "party celebration"],
  ["🙌", "raised hands"],
  ["👍", "thumbs up"],
  ["👎", "thumbs down"],
  ["💯", "hundred"],
  ["✅", "check"],
  ["🚀", "rocket"],
  ["💀", "skull"],
  ["🤝", "handshake"],
  ["🙏", "pray thanks"],
  ["👋", "wave hello"],
  ["😴", "sleeping"],
  ["🤯", "mind blown"],
  ["😈", "devil"],
  ["🥳", "party face"],
  ["🤩", "star struck"],
  ["💻", "computer"],
  ["🎮", "game gaming"],
  ["🎵", "music"],
  ["🍕", "pizza"],
  ["☕", "coffee"],
  ["🌈", "rainbow"],
  ["🐱", "cat"],
  ["🐶", "dog"],
  ["💪", "strong muscle"],
  ["🫡", "salute"],
  ["🤷", "shrug"],
  ["🫶", "heart hands"],
  ["🫠", "melting"],
  ["📌", "pin"],
  ["⚡", "lightning"],
  ["💬", "chat"],
];
function emojiVisual(value, custom = []) {
  const match = /^<:([A-Za-z0-9_]{2,32}):([a-f0-9-]{36})>$/.exec(value);
  if (!match) return node("span", "", value);
  let emoji = custom.find((e) => e.id === match[2]);
  if (emoji?.url.startsWith("/api/emojis/")) emoji = state.serverEmojis?.find((e) => e.id === match[2]);
  if (!emoji) return node("span", "", ":" + match[1] + ":");
  const image = node("img", "server-emoji"); image.src = emoji.url; image.alt = image.title = ":" + emoji.name + ":"; image.loading = "lazy";
  image.onerror = () => image.replaceWith(document.createTextNode(image.alt)); return image;
}
function emojiPicker(event, callback, channel=route.channel) {
  event.stopPropagation();
  const picker = $("emoji-picker"),account=me()?.id;
  const search = input("", "Find the perfect emoji"),grid=node("div","emoji-grid"),status=node('small');
  let standards=emojiList.map(([emoji,description])=>({emoji,description,names:[description.replaceAll(' ','_')],tags:description.split(' ')}));
  const render=()=>{
    if(me()?.id!==account)return picker.hidden=true;
    const choices=emojiChoices(state,channel,search.value.toLowerCase().replace(/^:/,''),standards,180);
    grid.replaceChildren(...choices.map(choice=>{
      const b=button(choice.emoji||'',()=>{picker.hidden=true;return callback(choice.insert);},'emoji-choice');
      b.setAttribute('aria-label',choice.emoji||':'+choice.name+':');b.title=':'+choice.name+': · '+choice.detail;b.disabled=!!choice.reason;
      if(choice.url){const image=node('img','server-emoji');image.src=choice.url;image.alt=':'+choice.name+':';b.append(image);}return b;
    }));
    status.textContent=choices.length===180?'Showing 180 matches · Type a name to find more':'EMOJI · Type :name: in chat for suggestions';
  };
  search.oninput=render;render();picker.replaceChildren(search,grid,status);picker.hidden=false;
  const rect=event.currentTarget.getBoundingClientRect();picker.style.left=Math.max(8,Math.min(rect.right-330,innerWidth-338))+'px';picker.style.top=Math.max(8,rect.top-picker.offsetHeight-8)+'px';search.focus();
  standardEmoji().then(data=>{if(search.isConnected&&me()?.id===account){standards=data;render();}}).catch(()=>{});
}

function userMenu(event) {
  context(event, [
    {
      label: "Set Online",
      icon: "check",
      run: () => activityUI.setStatus("online"),
    },
    {
      label: "Idle",
      icon: "volume",
      run: () => activityUI.setStatus("idle"),
    },
    {
      label: "Do Not Disturb",
      icon: "bell",
      run: () => activityUI.setStatus("dnd"),
    },
    {
      label: "Invisible",
      icon: "shield",
      run: () => activityUI.setStatus("invisible"),
    },
    null,
    {
      label: "Set a custom status",
      icon: "edit",
      run: () => {
        const value = input(me().customStatus || "", "What’s happening?");
        value.maxLength = 80;
        formDialog({
          title: "Set a custom status",
          fields: [field("STATUS", value)],
          submit: () => api("/profile", "PATCH", { customStatus: value.value }),
        });
      },
    },
    {
      label: "Edit Profile",
      icon: "settings",
      run: () => settings("Profiles"),
    },
  ]);
}
function renderRail() {
  renderAppbar();
  const rail = $("server-rail");
  const home = button(
    "",
    () => navigate({ kind: "friends" }),
    "rail-item" +
      (route.kind === "friends" || route.kind === "dm" ? " active" : ""),
  );
  home.title = "Direct Messages";
  home.setAttribute("aria-label", "Direct Messages");
  home.append(icon('friends'),node('span','rail-label','Chats'));
  const dmUnread = state.conversations.reduce(
    (sum, c) => sum + (unreadVisible(c.id) ? unreadCount(c.id) : 0),
    0,
  );
  if (dmUnread)
    home.append(node("span", "rail-mention-badge", String(dmUnread)));
  home.setAttribute("aria-description", dmUnread + " unread direct messages");
  rail.replaceChildren(home, node("div", "rail-separator"));
  workspaceUI.render(rail);
  const end=node('div','rail-separator');end.setAttribute('aria-label','Move server to end');workspaceUI.dropTarget(end);rail.append(end);
  const add = ib("plus", "Add a Server", () => serverDialog(), "");
  add.className = "rail-item add-server";
  const discover = ib("compass", "Discover Servers", () => communityUI.discovery());
  discover.className = "rail-item add-server";
  rail.append(add, discover, node("div", "rail-spacer"));
  const download = ib("download", "Download the Windows app", () => {
    window.open("https://github.com/Whoops-Lambo/Voxora", "_blank", "noopener");
  });
  download.className = "rail-item add-server";
  rail.append(download);
}
function renderAppbar(){
  const bar=$('appbar');if(!state||!bar)return;
  if(!bar.childElementCount){
    const brand=button('',()=>navigate({kind:'home'}),'app-brand');brand.setAttribute('aria-label','Voxora Home');brand.append(node('span','voxora-emblem','V'),node('span','','VOXORA'));
    const jump=button('',quickSwitcher,'app-jump');jump.setAttribute('aria-label','Jump anywhere');jump.append(icon('search',17),node('span','','Jump anywhere'),node('kbd','','Ctrl K'));
    const reminders=button('Reminders',()=>hubUI.openReminders(),'app-reminders','calendar');reminders.append(node('span','reminder-count',''));
    const outbox=button('Outbox',()=>scheduledUI.openOutbox(),'app-outbox','clock');outbox.setAttribute('aria-label','Scheduled Messages');outbox.append(node('span','outbox-count',''));
    const connection=button('',()=>settings('Server Connection'),'connection-indicator');connection.id='connection-indicator';connection.setAttribute('aria-label','Connection status');
    bar.append(brand,node('nav','app-navigation',[button('Home',()=>navigate({kind:'home'}),'app-home'),button('Chats',()=>navigate({kind:'friends'}),'app-chats'),button('Studio',()=>studioUI.choose(),'app-studio'),button('Explore',()=>communityUI.discovery(),'app-explore')]),jump,connection,ib('edit','Notebook',()=>notebookUI.open(),'app-notebook'),reminders,outbox,ib('plus','Create or Join Community',serverDialog));
  }
  bar.querySelector('.app-home').setAttribute('aria-label','Open Home');bar.querySelector('.app-chats').setAttribute('aria-label','Open Chats');
  bar.querySelector('.app-home').classList.toggle('active',route.kind==='home');bar.querySelector('.app-chats').classList.toggle('active',['friends','dm'].includes(route.kind));
  const count=state.hub?.dueCount||0,badge=bar.querySelector('.reminder-count');badge.textContent=String(count);badge.hidden=!count;
  const queued=state.scheduled?.queuedCount||0,outboxBadge=bar.querySelector('.outbox-count');outboxBadge.textContent=String(queued);outboxBadge.hidden=!queued;
  const connection=bar.querySelector('.connection-indicator');connection.dataset.phase=connectionPhase;connection.textContent=(state.platform?.scope==='private'?'Local · ':'')+({live:'Live',fallback:'Syncing',offline:'Offline',connecting:'Connecting'}[connectionPhase]||'Connecting');connection.title=location.origin+' · '+connectionDescription();
}
function connectionDescription(){return {live:'Live updates connected.',fallback:'Live stream interrupted. Messages and friend requests are syncing every 5 seconds.',offline:'Unable to sync. Retrying automatically; your draft is saved on this device.',connecting:'Connecting and checking for missed updates…'}[connectionPhase];}
function railServer(s) {
    const active =
      route.server === s.id && ["channel", "voice"].includes(route.kind);
    const b = button(
      s.name
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 3)
        .join(""),
      () =>
        navigate({
          kind: "channel",
          server: s.id,
          channel:
            s.channels.find((c) => c.type === "text")?.id || s.channels[0]?.id,
        }),
      "rail-item" +
        (active ? " active" : "") +
        (s.channels.some((c) => unreadVisible(c.id)) ? " unread" : ""),
    );
    b.style.background = active ? s.color : "";
    b.replaceChildren(serverMark(s,'community-letter'),node('span','rail-label',s.name));b.style.background='';b.style.setProperty('--community-color',s.color);
    b.title = s.name;
    b.setAttribute("aria-label", s.name);
    b.oncontextmenu = (e) => serverMenu(e, s);
    const mentions = s.channels.reduce((sum, c) => sum + mentionCount(c.id), 0);
    const total = s.channels.reduce((sum, c) => sum + unreadCount(c.id), 0);
    b.setAttribute(
      "aria-description",
      total + " unread messages, " + mentions + " mentions",
    );
    if (mentions)
      b.append(node("span", "rail-mention-badge", String(mentions)));
    return b;
}
function serverMenu(event, s = selectedServer()) {
  if (!s) return;
  const owner = s.ownerId === me().id;
  const items = [...activityUI.serverItems(s), null];
  items.push({label:'Members',icon:'people',run:()=>membersUI.open(s)});
  if(hasServer('changeNickname',s)||hasServer('manageNicknames',s))items.push({label:'Edit Server Nickname',icon:'edit',run:()=>manage.nicknameDialog(s)});
  items.push({label:'Boost Server',icon:'gem',run:()=>settings('Voxora Plus')});
  items.push(...workspaceUI.items(s),null);
  if(hasServer('manageReports',s))items.push({label:'Moderation Queue',icon:'shield',run:()=>safetyUI.queue(s)});
  items.push({label:'Your Reports',icon:'shield',run:()=>safetyUI.mine(s)});
  if (s.onboarding.hasGuide) items.push({ label: 'Server Guide', icon: 'help', run: () => onboardingUI.open(s) });
  items.push({label:'Community Studio',icon:'compass',run:()=>studioUI.open(s.id)});
  items.push({label:'Project Board',icon:'edit',run:()=>studioUI.open(s.id,'tasks')});
  items.push({label:'Giveaways',icon:'gem',run:()=>studioUI.open(s.id,'giveaways')});
  items.push({label:'Support Desk',icon:'help',run:()=>careUI.open(s.id)});
  items.push({label:'Knowledge Base',icon:'book',run:()=>careUI.open(s.id,'articles')});
  items.push({ label: "Events", icon: "calendar", run: () => communityUI.events(s) });
  if (owner) items.push({ label: "Create Server Template", icon: "copy", run: () => communityUI.exportTemplate(s) });
  if (hasServer("inviteMembers", s))
    items.push({
      label: "Invite People",
      icon: "friends",
      run: () => inviteDialog(s),
    });
  if (
    [
      "manageServer",
      'manageAutoMod',
      'manageReports',
      'manageSafety',
      "manageExpressions",
      "manageChannels",
      "manageRoles",
      "manageNicknames",
      "moderateMembers",
      "kickMembers",
      "banMembers",
      "viewAuditLog",
    ].some((p) => hasServer(p, s))
  )
    items.push({
      label: "Server Settings",
      icon: "settings",
      run: () => manage.open(s),
    });
  if (hasServer("manageChannels", s))
    items.push(
      {
        label: "Create Channel",
        icon: "plus",
        run: () => channelDialog(null, s),
      },
      {
        label: "Create Category",
        icon: "plus",
        run: () => channelsUI.editCategory(null, s),
      },
    );
  items.push(null, {
    label: owner ? "Delete Server" : "Leave Server",
    icon: owner ? "trash" : "logout",
    danger: true,
    run: () =>
      confirmDialog(
        owner ? "Delete " + s.name : "Leave " + s.name,
        owner
          ? "This permanently deletes this server, its channels and messages."
          : "You can rejoin with an invite.",
        async () => {
          await api(
            "/servers/" + s.id + (owner ? "" : "/leave"),
            owner ? "DELETE" : "POST",
            owner ? undefined : {},
          );
          await refreshState();
          navigate({ kind: "friends" });
        },
      ),
  });
  context(event, items);
}
function renderSidebar() {
  const top = $("sidebar-top"),
    list = $("channel-list");
  top.replaceChildren();
  list.replaceChildren();
  if (route.kind === 'home' || route.kind === "friends" || route.kind === "dm") {
    top.append(
      button("Find or start a conversation", quickSwitcher, "dm-search"),
    );
    const friends = button(
      "Friends",
      () => navigate({ kind: "friends" }),
      "channel-row dm-row" + (route.kind === "friends" ? " active" : ""),
      "friends",
    );
    list.append(friends);
    list.append(button('Home',()=>navigate({kind:'home'}),'channel-row'+(route.kind==='home'?' active':''),'compass'));
    list.append(button('Your Notebook',()=>notebookUI.open(),'channel-row','edit'));
    list.append(button('Community Studio',()=>studioUI.choose(),'channel-row','compass'));
    list.append(button('Your Reminders',()=>hubUI.openReminders(),'channel-row','calendar'));
    list.append(button('Scheduled Messages',()=>scheduledUI.openOutbox(),'channel-row','clock'));
    list.append(button('Drafts on This Device',()=>scheduledUI.openDrafts(),'channel-row','edit'));
    hubUI.sidebar(list);
    const heading = node("div", "dm-section-title", [
      node("span", "", "DIRECT MESSAGES"),
      ib("plus", "Start a direct message", quickSwitcher),
    ]);
    list.append(heading);
    for (const c of state.conversations) {
      const user = dmPerson(c);
      const b = button(
        "",
        () => navigate({ kind: "dm", channel: c.id }),
        "channel-row dm-row" + (route.channel === c.id ? " active" : ""),
      );
      b.append(
        avatar(user, "", true),
        node("span", "dm-name", [
          node("span", "", user.displayName),
          node("small", "", user.customStatus || user.status),
        ]),
      );
      b.setAttribute("aria-label", user.displayName);
      if (unreadVisible(c.id))
        b.append(node("span", "badge", String(unreadCount(c.id))));
      b.classList.toggle("muted-conversation", !!activityUI.entry(c.id)?.muted);
      b.oncontextmenu = (event) =>
        context(event, [
          {
            label: "View Profile",
            icon: "friends",
            run: () => profile(user.id),
          },
          ...activityUI.channelItems(c.id),
        ]);
      list.append(b);
    }
    if (!state.conversations.length)
      list.append(
        node(
          "p",
          "sidebar-hint",
          "Start a conversation from your friends list or a member profile.",
        ),
      );
  } else {
    const s = selectedServer();
    if (!s) return;
    hubUI.sidebar(list);
    const heading = button("", (e) => serverMenu(e, s), "server-heading");
    const verified=verificationBadge(s);heading.append(serverMark(s,'server-heading-picture'),node("span", "", s.name),...(verified?[verified]:[]), icon("chevron", 18));
    top.append(heading);
    if(s.lockdown){const notice=node('section','server-lockdown-notice',[node('strong','','Community safety pause'),document.createTextNode(s.lockdown.reason)]);notice.append(button(s.permissions.some(p=>['manageSafety','manageServer'].includes(p))?'Review Safety Center':'Ask Support',()=>careUI.open(s.id,s.permissions.some(p=>['manageSafety','manageServer'].includes(p))?'safety':'tickets'),'text-button'));list.append(notice);}
    list.append(button('Community Studio',()=>studioUI.open(s.id),'channel-row studio-sidebar-link','compass'),button('Support Desk',()=>careUI.open(s.id),'channel-row','help'),button('Knowledge Base',()=>careUI.open(s.id,'articles'),'channel-row','book'));
    const categories = [
      ...(s.channels.some((c) => !c.categoryId) ? [null] : []),
      ...s.categories,
    ];
    for (const category of categories) {
      const key = s.id + ":" + (category?.id || "uncategorized");
      const head = node("div", "channel-category");
      const collapse = button(
        "",
        () => {
          collapsed[key] = !collapsed[key];
          storage.set("collapsed", collapsed);
          renderSidebar();
        },
        "category-toggle" + (collapsed[key] ? " collapsed" : ""),
      );
      collapse.append(
        icon("chevron", 12),
        document.createTextNode(
          (category?.name || "NO CATEGORY").toUpperCase(),
        ),
      );
      head.append(collapse);
      if (hasServer("manageChannels", s))
        head.append(
          ib("plus", "Create Channel", () =>
            channelDialog(null, s, category?.id || null),
          ),
        );
      if (category)
        head.oncontextmenu = (event) =>
          context(event, channelsUI.categoryActions(category, s));
      channelsUI.drag(head, s, "category", category?.id || null);
      list.append(head);
      for (const c of s.channels.filter(
        (c) => c.categoryId === (category?.id || null),
      )) {
        if (collapsed[key] && c.id !== route.channel) continue;
        const b = button(
          "",
          () =>
            navigate({
              kind: c.type === "voice" ? "voice" : "channel",
              server: s.id,
              channel: c.id,
            }),
          "channel-row" +
            (c.id === route.channel ? " active" : "") +
            (unreadVisible(c.id) ? " has-unread" : "") +
            (activityUI.entry(c.id)?.muted ? " muted-conversation" : ""),
        );
        b.append(
          icon(
            c.overwrites?.some(
              (o) =>
                o.type === "role" &&
                o.id === "everyone" &&
                o.deny.includes("viewChannel"),
            )
              ? "lock"
              : c.type === "voice"
                ? "speaker"
                : c.forum ? "forum" : c.announcement ? "announcement" : "hash",
          ),
          node("span", "channel-name", c.name),
        );
        b.setAttribute("aria-label", c.name);
        b.setAttribute(
          "aria-description",
          unreadCount(c.id) +
            " unread messages, " +
            mentionCount(c.id) +
            " mentions",
        );
        if (mentionCount(c.id))
          b.append(node("span", "badge", String(mentionCount(c.id))));
        b.oncontextmenu = (e) => channelMenu(e, c, s);
        channelsUI.drag(b, s, "channel", c.id, c.categoryId);
        if (hasServer("manageChannels", s)) {
          const edit = node("span", "row-actions");
          edit.append(icon("settings", 14));
          edit.title = "Edit Channel";
          edit.onclick = (e) => {
            e.stopPropagation();
            channelDialog(c, s);
          };
          b.append(edit);
        }
        list.append(b);
        if (c.type === "voice")
          for (const v of state.voice.filter((v) => v.channel === c.id)) {
            const user = person(v.userId);
            const row = button(
              "",
              () => profile(user.id),
              "voice-member" + (voice.channelId === c.id ? " connected" : ""),
            );
            row.append(avatar(user), document.createTextNode(user.displayName));
            row.oncontextmenu=event=>voiceMemberMenu(event,v,s);
            list.append(row);
          }
      }
    }
  }
  renderUserControls();
  renderVoiceSidebar();
}
function renderUserControls() {
  if (!me()) return;
  const identity = button("", userMenu, "user-identity");
  identity.append(
    avatar(me(), "", true),
    node("span", "", [
      node("div", "user-name", me().displayName),
      node("div", "user-tag", me().customStatus || me().username),
    ]),
  );
  const mic = ib(
    voice.muted ? "micOff" : "mic",
    voice.muted ? "Unmute" : "Mute",
    () => voice.toggleMute(),
    voice.muted ? "danger" : "",
  );
  const deaf = ib(
    voice.deafened ? "deafen" : "headphones",
    voice.deafened ? "Undeafen" : "Deafen",
    () => voice.toggleDeafen(),
    voice.deafened ? "danger" : "",
  );
  $("user-controls").replaceChildren(
    identity,
    mic,
    deaf,
    ib("settings", "User Settings", () => settings()),
  );
}
function renderVoiceSidebar() {
  const box = $("voice-connected");
  box.hidden = !voice.channelId;
  if (!voice.channelId) return;
  const server = state.servers.find((s) =>
    s.channels.some((c) => c.id === voice.channelId),
  );
  const info = node("div", "", [
    node("strong", "", "Voice Connected"),
    node(
      "small",
      "",
      channelName(voice.channelId) + " / " + (server?.name || "Voxora"),
    ),
  ]);
  const line = node("div", "voice-status-line", [
    icon("volume", 20),
    info,
    ib("disconnect", "Disconnect", () => voice.leave()),
  ]);
  const actions = node("div", "voice-status-buttons", [
    button("Video", () => voice.toggleCamera(), "", "video"),
    button("Screen", () => voice.toggleScreen(), "", "screen"),
  ]);
  box.replaceChildren(line, actions);
}
function header() {
  const bar = $("topbar");
  bar.replaceChildren();
  const mobile = ib(
    "menu",
    "Show Channels",
    () => document.body.classList.toggle("sidebar-open"),
    "mobile-menu",
  );
  if(route.kind==='home'){bar.append(node('div','header-name',[mobile,node('strong','','Home')]),node('span','header-topic','A little more room for your day'));return;}
  if (route.kind === "friends") {
    const tabs = node("div", "friend-tabs", [
      mobile,
      node("div", "header-name", [
        icon("friends"),
        node("strong", "", "Friends"),
      ]),
    ]);
    for (const name of ["Online", "All", "Pending", "Blocked", "Add Friend"]) {
      const b = button(
        name,
        () => {
          friendTab = name;
          friendQuery = "";
          header();
          renderFriends();
        },
        "friend-tab" +
          (friendTab === name ? " active" : "") +
          (name === "Add Friend" ? " add-friend" : ""),
      );
      if (name === "Pending") {
        const count = state.friendships.filter(
          (f) => f.status === "pending" && f.to === me().id,
        ).length;
        if (count) b.append(node("span", "badge", String(count)));
      }
      tabs.append(b);
    }
    bar.append(
      tabs,
      node("div", "header-actions", [
        ib("inbox", "Inbox", () => showPanel("inbox"), "inbox-action"),
        ib("bookmark", "Saved Messages", () => conversationUI.savedMessages()),
        ib("help", "Help", helpDialog, "optional-action"),
      ]),
    );
    return;
  }
  const c = selectedChannel(),
    user = route.kind === "dm" ? dmPerson(selectedDM()) : null;
  const name = node("div", "header-name", [mobile]);
  if (user) name.append(avatar(user, "", true));
  else name.append(icon(route.kind === "voice" ? "speaker" : c?.forum ? "forum" : c?.announcement ? "announcement" : "hash", 23));
  name.append(node("strong", "", user?.displayName || c?.name || "channel"));
  if (c?.topic) name.append(node("span", "header-topic", c.topic));
  const actions = node("div", "header-actions");
  if(route.channel)actions.append(ib('star',hubUI.isStarred(route.channel)?'Unstar Channel':'Star Channel',()=>hubUI.toggleStar(route.channel),'star-action'));
  actions.append(ib("bookmark", "Saved Messages", () => conversationUI.savedMessages()));
  if (route.kind === "channel"&&!c?.forum) actions.append(ib("thread", "Channel Threads", () => conversationUI.threads(route.channel)));
  if (selectedServer() && ["channel", "voice"].includes(route.kind)) actions.append(ib("calendar", "Server Events", () => communityUI.events(selectedServer()), "optional-action"));
  if (c?.announcement) actions.append(button("Follow", () => followAnnouncement(c), "secondary-button announcement-follow"));
  if (route.kind !== "voice") {
    actions.append(
      ib("pin", "Pinned Messages", () =>
        showPanel(panel === "pins" ? "members" : "pins"),
      ),
      ib(
        "people",
        "Toggle Member List",
        () => {
          panel = panel === "members" ? "none" : "members";
          renderPanel();
        },
        "optional-action",
      ),
    );
    const search = node("form", "header-search");
    const query = input(searchQuery, "Search");
    query.setAttribute("aria-label", "Search messages");
    query.oninput = () => (searchQuery = query.value);
    search.append(query, icon("search", 15));
    search.onsubmit = run(async (e) => {
      e.preventDefault();
      searchQuery = query.value;
      await showPanel("search");
    });
    actions.append(search);
  }
  actions.append(
    ib("inbox", "Inbox", () => showPanel("inbox"), "inbox-action"),
    ib("help", "Help", helpDialog, "optional-action"),
  );
  bar.append(name, actions);
}
async function navigate(next) {
  if (route.channel && $("message-input") && composerAccount===me()?.id)
    writeDraft(route.channel, $("message-input").value);
  closeOverlays();
  forumsUI.leave();
  document.body.classList.remove("sidebar-open");
  route = next;
  $('home-view').hidden=next.kind!=='home';if(next.kind!=='home')$('home-view').replaceChildren();
  storage.set("route:" + me().id, next);
  reply = null;
  pendingFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
  pendingFiles = [];
  searchQuery = "";
  $("command-picker").hidden = true;
  mentionPicker.close();
  emojiCompletion.close();
  commandChoice = null;
  commandRequest++;
  hasNewer = false;
  viewBoundary = activityUI.entry(next.channel)?.unread
    ? activityUI.entry(next.channel).cursor
    : null;
  activityUI.enter(next.channel);
  messages = [];
  $("message-list").replaceChildren();
  $("channel-welcome").replaceChildren();
  editing = null;
  hasOlder = false;
  if (next.kind === "channel") {
    const s = selectedServer(),
      c = selectedChannel();
    if (!s || !c) {
      if (s?.channels.length) {
        const first =
          s.channels.find((c) => c.type === "text") || s.channels[0];
        return navigate({
          kind: first.type === "voice" ? "voice" : "channel",
          server: s.id,
          channel: first.id,
        });
      }
      return navigate({ kind: "friends" });
    }
    if (c.type === "voice") route.kind = "voice";
  }
  if (next.kind === "dm" && !selectedDM()) return navigate({ kind: "friends" });
  $("friends-view").hidden = next.kind !== "friends";
  $("chat-column").hidden = ['home','friends'].includes(next.kind);
  $("call-view").hidden = next.kind !== "voice";
  $("chat-scroll").hidden = next.kind === "voice";
  const isForum=next.kind==='channel'&&!!selectedChannel()?.forum;
  $("forum-view").hidden=!isForum;
  $("chat-scroll").hidden=next.kind==='voice'||isForum;
  $("composer-wrap").hidden = next.kind === "voice"||isForum;
  if (['home','friends'].includes(next.kind)) panel = "none";
  else if (next.kind === "voice") panel = "members";
  else if (next.kind === "dm") panel = "none";
  else panel = "members";
  drafts=storage.get("drafts:"+me().id,{});
  $("message-input").value = drafts[next.channel] || "";
  composerAccount=me().id;
  $("message-input").placeholder =
    next.kind === "dm"
      ? "Message @" + dmPerson(selectedDM()).displayName
      : "Message #" + (selectedChannel()?.name || "general");
  document.title =
    (next.kind === 'home' ? 'Home' : next.kind === "friends"
      ? "Friends"
      : (next.kind === "dm" ? "@" : "#") + channelName(next.channel)) +
    " | Voxora";
  renderRail();
  renderSidebar();
  header();
  renderPanel();
  renderReply();
  renderAttachments();
  updateTyping();
  updateNewMessagesBar();
  if(next.kind==='home'){hubUI.render($('home-view'));return;}
  if (next.kind === "friends") return renderFriends();
  if (next.kind === "voice") return renderCall();
  if(isForum){forumsUI.show();onboardingUI.maybeShow();return;}
  renderWelcome();
  updateComposerPermissions();
  renderMessages();
  await loadMessages();
  onboardingUI.maybeShow();
}
async function loadMessages({ around } = {}) {
  const id = ++loadId;
  const channel = route.channel;
  const data = await api(
    "/messages?channel=" +
      encodeURIComponent(channel) +
      (around ? "&around=" + encodeURIComponent(around) : ""),
  );
  if (id !== loadId || route.channel !== channel) return;
  hasOlder = data.length === 200;
  messages = [
    ...new Map(
      [...data, ...(around ? [] : messages)].map((m) => [m.id, m]),
    ).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  hasNewer =
    (activityUI.entry(channel)?.latestSequence || 0) >
    (messages.at(-1)?.sequence || 0);
  renderMessages();
  updateNewMessagesBar();
  if (around)
    requestAnimationFrame(() => {
      jumpTo(around);
      scheduleRead();
    });
  else scrollBottom();
}
function renderWelcome() {
  const welcome = $("channel-welcome");
  welcome.replaceChildren();
  if (route.kind === "dm") {
    const user = dmPerson(selectedDM());
    welcome.append(
      avatar(user, "lg"),
      node("h1", "", user.displayName),
      node(
        "p",
        "",
        `This is the beginning of your direct message history with @${user.username}.`,
      ),
    );
    const actions = node("div", "welcome-actions", [
      button("View Profile", () => profile(user.id), "text-button"),
    ]);
    welcome.append(actions);
    return;
  }
  const c = selectedChannel();
  const sym = node("div", "welcome-symbol", [icon("hash", 44)]);
  welcome.append(
    sym,
    node("h1", "", `Welcome to #${c?.name || "general"}!`),
    node(
      "p",
      "",
      c?.topic || `This is the start of the #${c?.name || "general"} channel.`,
    ),
  );
  const actions = node("div", "welcome-actions");
  if (selectedServer()?.onboarding.pendingRules) welcome.append(node('div', 'onboarding-notice', [node('p', '', 'Accept this server’s rules before sending messages or joining calls.'), button('Accept Server Rules', () => onboardingUI.open(selectedServer()), 'primary')]));
  else if (selectedServer()?.onboarding.hasGuide) actions.append(button('Server Guide', () => onboardingUI.open(selectedServer()), 'text-button'));
  if (hasServer("manageChannels"))
    actions.append(
      button(
        "Edit Channel",
        () => channelDialog(c, selectedServer()),
        "",
        "edit",
      ),
    );
  if (hasServer("inviteMembers"))
    actions.append(
      button(
        "Invite People",
        () => inviteDialog(selectedServer()),
        "",
        "friends",
      ),
    );
  welcome.append(actions);
}
function formatted(text, custom = [], mentions = null) {
  const fragment = document.createDocumentFragment();
  const regex =
    /```[\s\S]*?```|`[^`\n]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\|\|[^|]+\|\||\*[^*\n]+\*|<:[A-Za-z0-9_]{2,32}:[a-f0-9-]{36}>|https?:\/\/[^\s<>]+|<@&?[a-f0-9-]{36}>|@\{[^}\n]{1,40}\}|@[a-zA-Z0-9_.]+/g;
  let start = 0;
  for (const match of text.matchAll(regex)) {
    fragment.append(document.createTextNode(text.slice(start, match.index)));
    const part = match[0];
    let e;
    if (part.startsWith("```")) {
      e = node("pre", "", part.slice(3, -3).replace(/^\w*\n/, ""));
    } else if (part.startsWith("`")) e = node("code", "", part.slice(1, -1));
    else if (part.startsWith("**")) e = node("strong", "", [formatted(part.slice(2, -2), custom, mentions)]);
    else if (part.startsWith("__")) e = node("u", "", [formatted(part.slice(2, -2), custom, mentions)]);
    else if (part.startsWith("~~")) e = node("s", "", [formatted(part.slice(2, -2), custom, mentions)]);
    else if (part.startsWith("||")) {
      e = node("span", "spoiler", part.slice(2, -2));
      e.tabIndex = 0;
      e.role = "button";
      e.setAttribute("aria-label", "Reveal spoiler");
      e.onclick = () => e.classList.toggle("revealed");
      e.onkeydown = (event) => {
        if (event.key === "Enter") e.click();
      };
    } else if (part.startsWith("*")) e = node("em", "", [formatted(part.slice(1, -1), custom, mentions)]);
    else if (part.startsWith("<:")) e = emojiVisual(part, custom);
    else if (part.startsWith("http")) {
      e = node("a", "", part);
      e.href = part;
      e.target = "_blank";
      e.rel = "noopener noreferrer";
    } else {
      const reference=mentions?.references?.find(r=>r.token.toLowerCase()===part.toLowerCase());
      const user=reference?.kind==='user'?state.users.find(u=>u.id===reference.id):!mentions&&state.users.find(u=>u.username.toLowerCase()===part.slice(1).toLowerCase());
      e=reference||user?node(user?'button':'span','mention',reference?.label||part):document.createTextNode(part);
      if(user){e.type='button';e.onclick=()=>profile(user.id);e.setAttribute('aria-label','Open profile for '+user.username);}
      if(reference?.kind==='role')e.title='Role mention';
    }
    fragment.append(e);
    start = match.index + part.length;
  }
  fragment.append(document.createTextNode(text.slice(start)));
  return fragment;
}
const dateLabel = (time) => {
  const date = new Date(time),
    today = new Date();
  return date.toDateString() === today.toDateString()
    ? "Today"
    : date.toLocaleDateString([], {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
};
const timeLabel = (time) =>
  new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function messageText(m) {
  const e = node("div", "message-text");
  if (m.announcementSource) e.append(node("div", "announcement-meta", "Published from " + m.announcementSource.serverName + " · #" + m.announcementSource.channelName));
  e.append(formatted(m.text, m.customEmojis, m.mentions));
  if (m.thread) e.append(button(m.thread.name + " · " + m.thread.replyCount + " replies" + (m.thread.archived ? " · Archived" : ""), () => conversationUI.openThread(m.thread.id), "thread-summary"));
  if (m.publishedAt) e.append(node("div", "announcement-meta", "Published · " + m.publishedCount + " following channel(s)"));
  if (m.editedAt) e.append(node("span", "edited", "(edited)"));
  return e;
}
function messageMenu(event, m) {
  const own = m.authorId === me().id,
    owner = hasChannel("manageMessages");
  const items = [
    {label:'Remind Me',icon:'calendar',run:()=>hubUI.editor({kind:'message',id:m.id})},
    ...(state.servers.some(s=>s.channels.some(c=>c.id===m.channel))&&hasChannel('sendMessages')?[{label:'Create Project Task',icon:'edit',run:()=>studioUI.fromMessage(m)}]:[]),
    { label: "Reply", icon: "reply", run: () => setReply(m) },
    {
      label: "Add Reaction",
      icon: "emoji",
      run: () =>
        emojiPicker(
          {
            stopPropagation() {},
            currentTarget: {
              getBoundingClientRect: () => ({
                top: innerHeight - 60,
                right: innerWidth - 40,
              }),
            },
          },
          (emoji) => react(m, emoji),
        ),
    },
    { label: "Copy Text", icon: "copy", run: () => copy(m.text) },
    {
      label: "Mark Unread from Here",
      icon: "inbox",
      run: () => activityUI.markUnread(m.channel, m.id),
    },
  ];
  if(route.kind==='channel'&&m.authorId!==me().id)items.push({label:'Report Message',icon:'shield',run:()=>safetyUI.report(m)});
  items.push({ label: conversationUI.isSaved(m) ? "Remove Saved Message" : "Save Message", icon: "bookmark", run: () => conversationUI.toggleSaved(m) });
  if (route.kind === "channel" && (m.thread || hasChannel("createThreads") && hasChannel("sendMessages"))) items.push({ label: m.thread ? "Open Thread" : "Create Thread", icon: "thread", run: () => conversationUI.createThread(m) });
  if (selectedChannel()?.announcement && !m.publishedAt && !m.announcementSource && !m.poll && !m.command && hasChannel("sendMessages") && (own || owner))
    items.push({ label: "Publish Announcement", icon: "announcement", run: () => publishAnnouncement(m) });
  if ((own && hasChannel("sendMessages")) || owner)
    items.push({
      label: m.pinned ? "Unpin Message" : "Pin Message",
      icon: "pin",
      run: () => api("/messages/" + m.id + "/pin", "POST", {}),
    });
  if (own && !m.poll && hasChannel("sendMessages"))
    items.push({
      label: "Edit Message",
      icon: "edit",
      run: () => editMessage(m),
    });
  if (own || owner)
    items.push(null, {
      label: "Delete Message",
      icon: "trash",
      danger: true,
      run: () =>
        confirmDialog(
          "Delete Message",
          "Are you sure you want to delete this message?" + (m.thread ? " Its thread and every reply will also be deleted." : "") + " This cannot be undone.",
          () => api("/messages/" + m.id, "DELETE"),
        ),
    });
  context(
    event,
    items.filter(
      (item) =>
        !item ||
        (item.label !== "Reply" && item.label !== "Add Reaction") ||
        (item.label === "Reply" && hasChannel("sendMessages")) ||
        (item.label === "Add Reaction" && hasChannel("addReactions")),
    ),
  );
}
function renderMessages() {
  if(selectedChannel()?.forum&&route.kind==='channel'){forumsUI.refresh();return;}
  const list = $("message-list");
  list.replaceChildren();
  if (hasOlder)
    list.append(button("Load earlier messages", loadEarlier, "history-load"));
  let previous = null,
    boundaryShown = false;
  for (const m of messages) {
    const boundary =
      !boundaryShown &&
      viewBoundary !== null &&
      m.sequence > viewBoundary &&
      m.authorId !== me().id;
    if (boundary) {
      const divider = node("div", "new-message-divider", "NEW MESSAGES");
      divider.setAttribute("role", "separator");
      divider.setAttribute("aria-label", "New messages");
      list.append(divider);
      boundaryShown = true;
    }
    const date = dateLabel(m.time);
    if (!previous || dateLabel(previous.time) !== date)
      list.append(node("div", "message-date", date));
    const grouped =
      !boundary &&
      previous &&
      previous.authorId === m.authorId &&
      previous.author === m.author &&
      m.time - previous.time < 7 * 60000 &&
      dateLabel(previous.time) === date &&
      !m.replyTo;
    const row = node(
      "article",
      "message-row" +
        (!grouped ? " first" : "") +
        (m.reply ? " has-reply" : "") +
        (mentionsUser(m, me()) ? " mentioned" : ""),
    );
    row.id = "message-" + m.id;
    row.dataset.messageId = m.id;
    row.oncontextmenu = (e) => messageMenu(e, m);
    const user = m.authorId
      ? person(m.authorId)
      : { displayName: m.author, color: m.color };
    if (grouped) {
      const spacer = node("div", "message-spacer", [
        node("time", "hover-time", timeLabel(m.time)),
      ]);
      row.append(spacer);
    } else {
      const a = avatar(user, "message-avatar");
      a.onclick = () => m.authorId && profile(m.authorId);
      row.append(a);
    }
    const body = node("div", "message-body");
    if (m.reply) {
      row.append(node("span", "reply-branch"));
      const r = button("", () => jumpTo(m.reply.id), "message-reply");
      r.append(
        node("strong", "", m.reply.author),
        node("span", "", m.reply.text || "Attachment"),
      );
      row.append(r);
    }
    if (!grouped) {
      const meta = node("div", "message-meta");
      const author = button(
        m.author,
        () => m.authorId && profile(m.authorId),
        "message-author",
      );
      const role =
        selectedServer() &&
        memberRoles(selectedServer(), m.authorId)
          .sort((a, b) => b.position - a.position)
          .find((r) => r.color);
      if (role) author.style.color = role.color;
      const time = node(
        "time",
        "",
        dateLabel(m.time) + " at " + timeLabel(m.time),
      );
      time.dateTime = new Date(m.time).toISOString();
      meta.append(author);
      if (m.bot || user.bot) meta.append(node("span", "bot-tag", "BOT"));
      else if (!m.authorId) meta.append(node("span", "bot-tag", "APP"));
      meta.append(...staffBadges(user));
      meta.append(time);
      if (m.pinned) {
        const p = icon("pin", 12);
        p.title = "Pinned message";
        meta.append(p);
      }
      body.append(meta);
    }
    if (m.command)
      body.append(
        node(
          "div",
          "command-call",
          "Command · " +
            m.command.botName +
            (m.command.status === "pending"
              ? " · Waiting for bot…"
              : m.command.status === "expired"
                ? " · Response expired"
                : ""),
        ),
      );
    if (!m.poll || m.text !== m.poll.question) body.append(messageText(m));
    if (m.poll) body.append(pollUI.render(m));
    for (const file of m.attachments || []) {
      if (
        ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          file.mime,
        )
      ) {
        const img = node("img", "attachment-image"+(file.sticker?' sticker-image':''));
        img.src = file.url;
        img.alt = file.name;
        img.loading = "lazy";
        img.onclick = () => imageDialog(file);
        body.append(node("div", "attachment", [img]));
      } else {
        const a = node("a", "", file.name);
        a.href = file.url + "?download=1";
        a.download = file.name;
        const details = node("div", "file-details", [
          a,
          node("small", "", formatSize(file.size)),
        ]);
        const download = node("a", "icon-button", [icon("download")]);
        download.href = a.href;
        download.download = file.name;
        download.title = "Download " + file.name;
        body.append(
          node("div", "attachment attachment-file", [
            icon("file", 32),
            details,
            download,
          ]),
        );
      }
    }
    if (m.reactions?.length) {
      const reactions = node("div", "reactions");
      for (const r of m.reactions) {
        const b = button(
          "",
          () => react(m, r.emoji),
          "reaction" + (r.userIds.includes(me().id) ? " mine" : ""),
        );
        b.title = r.userIds.map((id) => person(id).displayName).join(", ");
        b.append(
          emojiVisual(r.emoji, m.customEmojis),
          document.createTextNode(String(r.userIds.length)),
        );
        b.disabled = !hasChannel("addReactions");
        reactions.append(b);
      }
      body.append(reactions);
    }
    const actions = node("div", "message-actions");
    if (selectedChannel()?.announcement && !m.publishedAt && !m.announcementSource && !m.poll && !m.command && hasChannel("sendMessages") && (m.authorId === me().id || hasChannel("manageMessages")))
      actions.append(ib("announcement", "Publish Announcement", () => publishAnnouncement(m)));
    const reactButton = ib("emoji", "Add Reaction", (e) =>
      emojiPicker(e, (emoji) => react(m, emoji)),
    );
    reactButton.dataset.emoji = "true";
    if (hasChannel("addReactions")) actions.append(reactButton);
    if (hasChannel("sendMessages"))
      actions.append(ib("reply", "Reply", () => setReply(m)));
    if (m.authorId === me().id && !m.poll && hasChannel("sendMessages"))
      actions.append(ib("edit", "Edit Message", () => editMessage(m)));
    actions.append(ib("more", "More", (e) => messageMenu(e, m)));
    row.append(body, actions);
    list.append(row);
    previous = m;
  }
  if (hasNewer)
    list.append(button("Load newer messages", loadNewer, "history-load"));
  scheduleRead();
}
async function loadNewer() {
  if (!messages.length) return;
  const channel = route.channel,
    position = $("chat-scroll").scrollTop;
  const data = await api(
    "/messages?channel=" +
      encodeURIComponent(channel) +
      "&after=" +
      encodeURIComponent(messages.at(-1).id),
  );
  if (route.channel !== channel) return;
  messages = [
    ...new Map([...messages, ...data].map((m) => [m.id, m])).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  hasNewer =
    (activityUI.entry(channel)?.latestSequence || 0) >
    (messages.at(-1)?.sequence || 0);
  renderMessages();
  $("chat-scroll").scrollTop = position;
  updateNewMessagesBar();
}
async function openMessage(m) {
  if (m.threadId) return conversationUI.openThread(m.threadId, m.id);
  readSuppression++;
  try {
    const channel = m.channel;
    const server = state.servers.find((s) =>
      s.channels.some((c) => c.id === channel),
    );
    if (!server && !state.conversations.some((c) => c.id === channel))
      throw Error("You no longer have access to this conversation.");
    if (route.channel !== channel)
      await navigate(
        server
          ? { kind: "channel", server: server.id, channel }
          : { kind: "dm", channel },
      );
    if (route.channel !== channel) return;
    if(server?.channels.find(c=>c.id===channel)?.forum)return forumsUI.openPost(m.id);
    activityUI.enter(channel);
    if (!messages.some((x) => x.id === m.id))
      await loadMessages({ around: m.id });
    else {
      jumpTo(m.id);
      scheduleRead();
    }
  } finally {
    readSuppression--;
    scheduleRead();
  }
}
function updateNewMessagesBar() {
  const bar = $("new-messages-bar"),
    c = activityUI.entry(route.channel);
  bar.hidden =
    !["channel", "dm"].includes(route.kind) || (!c?.unread && !hasNewer);
  if (bar.hidden) return;
  const actions = [];
  if (c?.unread)
    actions.push(
      button(
        c.unread + " new message" + (c.unread === 1 ? "" : "s"),
        () => openMessage({ channel: route.channel, id: c.firstUnreadId }),
        "new-messages-jump",
      ),
    );
  if (hasNewer)
    actions.push(
      button(
        "Jump to Present",
        async () => {
          messages = [];
          hasNewer = false;
          await loadMessages();
        },
        "new-messages-present",
      ),
    );
  if (c?.unread)
    actions.push(
      button(
        "Mark as Read",
        () => activityUI.markRead(route.channel),
        "new-messages-read",
      ),
    );
  bar.replaceChildren(...actions);
}
function scheduleRead() {
  clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    if (
      !state ||
      readSuppression > 0 ||
      !activityUI.viewing(route.channel) ||
      activityUI.isPaused(route.channel)
    )
      return;
    const bounds = $("chat-scroll").getBoundingClientRect();
    const visible = messages.filter((m) => {
      const row = $("message-" + m.id);
      if (!row) return false;
      const r = row.getBoundingClientRect();
      return r.top < bounds.bottom && r.bottom > bounds.top;
    });
    activityUI.acknowledge(route.channel, visible.at(-1));
  }, 180);
}
$("chat-scroll").addEventListener("scroll", scheduleRead, { passive: true });
$("modal").addEventListener("close", scheduleRead);
window.addEventListener("focus", () => {
  if (state) {
    activityUI.scheduleRefresh();
    scheduleRead();
  }
});
document.addEventListener("visibilitychange", () => {
  if (state && document.visibilityState === "visible") {
    activityUI.scheduleRefresh();
    scheduleRead();
  }
});
async function loadEarlier() {
  if (!messages.length) return;
  const channel = route.channel,
    scroll = $("chat-scroll"),
    height = scroll.scrollHeight,
    top = scroll.scrollTop;
  const older = await api(
    "/messages?channel=" +
      encodeURIComponent(channel) +
      "&before=" +
      encodeURIComponent(messages[0].id),
  );
  if (channel !== route.channel) return;
  hasOlder = older.length === 200;
  messages = [
    ...new Map([...older, ...messages].map((m) => [m.id, m])).values(),
  ];
  renderMessages();
  scroll.scrollTop = top + scroll.scrollHeight - height;
}
function formatSize(size) {
  return size >= 1048576
    ? (size / 1048576).toFixed(1) + " MB"
    : Math.max(1, Math.ceil(size / 1024)) + " KB";
}
function scrollBottom() {
  requestAnimationFrame(() => {
    $("chat-scroll").scrollTop = $("chat-scroll").scrollHeight;
    scheduleRead();
  });
}
async function react(m, emoji) {
  await api("/messages/" + m.id + "/reactions", "POST", { emoji });
}
function setReply(m) {
  reply = m;
  renderReply();
  $("message-input").focus();
}
function renderReply() {
  const bar = $("reply-banner");
  bar.hidden = !reply;
  if (reply)
    bar.replaceChildren(
      node("span", "", ["Replying to ", node("strong", "", reply.author)]),
      ib("close", "Cancel Reply", () => {
        reply = null;
        renderReply();
      }),
    );
}
function editMessage(m) {
  const value = node("textarea");
  value.value = m.text;
  value.maxLength = state.premium?.perks.messageCharacters||2000;
  formDialog({
    title: "Edit Message",
    fields: [field("MESSAGE", value)],
    submit: () => api("/messages/" + m.id, "PATCH", { text: value.value }),
  });
}
function jumpTo(id) {
  const element = $("message-" + id);
  if (!element) {
    toast("This message is outside the latest 200 messages.");
    return;
  }
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.classList.add("highlight");
  setTimeout(() => element.classList.remove("highlight"), 2500);
}
function imageDialog(file) {
  const img = node("img");
  img.src = file.url;
  img.alt = file.name;
  const link = node("a", "", `Download ${file.name}`);
  link.href = file.url + "?download=1";
  link.download = file.name;
  modal([img, link], "image-dialog");
}
async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast("Copied to clipboard.");
  } catch {
    const control = input(value);
    control.readOnly = true;
    modal([node("h2", "", "Copy this text"), control]);
    control.select();
  }
}
function renderAttachments() {
  const box = $("attachment-drafts");
  box.hidden = !pendingFiles.length;
  box.replaceChildren();
  pendingFiles.forEach((entry, index) => {
    const card = node("div", "draft-file");
    if (entry.preview) {
      const img = node("img");
      img.src = entry.preview;
      img.alt = entry.file.name;
      card.append(img);
    } else card.append(icon("file", 42));
    card.append(
      node("span", "filename", entry.file.name),
      ib("close", "Remove attachment", () => {
        if (entry.preview) URL.revokeObjectURL(entry.preview);
        pendingFiles.splice(index, 1);
        renderAttachments();
      }),
    );
    box.append(card);
  });
}
$("file-input").onchange = () => {
  for (const file of $("file-input").files) {
    if (pendingFiles.length >= 5) {
      toast("You can attach up to 5 files per message.", true);
      break;
    }
    const uploadLimit=state.premium?.perks.uploadBytes||8*1048576;
    if (file.size > uploadLimit) {
      toast(file.name + ' exceeds your '+Math.round(uploadLimit/1048576)+' MB upload limit.', true);
      continue;
    }
    pendingFiles.push({
      file,
      preview: /^image\/(png|jpeg|gif|webp)$/.test(file.type)
        ? URL.createObjectURL(file)
        : null,
    });
  }
  renderAttachments();
  $("file-input").value = "";
};
$("composer-poll").append(icon("poll", 23));
$("composer-poll").onclick = () => pollUI.create();
$("composer-plus").append(icon("plus", 18));
$("composer-plus").onclick = () => $("file-input").click();
$("composer-emoji").append(icon("emoji", 24));
$("composer-emoji").dataset.emoji = "true";
const stickerButton=ib('emoji','Send a Sticker',()=>serverAssetsUI.stickers(),'composer-sticker');stickerButton.id='composer-sticker';$('composer-emoji').before(stickerButton);
$("composer-emoji").onclick = (e) =>
  emojiPicker(e, (emoji) => {
    $("message-input").setRangeText(
      emoji,
      $("message-input").selectionStart,
      $("message-input").selectionEnd,
      "end",
    );
    writeDraft(route.channel,$("message-input").value);
    $("message-input").focus();
  });
$("composer-schedule").append(icon('clock',21));
$("composer-schedule").onclick=run(()=>{
  if(pendingFiles.length)throw Error('Scheduled messages support text. Remove attachments before scheduling.');
  if(!['channel','dm'].includes(route.kind)||!hasChannel('sendMessages')||sending)return;
  const channel=route.channel,text=$('message-input').value,account=me().id,replyTo=reply?.id;
  scheduledUI.editor({channel,text,replyTo,onScheduled:()=>{
    if(me()?.id!==account)return;
    if(storage.get('drafts:'+account,{})[channel]===text)writeDraft(channel,'',account);
    if(route.channel===channel&&$('message-input').value===text){$('message-input').value='';reply=null;renderReply();}
  }});
});
$("send-message").append(icon("send", 21));
$("composer").onsubmit = async (e) => {
  e.preventDefault();
  mentionPicker.close();
  emojiCompletion.close();
  const rawText=$("message-input").value,account=me().id;
  const text = rawText.trim();
  if (
    (!text && !pendingFiles.length) ||
    !["channel", "dm"].includes(route.kind)
  )
    return;
  if (sending || !hasChannel("sendMessages")) return;
  if (slowmodeRemaining() > 0) {
    updateSlowmode();
    return;
  }
  sending = true;
  const channel = route.channel;
  const currentFiles = [...pendingFiles];
  $("send-message").disabled = true;
  try {
    if (text.startsWith("/") && route.kind === "channel") {
      if (currentFiles.length)
        throw Error("Remove attachments before running a command.");
      const parts = text.slice(1).match(/^(\S+)(?:\s+([\s\S]*))?$/);
      if (!parts) throw Error("Choose a slash command.");
      const available = await api(
        "/commands?channel=" + encodeURIComponent(channel),
      );
      const choices = available.filter(
        (c) =>
          c.name === parts[1] &&
          (!commandChoice ||
            commandChoice.name !== parts[1] ||
            c.applicationId === commandChoice.applicationId),
      );
      if (!choices.length)
        throw Error(
          "No matching command. Install a bot from Server Settings → Bots & Apps.",
        );
      if (choices.length > 1)
        throw Error("Choose a bot for this command from the command picker.");
      const result = await api("/commands", "POST", {
        channel,
        name: parts[1],
        arguments: parts[2] || "",
        applicationId: choices[0].applicationId,
      });
      if (route.channel === channel && me()?.id===account && $("message-input").value===rawText) {
        for (const m of [result.invocation, result.response].filter(Boolean))
          if (!messages.some((x) => x.id === m.id)) messages.push(m);
        messageRevision++;
        $("message-input").value = "";
        writeDraft(channel,"",account);
        reply = null;
        renderReply();
        $("command-picker").hidden = true;
        commandChoice = null;
        renderMessages();
        scrollBottom();
      }
      if(me()?.id===account&&storage.get("drafts:"+account,{})[channel]===rawText)writeDraft(channel,"",account);
      return;
    }
    for (const entry of currentFiles)
      if (!entry.id) {
        const response = await fetch(
          "/api/files?channel=" + encodeURIComponent(channel),
          {
            method: "POST",
            headers: {
              "Content-Type": entry.file.type || "application/octet-stream",
              "X-File-Name": encodeURIComponent(entry.file.name),
            },
            body: entry.file,
          },
        );
        const file = await response.json();
        if (!response.ok) throw new Error(file.error);
        entry.id = file.id;
      }
    const result = await api("/messages", "POST", {
      channel,
      text,
      files: currentFiles.map((f) => f.id),
      replyTo: reply?.id,
    });
    noteOwnMessage(result);
    if (route.channel === channel && me()?.id===account && $("message-input").value===rawText) {
      if (hasNewer) {
        messages = [];
        hasNewer = false;
        await loadMessages();
      }
      if (!messages.some((m) => m.id === result.id)) messages.push(result);
      messageRevision++;
      $("message-input").value = "";
      $("message-input").style.height = "";
      writeDraft(channel,"",account);
      reply = null;
      pendingFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      pendingFiles = [];
      renderMessages();
      renderAttachments();
      renderReply();
      scrollBottom();
    }
    if(me()?.id===account&&storage.get("drafts:"+account,{})[channel]===rawText)writeDraft(channel,"",account);
  } catch (error) {
    if (Number.isFinite(error.nextAllowedAt)) {
      state.cooldowns ||= {};
      state.cooldowns[channel] = error.nextAllowedAt;
    }
    toast(error.message, true);
  } finally {
    sending = false;
    updateComposerPermissions();
    $("message-input").focus();
  }
};
function queueCommands() {
  clearTimeout(commandTimer);
  const picker = $("command-picker"),
    value = $("message-input").value;
  if (route.kind !== "channel" || !value.startsWith("/")) {
    picker.hidden = true;
    commandChoice = null;
    return;
  }
  if (commandChoice && value.startsWith("/" + commandChoice.name + " ")) {
    picker.hidden = true;
    return;
  }
  commandChoice = null;
  const request = ++commandRequest,
    channel = route.channel;
  commandTimer = setTimeout(async () => {
    try {
      const commands = await api(
        "/commands?channel=" + encodeURIComponent(channel),
      );
      if (
        request !== commandRequest ||
        route.channel !== channel ||
        !$("message-input").value.startsWith("/")
      )
        return;
      const name = $("message-input")
        .value.slice(1)
        .split(/\s/)[0]
        .toLowerCase();
      picker.replaceChildren(
        node("div", "command-picker-title", "SLASH COMMANDS"),
      );
      const matches = commands.filter((c) => c.name.startsWith(name));
      for (const c of matches) {
        const b = button(
          "",
          () => {
            commandChoice = c;
            $("message-input").value = "/" + c.name + " ";
            picker.hidden = true;
            $("message-input").focus();
          },
          "command-choice",
        );
        b.setAttribute("aria-label", "/" + c.name + " · " + c.botName);
        b.append(
          node("strong", "", "/" + c.name),
          node("span", "", [
            node("span", "", c.description),
            node("small", "", c.botName + " · " + c.usage),
          ]),
        );
        picker.append(b);
      }
      if (!matches.length)
        picker.append(
          node(
            "p",
            "command-picker-title",
            "No commands available. Install a bot in Server Settings → Bots & Apps.",
          ),
        );
      picker.hidden = false;
    } catch (e) {
      toast(e.message, true);
    }
  }, 90);
}
let lastTyping = 0;
const mentionPicker=createMentionPicker({input:$("message-input"),picker:$("mention-picker"),getState:()=>state,getRoute:()=>route,node,toast});
const emojiCompletion=createEmojiCompletion({input:$("message-input"),picker:$("emoji-completion"),getState:()=>state,getChannel:()=>route.channel,node,toast});
$("message-input").oninput = () => {
  queueCommands();
  mentionPicker.update();
  emojiCompletion.update();
  const e = $("message-input");
  e.style.height = "auto";
  e.style.height = Math.min(e.scrollHeight, 180) + "px";
  writeDraft(route.channel,e.value);
  if (e.value && Date.now() - lastTyping > 3000) {
    lastTyping = Date.now();
    api("/typing", "POST", { channel: route.channel }).catch(() => {});
  }
};
$("message-input").onkeydown = (e) => {
  if(emojiCompletion.keydown(e)||mentionPicker.keydown(e))return;
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("composer").requestSubmit();
  } else if (e.key === "ArrowUp" && !e.currentTarget.value) {
    const own = [...messages].reverse().find((m) => m.authorId === me().id);
    if (own) {
      e.preventDefault();
      editMessage(own);
    }
  }
};
function updateTyping() {
  const names = [...typing.values()]
    .filter(
      (x) =>
        x.channel === route.channel &&
        x.user.id !== me()?.id &&
        Date.now() - x.time < 5500,
    )
    .map((x) => x.user.displayName);
  const target = $("typing-indicator");
  target.replaceChildren();
  if (names.length)
    target.append(
      node("span", "typing-dots", "•••"),
      node("strong", "", names.slice(0, 3).join(", ")),
      document.createTextNode(
        names.length === 1 ? " is typing…" : " are typing…",
      ),
    );
}
setInterval(updateTyping, 1500);
function memberRow(user, s) {
  const b = button(
    "",
    () => profile(user.id),
    "member-row" + (user.status === "offline" ? " offline" : ""),
  );
  const name = node("strong", "", s?.nicknames?.[user.id] || user.displayName);
  if (user.bot) name.append(node("span", "bot-tag", "BOT"));
  name.append(...staffBadges(user));
  const role =
    s &&
    memberRoles(s, user.id)
      .sort((a, b) => b.position - a.position)
      .find((r) => r.color);
  if (role) name.style.color = role.color;
  if (s)
    b.oncontextmenu = (e) => {
      const actions = manage.targetActions(s, user.id);
      if (actions.length) context(e, actions);
    };
  if (s?.ownerId === user.id) {
    const crown = icon("crown", 12);
    crown.classList.add("owner-crown");
    name.append(crown);
  }
  b.append(
    avatar(user, "", true),
    node("span", "member-text", [
      name,
      node("small", "", user.customStatus || ""),
    ]),
  );
  return b;
}
function renderPanel() {
  const panelElement = $("detail-panel");
  if (panel === "thread") { panelElement.className = "wide thread-panel"; conversationUI.render(panelElement); return; }
  panelElement.className =
    panel === "none" ? "hidden" : panel === "members" ? "" : "wide";
  if(panel==='members'&&route.kind!=='friends'){membersUI.render(panelElement);return;}
  panelElement.replaceChildren();
  if (panel === "none" || (panel === "members" && route.kind === "friends"))
    return;
  const titles = {
    search: "Search Results",
    pins: "Pinned Messages",
    inbox: "Inbox",
  };
  panelElement.append(
    node("div", "panel-head", [
      node("span", "", titles[panel]),
      ib("close", "Close Panel", () => {
        panel = "none";
        renderPanel();
      }),
    ]),
  );
  const results = node("div", "panel-results");
  panelElement.append(results);
  if (panel === "inbox") {
    activityUI.renderInbox(results, resultCard);
    return;
  }
  if (panel === "search" || panel === "pins")
    loadPanel(panel, results).catch((e) => toast(e.message, true));
}
async function showPanel(mode) {
  panel = mode;
  renderPanel();
}
async function loadPanel(mode, target) {
  const channel = route.channel;
  target.append(node("p", "muted small", "Loading…"));
  const data =
    mode === "pins"
      ? await api("/messages?pins=1&channel=" + encodeURIComponent(channel))
      : await api(
          "/search?q=" +
            encodeURIComponent(searchQuery) +
            (route.kind === "dm"
              ? "&channel=" + encodeURIComponent(channel)
              : "&server=" + encodeURIComponent(route.server)),
        );
  if (panel !== mode || !target.isConnected) return;
  target.replaceChildren();
  if (mode === "search")
    target.append(
      node("p", "muted small", `${data.length} results for “${searchQuery}”`),
    );
  if (!data.length)
    target.append(
      node(
        "p",
        "muted small",
        mode === "pins"
          ? "No pinned messages yet. Open a message’s menu to pin it."
          : "No messages found. Try another search.",
      ),
    );
  for (const m of data) target.append(resultCard(m));
}
function resultCard(m) {
  const card = node("article", "result-card");
  card.append(
    node("div", "result-location", "#" + channelName(m.channel)),
    node("div", "message-meta", [
      node("strong", "message-author", m.author),
      node("time", "", dateLabel(m.time) + " " + timeLabel(m.time)),
    ]),
    messageText(m),
  );
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", "Open message from " + m.author);
  card.onclick = run(() => openMessage(m));
  card.onkeydown = (event) => {
    if (event.target === card && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      card.click();
    }
  };
  return card;
}
function friendship(userId) {
  return state.friendships.find(
    (f) => [f.from, f.to].includes(me().id) && [f.from, f.to].includes(userId),
  );
}
async function openDM(userId) {
  const c = await api("/conversations", "POST", { userId });
  await refreshState();
  $("modal").close();
  return navigate({ kind: "dm", channel: c.id });
}
function profileLinkNodes(links){
 const linksNode=node('div','profile-links');for(const link of links||[]){try{const address=new URL(link.url);if(!['https:','http:'].includes(address.protocol)||address.username||address.password)continue;const a=node('a','profile-link',link.label||address.hostname);a.href=address.href;a.target='_blank';a.rel='noopener noreferrer';linksNode.append(a);}catch{}}return linksNode;
}
function profile(userId) {
  const user = person(userId);
  const banner = node("div", "profile-banner");
  banner.style.background = user.color;
  if(user.premium?.profile)banner.style.background='linear-gradient(120deg,'+user.premium.profile.bannerStart+','+user.premium.profile.bannerEnd+')';
  const card = node("div", "profile-card-body", [
    node("h2", "", user.displayName),
    node("p", "username", user.username),
  ]);
  if(user.pronouns)card.append(node("p","profile-pronouns",user.pronouns));
  if(user.profileLinks?.length)card.append(profileLinkNodes(user.profileLinks));
  if (user.bot) card.append(node("span", "bot-tag", "BOT"));
  card.append(...staffBadges(user));
  if (user.customStatus) card.append(node("p", "small", user.customStatus));
  card.append(node("div", "profile-divider"));
  if (user.bio)
    card.append(
      node("h3", "", "ABOUT ME"),
      node("div", "profile-bio", user.bio),
      node("div", "profile-divider"),
    );
  card.append(
    node("h3", "", "VOXORA MEMBER SINCE"),
    node(
      "div",
      "small",
      new Date(user.createdAt || Date.now()).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    ),
  );
  const s = selectedServer();
  if (s) {
    if(s.nicknames?.[userId])card.append(node('h3','','SERVER NICKNAME'),node('p','',s.nicknames[userId]));
    card.append(node("div", "profile-divider"), node("h3", "", "ROLES"));
    const chips = node("div", "profile-roles");
    const roles = manage.assignedRoles(s, userId);
    if (!roles.length)
      chips.append(manage.rolePill(s.roles.find((r) => r.id === "everyone")));
    for (const r of roles) chips.append(manage.rolePill(r));
    card.append(chips);
    if (timedOut(s, userId))
      card.append(
        node(
          "p",
          "timeout-badge",
          "Timed out until " + new Date(s.timeouts[userId]).toLocaleString(),
        ),
      );
    const operations = manage.targetActions(s, userId);
    if (operations.length)
      card.append(
        button(
          "Manage Member",
          () => openMemberManagement(s.id,userId),
          "secondary full",
        ),
      );
  }
  const actions = node("div", "profile-buttons");
  if (userId === me().id)
    actions.append(
      button("Edit Profile", () => settings("Profiles"), "primary"),
    );
  else if (user.bot)
    actions.append(
      node(
        "p",
        "muted small",
        "Use this bot’s commands in a server. Bots do not support direct messages.",
      ),
    );
  else {
    actions.append(button("Message", () => openDM(userId), "primary"));
    const f = friendship(userId);
    if (!f)
      actions.append(
        ib("friends", "Add Friend", async () => {
          await api("/friends/request", "POST", { username: user.username });
          toast("Friend request sent.");
          $("modal").close();
        }),
      );
    else if (f.status === "pending" && f.to === me().id)
      actions.append(
        ib("check", "Accept Friend Request", () =>
          api("/friends/" + f.id, "PATCH", {}),
        ),
      );
    actions.append(
      ib("more", "More", (e) =>
        context(e, [
          {
            label: state.blocked.includes(userId) ? "Unblock" : "Block",
            icon: "shield",
            danger: true,
            run: () =>
              api(
                "/blocks/" + userId,
                state.blocked.includes(userId) ? "DELETE" : "POST",
                {},
              ),
          },
          ...(f
            ? [
                {
                  label:
                    f.status === "accepted"
                      ? "Remove Friend"
                      : "Cancel Request",
                  icon: "close",
                  danger: true,
                  run: () => api("/friends/" + f.id, "DELETE"),
                },
              ]
            : []),
        ]),
      ),
    );
  }
  card.append(actions);
  modal([banner, avatar(user, "xl", true), card], 'profile-popup'+(user.premium?.profile?' plus-profile':''));
  if(user.premium?.profile)$('modal').style.setProperty('--profile-accent',user.premium.profile.accent);else $('modal').style.removeProperty('--profile-accent');
}
function openMemberManagement(serverId,userId){
  const root=node('section','member-management-panel');memberManagementView={root,serverId,userId,account:me().id};
  modal([root],'member-management-dialog');refreshMemberManagement();root.querySelector('button')?.focus();
}
function refreshMemberManagement(){
  const view=memberManagementView;if(!view?.root.isConnected||!$('modal').open)return;
  const s=state?.servers.find(s=>s.id===view.serverId),user=person(view.userId);
  if(me()?.id!==view.account||!s?.members.includes(view.userId)){$('modal').close();view.root.replaceChildren();memberManagementView=null;return;}
  const operations=manage.targetActions(s,view.userId),signature=JSON.stringify([s.name,user.displayName,user.username,user.color,user.avatarUrl,operations.map(item=>item.label)]);if(view.signature===signature)return;view.signature=signature;
  view.root.replaceChildren(button('Back to Profile',()=>profile(view.userId),'text-button'),node('h2','','Manage '+user.displayName),node('p','management-help','Member actions in '+s.name),node('div','member-management-identity',[avatar(user,'lg'),node('span','',user.username)]));
  for(const operation of operations)view.root.append(button(operation.label,()=>{
    const current=state.servers.find(server=>server.id===view.serverId),action=current&&manage.targetActions(current,view.userId).find(item=>item.label===operation.label);
    if(!action)throw Error('Your member-management permissions changed.');return action.run();
  },'member-management-action '+(operation.danger?'danger':'secondary'),operation.icon));
  if(!operations.length)view.root.append(node('p','management-help','No member actions are available with your current roles.'));
}
function renderFriends() {
  const target = $("friends-view");
  target.replaceChildren();
  const main = node("div", "friends-content");
  const list = node("div", "friends-list");
  main.append(list);
  const activity = node("aside", "friends-activity", [
    node("h2", "", "Active Now"),
  ]);
  const activeFriends = state.friendships
    .filter((f) => f.status === "accepted")
    .map((f) => person(f.from === me().id ? f.to : f.from))
    .filter((u) => state.voice.some((v) => v.userId === u.id));
  if (activeFriends.length)
    for (const user of activeFriends) activity.append(memberRow(user));
  else
    activity.append(
      node("div", "activity-empty", [
        node("strong", "", "It's quiet for now…"),
        document.createTextNode(
          "When a friend starts hanging out in voice, we’ll show it here!",
        ),
      ]),
    );
  main.append(activity);
  target.append(main);
  if (friendTab === "Add Friend") {
    const form = node("form", "add-friend-form");
    const value = input("", "You can add friends with their Voxora username.");
    value.required = true;
    value.maxLength = 24;
    value.setAttribute("aria-label", "Friend username");
    const send = node("button", "primary", "Send Friend Request");
    send.type = "submit";
    const error = node("div", "form-error");
    form.append(
      node("h2", "", "ADD FRIEND"),
      node("p", "", "You can add friends with their unique username."),
      node("div", "add-friend-input", [value, send]),
      error,
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        send.disabled = true;
        await api("/friends/request", "POST", { username: value.value });
        error.className = "form-success";
        error.textContent = "Success! Your friend request has been sent.";
        value.value = "";
      } catch (err) {
        error.className = "form-error";
        error.textContent = err.message;
      } finally {
        send.disabled = false;
      }
    };
    list.append(form);
    list.append(emptyFriends("A good conversation starts with a friend."));
    return;
  }
  const search = node("div", "friend-search");
  const q = input(friendQuery, "Search");
  q.setAttribute("aria-label", "Search friends");
  search.append(q, icon("search", 20));
  list.append(search);
  const results = node("div");
  list.append(results);
  q.oninput = () => {
    friendQuery = q.value;
    renderFriendRows(results);
  };
  renderFriendRows(results);
}
function emptyFriends(text) {
  return node("div", "friend-empty", [
    node("div", "friend-empty-art", [icon("friends", 70)]),
    node("span", "", text),
  ]);
}
function renderFriendRows(target) {
  let entries;
  if (friendTab === "Blocked")
    entries = state.blocked.map((id) => ({ user: person(id), blocked: true }));
  else
    entries = state.friendships
      .filter((f) =>
        friendTab === "Pending"
          ? f.status === "pending"
          : f.status === "accepted",
      )
      .map((f) => ({
        user: person(f.from === me().id ? f.to : f.from),
        friend: f,
      }))
      .filter((e) => friendTab !== "Online" || e.user.status !== "offline");
  entries = entries.filter((e) =>
    (e.user.displayName + " " + e.user.username)
      .toLowerCase()
      .includes(friendQuery.toLowerCase()),
  );
  target.replaceChildren(
    node(
      "div",
      "friend-list-title",
      friendTab.toUpperCase() + " — " + entries.length,
    ),
  );
  if (!entries.length) {
    target.append(
      emptyFriends(
        friendTab === "Pending"
          ? "There are no pending friend requests."
          : friendTab === "Blocked"
            ? "You haven’t blocked anyone."
            : friendTab === "Online"
              ? "No friends are online right now. Invite someone to hang out."
              : "You haven’t added any friends yet. Start with Add Friend.",
      ),
    );
    return;
  }
  for (const entry of entries) {
    const { user, friend, blocked } = entry;
    const row = node("div", "friend-row");
    row.append(
      avatar(user, "", true),
      node("div", "member-text", [
        node("strong", "", user.displayName),
        node(
          "small",
          "",
          blocked
            ? "Blocked"
            : friend.status === "pending"
              ? friend.to === me().id
                ? "Incoming Friend Request"
                : "Outgoing Friend Request"
              : user.customStatus ||
                {
                  online: "Online",
                  offline: "Offline",
                  idle: "Idle",
                  dnd: "Do Not Disturb",
                }[user.status],
        ),
      ]),
    );
    if (blocked)
      row.append(
        ib("close", "Unblock", () => api("/blocks/" + user.id, "DELETE")),
      );
    else if (friend.status === "pending") {
      if (friend.to === me().id)
        row.append(
          ib("check", "Accept", () =>
            api("/friends/" + friend.id, "PATCH", {}),
          ),
        );
      row.append(
        ib("close", friend.to === me().id ? "Ignore" : "Cancel", () =>
          api("/friends/" + friend.id, "DELETE"),
        ),
      );
    } else {
      row.append(
        ib("reply", "Message", () => openDM(user.id)),
        ib("more", "More", (e) =>
          context(e, [
            {
              label: "View Profile",
              icon: "friends",
              run: () => profile(user.id),
            },
            {
              label: "Remove Friend",
              icon: "close",
              danger: true,
              run: () => api("/friends/" + friend.id, "DELETE"),
            },
            {
              label: "Block",
              icon: "shield",
              danger: true,
              run: () => api("/blocks/" + user.id, "POST", {}),
            },
          ]),
        ),
      );
    }
    row.ondblclick = run(() => openDM(user.id));
    target.append(row);
  }
}
function serverDialog() {
  modal([
    node("h2", "", "Create Your Server"),
    node(
      "p",
      "",
      "Your server is where you and your friends hang out. Make yours and start talking.",
    ),
    node("div", "dialog-options", [
      button(
        "Create My Own",
        () => {
          const name = input("", "My awesome server");
          name.required = true;
          name.maxLength = 60;
          formDialog({
            title: "Customize Your Server",
            description: "Give your new server a personality with a name.",
            fields: [field("SERVER NAME", name)],
            submitLabel: "Create",
            submit: async () => {
              const s = await api("/servers", "POST", { name: name.value });
              await refreshState();
              await navigate({
                kind: "channel",
                server: s.id,
                channel: s.channels[0].id,
              });
            },
          });
        },
        "dialog-option",
        "plus",
      ),
      button("Join a Server", joinDialog, "dialog-option", "arrow"),
      button("Use a Template", () => communityUI.templates(), "dialog-option", "copy"),
    ]),
  ]);
}
function joinDialog(code = "") {
  if(typeof code!=="string")code="";
  const preview=node("div","invite-preview-slot");
  const value = input(code, "Enter an invite code or link");
  value.required = true;
  formDialog({
    title: "Join a Server",
    description: "Enter an invite below to join an existing server.",
    fields: [preview,field("INVITE LINK", value)],
    submitLabel: "Join Server",
    submit: async () => {
      const s = await api("/invites/join", "POST", { code: value.value });
      await refreshState();
      await navigate({
        kind: "channel",
        server: s.id,
        channel:
          s.channels.find((c) => c.type === "text")?.id || s.channels[0]?.id,
      });
      setTimeout(() => onboardingUI.maybeShow(state.servers.find(server => server.id === s.id)), 0);
    },
  });
  const update=invitePreview(()=>value.value,preview);value.onchange=update;value.onblur=update;update();
}
async function inviteDialog(s) {
  if (!s) return;
  if (!s.invite&&!s.customInvite?.active) {
    const invite = await api("/servers/" + s.id + "/invites", "POST", {
      expiresIn: 86400,
      maxUses: 0,
    });
    await refreshState();
    s = { ...s, invite: invite.code };
  }
  const custom=s.customInvite?.active;
  const link = location.origin + "/invite/" + (custom?s.customInvite.code:s.invite);
  const value = input(link);
  value.readOnly = true;
  value.setAttribute("aria-label", "Invite link");
  const box = node("div", "invite-box", [
    value,
    button("Copy", () => copy(link), "primary"),
  ]);
  modal([
    node("h2", "", `Invite friends to ${s.name}`),
    inviteCard({...s,memberCount:s.members.length,bannerUrl:s.inviteBannerUrl||s.bannerUrl}),
    node(
      "p",
      "",
      "Share this link with a friend connected to this Voxora server.",
    ),
    node("div", "section-label", "SEND A SERVER INVITE LINK"),
    box,
    node(
      "p",
      "small muted",
      custom?"This custom link stays active while the server has boost level 3.":"Server managers can revoke or limit invite links in Server Settings → Invites.",
    ),
  ]);
}
function channelDialog(c, s = selectedServer(), categoryId) {
  channelsUI.editChannel(c, s, categoryId);
}
function followAnnouncement(channel) {
  const servers = state.servers.filter((s) => s.id !== route.server && hasServer("manageChannels", s));
  if (!servers.length) return toast("You need Manage Channels in another server to follow this channel.", true);
  const server = node("select"), destination = node("select");
  server.setAttribute("aria-label", "DESTINATION SERVER");
  destination.setAttribute("aria-label", "DESTINATION CHANNEL");
  for (const s of servers) server.append(new Option(s.name, s.id));
  function options() {
    destination.replaceChildren();
    for (const c of servers.find((s) => s.id === server.value).channels.filter((c) => c.type === "text" && !c.forum && c.permissions.includes("sendMessages")))
      destination.append(new Option("#" + c.name, c.id));
  }
  server.onchange = options; options();
  formDialog({
    title: "Follow #" + channel.name,
    fields: [node("p", "management-help", "Published announcements will be copied to this channel. Previous posts are not imported. Following pauses if you lose access to the source or management permissions in the destination."), field("DESTINATION SERVER", server), field("DESTINATION CHANNEL", destination)],
    submitLabel: "Follow Channel",
    submit: async () => {
      if (!destination.value) throw Error("Choose a text channel you can post to.");
      await api("/announcements/" + channel.id + "/follows", "POST", { channelId: destination.value });
      toast("Announcement channel followed.");
    },
  });
}
async function followingDialog(channel,target,onSaved) {
  const account=me()?.id;
  try {
    const follows = await api("/announcement-subscriptions?channel=" + channel.id);
    if(!target?.isConnected||me()?.id!==account)return;
    const content = [node("p", "management-help", "To follow another channel, open its announcement channel and choose Follow.")];
    for (const f of follows) content.push(node("div", "permission-row", [
      node("span", "", f.serverName + " · #" + f.sourceName + (f.active ? "" : " (paused)")),
      button("Unfollow", run(async () => { await api("/announcement-follows/" + f.id, "DELETE"); await followingDialog(channel,target,onSaved); }), "danger-button"),
    ]));
    if (!follows.length) content.push(node("p", "muted", "This channel is not following any announcement channels."));
    target.replaceChildren(...target.querySelectorAll(".settings-location,h2"),...content);
  } catch (error) { toast(error.message, true); }
}
function publishAnnouncement(message) {
  confirmDialog("Publish Announcement", "Send this post and its attachments to following servers? Copies keep this published version; future edits or deletion here do not change them.", async () => {
    const result = await api("/messages/" + message.id + "/publish", "POST", {});
    toast("Published to " + result.delivered + " following channel(s).");
  });
}
function channelMenu(event, c, s) {
  const items = [
    ...(c.type === "text" ? activityUI.channelItems(c.id) : []),
    { label: "Copy Channel Name", icon: "copy", run: () => copy(c.name) },
  ];
  if (c.announcement) items.push({ label: "Follow Channel", icon: "announcement", run: () => followAnnouncement(c) });
  if(hasServer("manageChannels",s)||hasServer("manageRoles",s))items.push({label:"Channel Settings",icon:"settings",run:()=>channelsUI.openSettings(c,s)});
  if (hasServer("manageChannels", s))
    items.push(
      {
        label: "Delete Channel",
        icon: "trash",
        danger: true,
        run: () =>
          confirmDialog(
            "Delete Channel",
            `Are you sure you want to delete #${c.name}? Its messages will be permanently deleted.`,
            async () => {
              await api("/channels/" + c.id, "DELETE");
              await refreshState();
              if (route.channel === c.id)
                navigate({
                  kind: "channel",
                  server: s.id,
                  channel: s.channels.find(
                    (x) => x.id !== c.id && x.type === "text",
                  )?.id,
                });
            },
          ),
      },
    );
  if (hasServer("manageChannels", s))
    items.push(
      {
        label: "Move Channel Up",
        icon: "chevron",
        run: () => channelsUI.move(s, c, -1),
      },
      {
        label: "Move Channel Down",
        icon: "chevron",
        run: () => channelsUI.move(s, c, 1),
      },
      {
        label: "Move to Category",
        icon: "reply",
        run: () => channelsUI.moveTo(c, s),
      },
    );
  context(event, items);
}

function quickSwitcher() {
  const search = input("", "Where would you like to go?");
  search.className = "switcher-input";
  search.setAttribute("aria-label", "Quick switcher");
  const results = node("div", "switcher-list");
  const render = () => {
    const q = search.value.toLowerCase();
    const items = [
      {
        name: "Friends",
        symbol: "friends",
        target: { kind: "friends" },
        location: "Direct Messages",
      },
      ...state.servers.flatMap((s) =>
        s.channels.map((c) => ({
          name: c.name,
          symbol: c.type === "voice" ? "speaker" : c.forum ? "forum" : "hash",
          target: {
            kind: c.type === "voice" ? "voice" : "channel",
            server: s.id,
            channel: c.id,
          },
          location: s.name,
        })),
      ),
      ...state.conversations.map((c) => ({
        name: dmPerson(c).displayName,
        symbol: "at",
        target: { kind: "dm", channel: c.id },
        location: "Direct Message",
      })),
    ]
      .filter((x) => (x.name + " " + x.location).toLowerCase().includes(q))
      .slice(0, 30);
    results.replaceChildren(
      ...items.map((item) => {
        const b = button(
          "",
          async () => {
            $("modal").close();
            await navigate(item.target);
          },
          "switcher-item",
        );
        b.append(
          icon(item.symbol),
          node("span", "", item.name),
          node("small", "", item.location),
        );
        return b;
      }),
    );
  };
  search.oninput = render;
  search.onkeydown = (e) => {
    if (e.key === "Enter") results.querySelector("button")?.click();
  };
  render();
  modal(
    [
      search,
      results,
      node(
        "p",
        "quick-hint",
        "QUICK SWITCHER · Search servers, channels, and conversations",
      ),
    ],
    "switcher-dialog",
  );
  search.focus();
}
function helpDialog() {
  modal([
    node("h2", "", "Welcome to Voxora"),
    node(
      "p",
      "",
      "Create a server or invite friends, pick a channel, and start a conversation. Voice channels connect your microphone directly to the people who join you.",
    ),
    node("div", "section-label", "KEYBOARD SHORTCUTS"),
    node(
      "p",
      "",
      "Ctrl / ⌘ + K — Quick switcher\nCtrl / ⌘ + Shift + M — Mute\nCtrl / ⌘ + Shift + D — Deafen\nEnter — Send message\nShift + Enter — New line\nArrow Up — Edit your last message",
    ),
    node(
      "p",
      "small muted",
      "Voxora is an independent application. Your accounts, friends, and messages belong to the Voxora server you are connected to.",
    ),
  ]);
}
function voiceMemberMenu(event,p,s){
  if(!s)return;const permissions=channelPermissions(s,me().id,p.channel||voice.channelId),items=[];
  if(outranks(s,me().id,p.userId)){
    for(const [permission,action,label] of [['muteMembers',p.serverMuted?'unmute':'mute',p.serverMuted?'Server Unmute':'Server Mute'],['deafenMembers',p.serverDeafened?'undeafen':'deafen',p.serverDeafened?'Server Undeafen':'Server Deafen'],['moveMembers','disconnect','Disconnect Member']])if(permissions.includes(permission))items.push({label,run:()=>api('/voice/members/'+p.clientId,'POST',{action})});
    if(permissions.includes('moveMembers'))for(const c of s.channels.filter(c=>c.type==='voice'&&c.id!==(p.channel||voice.channelId)&&channelPermissions(s,p.userId,c.id).includes('connect')))items.push({label:'Move to '+c.name,run:()=>api('/voice/members/'+p.clientId,'POST',{action:'move',channel:c.id})});
  }
  if(items.length)context(event,items);
}
function renderCall() {
  const target = $("call-view");
  const channel = route.channel,
    c = selectedChannel();
  target.replaceChildren(
    node("div", "call-title", [
      icon("speaker", 22),
      document.createTextNode(c?.name || "Voice"),
    ]),
  );
  if (voice.channelId !== channel) {
    target.append(
      node("div", "call-empty", [
        icon("speaker", 48),
        node("h2", "", c?.name || "Voice Channel"),
        node(
          "p",
          "",
          "Ready to hang out? Join this channel to talk, turn on your camera, or share your screen.",
        ),
        button(c?.stage?'Join Stage':"Join Voice", () => voice.join(channel), "primary"),
      ]),
    );
    return;
  }
  const grid = node("div", "call-grid");
  const participants = [
    { clientId, userId: me().id,...voice.serverSelf },
    ...voice.peers.values(),
  ].filter((p, i, a) => a.findIndex((x) => x.userId === p.userId) === i);
  for (const p of participants) {
    const user = person(p.userId);
    const card = node(
      "div",
      "call-participant" +
        (p.clientId === clientId ||
        voice.connections.get(p.clientId)?.pc.connectionState === "connected"
          ? " connected"
          : ""),
    );
    card.append(avatar(user));
    card.oncontextmenu=event=>voiceMemberMenu(event,p,selectedServer());
    const stream =
      p.clientId === clientId
        ? voice.videoStream
        : voice.connections.get(p.clientId)?.remoteStream;
    const videoEnabled=p.clientId===clientId?!!voice.videoStream:!p.mediaStateKnown||p.cameraOn||p.screenOn;
    if (
      videoEnabled && stream?.getVideoTracks().some((t) => t.readyState === "live" && !t.muted)
    ) {
      const video = node("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      card.append(video);
    }
    card.append(
      node("div", "call-name", [
        document.createTextNode(user.displayName),
        ...((p.clientId === clientId && voice.muted)||p.selfMuted||p.serverMuted||p.serverDeafened ? [icon("micOff", 13)] : []),
      ]),
    );
    if(c?.stage){card.append(node('small','stage-status',p.stageSpeaker?'Speaker':p.requestedToSpeak?'Hand raised':'Audience'));
      if(p.clientId!==clientId&&voice.allowed('manageStage')&&(p.stageSpeaker?outranks(selectedServer(),me().id,p.userId):true))card.append(button(p.stageSpeaker?'Move to Audience':'Invite to Speak',()=>api('/voice/stage/speaker','POST',{clientId,targetId:p.clientId,speaker:!p.stageSpeaker}),'text-button'));
    }
    grid.append(card);
  }
  target.append(
    grid,
    node("div", "call-controls", [
      ib(
        "video",
        voice.cameraStream ? "Turn Off Video" : "Turn On Video",
        () => voice.toggleCamera(),
        voice.cameraStream ? "active" : "",
      ),
      ib(
        "screen",
        voice.screenStream ? "Stop Sharing" : "Share Your Screen",
        () => voice.toggleScreen(),
        voice.screenStream ? "active" : "",
      ),
      ib('volume','Open Soundboard',()=>serverAssetsUI.soundboard()),
      ib(
        voice.muted ? "micOff" : "mic",
        voice.muted ? "Unmute" : "Mute",
        () => voice.toggleMute(),
        voice.muted ? "active" : "",
      ),
      ib("disconnect", "Disconnect", () => voice.leave(), "hangup"),
    ]),
  );
  if(c?.stage&&!voice.serverSelf?.stageSpeaker&&voice.allowed('requestToSpeak')&&voice.allowed('speak'))target.append(button(voice.serverSelf?.requestedToSpeak?'Cancel Request to Speak':'Request to Speak',()=>api('/voice/stage/request','POST',{clientId,requested:!voice.serverSelf?.requestedToSpeak}),'primary'));
  if(voice.serverSelf?.serverMuted||voice.forcedDeafened)target.append(node('p','management-help',voice.forcedDeafened?'A moderator has server-deafened you.':'A moderator has server-muted you.'));
  if(voice.canSpeak&&voice.pushToTalk)target.append(node('p','management-help','Push to talk: hold V while outside a text field.'));
}
function settings(tab = "My Account") {
  profilePreviewRender=null;
  if (tab === "Website") {
    location.assign("/");
    return;
  }
  if (tab === "Developer Portal") {
    location.assign("/developers");
    return;
  }
  if (tab === "Platform Admin"||tab==='Workspace Admin') {
    location.assign("/admin");
    return;
  }
  const tabs = [
    "My Account",
    "Profiles",
    'Voxora Plus',
    "Privacy & Safety",
    "Notifications",
    "Voice & Video",
    "Appearance",
    'Server Organization',
    'Settings Backup',
    "Updates",
    "Server Connection",
    "Developer Portal",
    "Website",
    ...(state.platform?.permissions.length ? [state.platform.scope==='private'?'Workspace Admin':'Platform Admin'] : []),
  ];
  const nav = node("nav", "settings-nav", [node("h3", "", "USER SETTINGS")]);
  const content = node("div", "settings-content");
  for (const name of tabs)
    nav.append(
      button(name, () => settings(name), name === tab ? "active" : ""),
    );
  nav.append(
    node("div", "settings-rule"),
    button(
      "Log Out",
      async () => {
        await voice.leave();
        await api("/auth/logout", "POST", {});
        eventSource?.close();
        $("modal").close();
        state = null;
        showAuth();
      },
      "danger",
    ),
  );
  modal([nav, content], 'settings-dialog user-settings-dialog'+(tab==='Voxora Plus'?' premium-settings':''));
  content.append(node("h2", "", tab));
  if (tab === "My Account") {
    const banner = node("div", "account-banner");
    banner.style.background = me().color;
    const info = node("div", "account-fields");
    for (const [name, value] of [
      ["DISPLAY NAME", me().displayName],
      ["USERNAME", me().username],
      ["MEMBER SINCE", new Date(me().createdAt).toLocaleDateString()],
    ])
      info.append(
        node("div", "account-field", [
          node("small", "", name),
          node("span", "", value),
        ]),
      );
    content.append(
      node("div", "account-card", [
        banner,
        node("div", "account-identity", [
          avatar(me()),
          node("strong", "", me().displayName),
        ]),
        info,
      ]),
      button("Edit User Profile", () => settings("Profiles"), "primary"),
    );
  }
  if (tab === "Profiles") {
    const f = node("form");
    const display = input(me().displayName);
    display.maxLength = 32;
    display.required = true;
    const bio = node("textarea");
    bio.value = me().bio || "";
    bio.maxLength = state.premium?.perks.bioCharacters||190;
    const status = input(me().customStatus || "", "What’s happening?");
    status.maxLength = 80;
    const color = input(me().color, "", "color");
    color.className = "color-input";
    const pronouns=input(me().pronouns||'','e.g. she/her, he/him, they/them');pronouns.maxLength=40;
    const links=Array.from({length:3},(_,i)=>({label:input(me().profileLinks?.[i]?.label||'','Link label'),url:input(me().profileLinks?.[i]?.url||'','https://example.com')}));
    const linkFields=node('section','profile-links-editor',[node('h3','','PROFILE LINKS'),node('p','muted small','Add up to three web links. People who can view your profile can see these links.')]);
    for(const [i,link]of links.entries()){link.label.maxLength=40;link.url.maxLength=2048;linkFields.append(node('div','profile-link-fields',[field('LINK LABEL '+(i+1),link.label),field('LINK URL '+(i+1),link.url)]));}
    const preview=node('section','profile-preview');
    profilePreviewRender=()=>{if(!f.isConnected)return;preview.replaceChildren(node('h3','','LIVE PROFILE PREVIEW'),avatar({...me(),color:color.value},'lg',true),node('h2','',display.value||me().displayName),node('p','username',me().username));if(pronouns.value)preview.append(node('p','profile-pronouns',pronouns.value));if(status.value)preview.append(node('p','small',status.value));if(bio.value)preview.append(node('p','profile-bio',bio.value));preview.append(profileLinkNodes(links.map(l=>({label:l.label.value,url:l.url.value}))));};
    for(const control of[display,bio,status,color,pronouns,...links.flatMap(l=>[l.label,l.url])])control.addEventListener('input',()=>profilePreviewRender?.());
    content.append(pictureUI.control({kind:'avatar'}),preview);
    const error = node("div", "form-error");
    const save = node("button", "primary", "Save Changes");
    save.type = "submit";
    f.append(
      field("DISPLAY NAME", display),
      field("ABOUT ME", bio),
      field("PRONOUNS",pronouns),
      field("CUSTOM STATUS", status),
      field("AVATAR COLOR", color),
      linkFields,
      error,
      save,
    );
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        save.disabled = true;
        await api("/profile", "PATCH", {
          displayName: display.value,
          bio: bio.value,
          customStatus: status.value,
          color: color.value,
          pronouns:pronouns.value,
          profileLinks:links.filter(l=>l.url.value.trim()).map(l=>({label:l.label.value,url:l.url.value.trim()})),
        });
        await refreshState();
        toast("Your profile has been updated.");
      } catch (err) {
        error.textContent = err.message;
      } finally {
        save.disabled = false;
      }
    };
    content.append(f);
    profilePreviewRender();
  }
  if (tab === "Privacy & Safety") {
    content.append(
      node(
        "p",
        "",
        "Blocking someone prevents direct messages and friend requests between you.",
      ),
      node("h3", "", "BLOCKED USERS"),
    );
    if (!state.blocked.length)
      content.append(
        node("p", "settings-empty", "You haven’t blocked anyone."),
      );
    for (const id of state.blocked) {
      const user = person(id);
      content.append(
        node("div", "settings-row", [
          node("span", "", user.displayName),
          button(
            "Unblock",
            async () => {
              await api("/blocks/" + id, "DELETE");
              await refreshState();
              settings(tab);
            },
            "secondary",
          ),
        ]),
      );
    }
  }
  if (tab === "Appearance") {
    content.append(node('p','muted','Appearance syncs with your account across devices on this Voxora server.'));
    content.append(node("h3", "", "THEME"));
    const choices = node("div", "theme-choices");
    const accent=node('select');accent.id='workspace-accent';accent.setAttribute('aria-label','Accent color');for(const value of ['mint','copper','iris'])accent.append(new Option(value[0].toUpperCase()+value.slice(1),value));accent.value=preferences.accent||'mint';accent.onchange=()=>{preferences.accent=accent.value;applyPreferences();workspaceUI.saveAppearance().catch(e=>toast(e.message,true));};
    for (const theme of ["dark", "light"]) {
      const choice=button(
          theme === "dark" ? "Dark" : "Light",
          () => {
            preferences.theme = theme;
            applyPreferences();
            workspaceUI.saveAppearance().catch(e=>toast(e.message,true));
          },
          "theme-choice " +
            theme +
            (preferences.theme === theme ? " active" : ""),
        );choice.dataset.theme=theme;choices.append(choice);
    }
    const compact = input("", "", "checkbox");
    compact.checked = preferences.compact;
    compact.id='workspace-compact';compact.setAttribute('aria-label','Compact message display');
    compact.onchange = () => {
      preferences.compact = compact.checked;
      applyPreferences();
      workspaceUI.saveAppearance().catch(e=>toast(e.message,true));
    };
    const size = input(String(preferences.fontSize), "", "range");
    size.min = 13;
    size.max = 20;
    size.id='workspace-font';size.setAttribute('aria-label','Chat font size');
    size.oninput = () => {
      preferences.fontSize = Number(size.value);
      applyPreferences();
    };
    size.onchange=()=>workspaceUI.saveAppearance().catch(e=>toast(e.message,true));
    const motion=input('','','checkbox');motion.id='workspace-reduced-motion';motion.setAttribute('aria-label','Reduce animations');motion.checked=!!preferences.reducedMotion;motion.onchange=()=>{preferences.reducedMotion=motion.checked;applyPreferences();workspaceUI.saveAppearance().catch(e=>toast(e.message,true));};
    content.append(
      choices,
      field('ACCENT COLOR',accent),
      node("div", "settings-row", [
        node("span", "", "Compact message display"),
        compact,
      ]),
      node("div", "settings-row", [node("span", "", "Chat font size"), size]),
      node('div','settings-row',[node('span','','Reduce animations'),motion]),
    );
  }
  if(tab==='Server Organization')workspaceUI.organization(content);
  if(tab==='Voxora Plus')premiumUI.account(content);
  if(tab==='Profiles')serverAssetsUI.profileTag(content).catch(error=>toast(error.message,true));
  if(tab==='Settings Backup')workspaceUI.portability(content);
  if (tab === "Notifications") {backgroundPushUI.render(content);activityUI.renderSettings(content);}
  if (tab === "Voice & Video") {
    const mode=node('select');mode.setAttribute('aria-label','Voice input mode');mode.append(new Option('Voice activity','voiceActivity'),new Option('Push to talk (hold V)','pushToTalk'));mode.value=preferences.inputMode||'voiceActivity';mode.onchange=()=>{preferences.inputMode=mode.value;applyPreferences();voice.applyAudio();};content.append(field('VOICE INPUT MODE',mode),node('p','management-help','Push to talk uses V while outside text fields. Channels can require push to talk by disabling Use Voice Activity.'));
    for(const [key,label] of [['noiseSuppression','Noise suppression'],['echoCancellation','Echo cancellation'],['autoGainControl','Automatic gain control']]){
      const control=input('','','checkbox');control.checked=preferences[key]!==false;control.setAttribute('aria-label',label);control.onchange=run(async()=>{preferences[key]=control.checked;applyPreferences();if(voice.channelId&&voice.canSpeak)await voice.changeMicrophone();});content.append(node('label','permission-row',[node('span','',label),control]));
    }
    const devices = node("select");
    devices.setAttribute("aria-label", "Input device");
    devices.append(new Option("Default microphone", ""));
    const fill = async () => {
      const list = await navigator.mediaDevices.enumerateDevices();
      devices.replaceChildren(new Option("Default microphone", ""));
      for (const d of list.filter((d) => d.kind === "audioinput"))
        devices.append(new Option(d.label || "Microphone", d.deviceId));
      devices.value = preferences.inputDevice || "";
    };
    fill().catch(() => {});
    devices.onchange = async () => {
      preferences.inputDevice = devices.value;
      applyPreferences();
      if (voice.channelId&&voice.canSpeak) await voice.changeMicrophone();
    };
    const volume = input(
      String(Math.round(preferences.volume * 100)),
      "",
      "range",
    );
    volume.min = 0;
    volume.max = 100;
    volume.oninput = () => {
      preferences.volume = Number(volume.value) / 100;
      applyPreferences();
      voice.applyAudio();
      serverAssetsUI.enforcePlayback();
    };
    content.append(
      field("INPUT DEVICE", devices),
      button(
        "Allow microphone access",
        async () => {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          stream.getTracks().forEach((t) => t.stop());
          await fill();
          toast("Microphone access granted.");
        },
        "secondary",
      ),
      node("div", "settings-row", [node("span", "", "Output volume"), volume]),
      node(
        "p",
        "small muted",
        "Microphone and camera access require a secure connection. Across different networks, the server may need TURN relay configuration.",
      ),
    );
  }
  if (tab === "Server Connection") {
    content.append(
      node(
        "p",
        "",
        "Connect to the same hosted Voxora server as your friends to share accounts, channels, and conversations.",
      ),
      node("p", "connection-tag", "Connected to " + location.origin),
      node('p','connection-private-note',state.platform?.scope==='private'?'This is a private workspace on this computer. Its accounts and owner are separate from the shared Voxora platform. Connect everyone to the same hosted address to share communities.':'Accounts and server members are shared with people connected to this same Voxora address. Joining a private server still requires an invite.'),
      node('p','connection-instance','Workspace ID: '+(state.platform?.instanceId||'Unavailable on this server')),
      button("Change Server", connectionDialog, "primary"),
      node('p','connection-health',connectionDescription()),
      button('Retry Live Sync',()=>eventSource?.request()),
      ...(location.origin!=='https://voxora-public.onrender.com'?[button('Join Public Voxora',async()=>{if(window.voxoraDesktop)await window.voxoraDesktop.connect('https://voxora-public.onrender.com');else location.assign('https://voxora-public.onrender.com/app');},'primary'),node('p','connection-public-note','Public Voxora uses one shared service. Local accounts and messages stay on this computer; sign in or register separately on the public service.')]:[]),
    );
  }
  if (tab === "Updates") renderUpdates({ content, node, button, field, toast });
}
function connectionDialog() {
  const value = input(location.origin, "https://your-voxora-server.example");
  value.required = true;
  formDialog({
    title: "Connect to a Server",
    description:
      "Use the address of a hosted Voxora instance. Accounts and conversations are kept on that server.",
    fields: [field("SERVER ADDRESS", value)],
    submitLabel: "Connect",
    submit: async () => {
      const url = new URL(value.value);
      if (
        url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        )
      )
        throw new Error("Use HTTPS, or HTTP for localhost.");
      if (window.voxoraDesktop) await window.voxoraDesktop.connect(url.origin);
      else location.assign(url.origin);
    },
  });
}
function refreshState(signal) {
  refreshAgain = true;
  if (refreshTask) return refreshTask;
  refreshTask = (async () => {
    try {
      do {
        refreshAgain = false;
        const account=me()?.id;
        let next;
        try { next = await api('/state?client='+encodeURIComponent(clientId),'GET',undefined,{signal:signal||AbortSignal.timeout(15000)}); }
        catch(error){error.account=true;throw error;}
        if (!state||me()?.id!==account||next.me.id!==account) return;
        const previousChannel = selectedChannel();
        state = next;
        channelsUI.refreshSettings();
        manage.refreshSettings();
        refreshMemberManagement();
        pictureUI.refresh();
        serverAssetsUI.refresh();
        profilePreviewRender?.();
        messages=messages.map(m=>{
          const s=state.servers.find(s=>s.channels.some(c=>c.id===m.channel)),user=state.users.find(u=>u.id===m.authorId);
          if(!s||!user)return m;
          return {...m,author:s.nicknames?.[m.authorId]||user.displayName,reply:m.reply?{...m.reply,author:s.nicknames?.[m.reply.authorId]||state.users.find(u=>u.id===m.reply.authorId)?.displayName||m.reply.author}:m.reply};
        });
        forumsUI.refresh();
        workspaceUI.apply(next.workspace);
        hubUI.apply(next.hub);
        scheduledUI.apply(next.scheduled);
        activityUI.apply(next.activity);
        const channelChanged =
          previousChannel?.name !== selectedChannel()?.name ||
          previousChannel?.topic !== selectedChannel()?.topic;
        if (["channel", "dm"].includes(route.kind)) {
          updateComposerPermissions();
          const scroll = $("chat-scroll").scrollTop;
          renderWelcome();
          renderMessages();
          $("chat-scroll").scrollTop = scroll;
        }
        renderRail();
        renderSidebar();
        if (channelChanged) {
          header();
          if (selectedChannel())
            document.title = "#" + selectedChannel().name + " | Voxora";
        }
        renderPanel();
        if (route.kind === 'friends') header();
        if (route.kind === "friends" && friendTab !== "Add Friend")
          renderFriends();
        if (route.kind === "voice") renderCall();
        if (["channel", "voice"].includes(route.kind) && !selectedChannel())
          await navigate({ kind: "friends" });
        studioUI.refresh().catch(e=>toast(e.message,true));
        careUI.refresh().catch(e=>toast(e.message,true));
        communityUI.refresh();
        conversationUI.refresh();
        onboardingUI.refresh();
        safetyUI.refresh();
        premiumUI.refresh();
        membersUI.refresh();
      } while (refreshAgain);
    } finally {
      refreshTask = null;
    }
  })();
  return refreshTask;
}
function connectEvents() {
  eventSource?.close();
  notificationSequence=state.activity?.through||0;threadNotificationSequence=state.activity?.threadThrough||0;syncSupported=true;
  eventSource = createRealtime({url:'/api/events?client='+clientId,onEvent:handleEvent,synchronize:async signal=>{await refreshState(signal);await reconcileNotifications(signal);await reconcileMessages(signal);},onStatus:phase=>{connectionPhase=phase;if(state)renderAppbar();},onDisconnect:()=>{
    if (voice.channelId) {
      voice.leave(false).catch(() => {});
      toast("Connection lost. Voice has been disconnected.", true);
    }
  },onUnauthorized:error=>{state=null;showAuth();$('auth-error').textContent=error.status===401?'Your session expired. Please sign in again.':error.message;},onError:error=>toast(error.message,true)});
  eventSource.start();
}
async function reconcileNotifications(signal){
  if(!state||!syncSupported)return;
  const account=me().id;
  for(let page=0;page<3;page++){
    let batch;
    try{batch=await api('/sync?after='+notificationSequence+'&threadAfter='+threadNotificationSequence,'GET',undefined,{signal});}
    catch(error){if(error.status===404){syncSupported=false;return;}if(error.status===409){notificationSequence=state?.activity?.through||0;threadNotificationSequence=state?.activity?.threadThrough||0;return;}throw error;}
    if(me()?.id!==account)return;
    if([...batch.messages,...batch.threadMessages].some(m=>!activityUI.entry(m.channel)))await refreshState(signal);
    if(me()?.id!==account)return;
    for(const m of batch.messages)activityUI.incoming(m);
    for(const m of batch.threadMessages)activityUI.incoming(m,{threadVisible:conversationUI.isViewingThread(m.threadId)});
    notificationSequence=batch.next;threadNotificationSequence=batch.threadNext;
    activityUI.advance(notificationSequence,threadNotificationSequence);
    if(!batch.hasMore)return;
  }
}
async function reconcileMessages(signal){
  if(!state||!['channel','dm'].includes(route.kind)||selectedChannel()?.forum||hasNewer)return;
  const account=me().id,channel=route.channel,generation=loadId,revision=messageRevision;
  const data=await api('/messages?channel='+encodeURIComponent(channel),'GET',undefined,{signal});
  if(me()?.id!==account||route.channel!==channel||loadId!==generation||messageRevision!==revision||hasNewer)return;
  const existing=new Set(messages.map(m=>m.id)),first=data[0]?.sequence||0;
  const merged=[...(data.length===200?messages.filter(m=>m.sequence<first):[]),...data].sort((a,b)=>a.sequence-b.sequence);
  if(JSON.stringify(merged)===JSON.stringify(messages))return;
  const scroll=$('chat-scroll'),position=scroll.scrollTop,nearBottom=scroll.scrollHeight-position-scroll.clientHeight<140;
  for(const m of data)if(!existing.has(m.id))activityUI.incoming(m);
  messages=merged;messageRevision++;hasOlder=data.length===200||hasOlder&&merged.length>200;
  renderMessages();updateNewMessagesBar();if(nearBottom)scrollBottom();else scroll.scrollTop=position;
}
async function handleEvent(event) {
  forumsUI.handleEvent(event);
  if (!state) return;
  if(['thread-message-update','thread-message-delete','thread-deleted'].includes(event.type))hubUI.refresh().catch(()=>{});
  if(['care-update','knowledge-update'].includes(event.type)){await refreshState();return;}
  if(event.type==='studio-update'){await refreshState();return;}
  if(event.type==='notebook-update'){notebookUI.refresh();return;}
  if(event.type==='scheduled-update'){await scheduledUI.refresh();return;}
  if(['hub-update','reminder-due'].includes(event.type)){await hubUI.handleEvent(event);return;}
  if(event.type==='workspace-update'){await refreshState();return;}
  if(event.type==='moderation-update'){safetyUI.refresh();return;}
  if (event.type === "desktop-update-check") {
    window.voxoraDesktop?.checkForUpdates?.().catch(error => toast(error.message, true));
    return;
  }
  if (event.type === "saved-update") { await refreshState(); conversationUI.handleEvent(event); return; }
  if (event.type.startsWith("thread-")) {
    if(event.type==='thread-message')activityUI.incoming(event.message,{threadVisible:conversationUI.isViewingThread(event.threadId)});
    else activityUI.scheduleRefresh();
    conversationUI.handleEvent(event); return;
  }
  if (event.type === "account-suspended") {
    await voice.leave(false);
    eventSource?.close();
    state = null;
    if (signup) $("auth-switch").click();
    showAuth();
    $("auth-error").textContent = event.reason;
    return;
  }
  if (event.type === "activity-update") {
    activityUI.scheduleRefresh();
    return;
  }
  if (event.type === "refresh" || event.type === "connected") {
    await refreshState();
    if (event.type === "connected" && !hasNewer && route.channel && ["channel", "dm"].includes(route.kind))
      await reconcileMessages(AbortSignal.timeout(15000));
    return;
  }
  if (event.type === "voice-disconnected") {
    await voice.leave(false);
    toast(event.reason, true);
    return;
  }
  if(event.type==='voice-move'){await voice.join(event.channel);await navigate({kind:'voice',server:event.serverId,channel:event.channel});return;}
  if (event.type === "voice-peers" || event.type === "signal") {
    await voice.handle(event);
    return;
  }
  if(event.type==='soundboard-play'){serverAssetsUI.soundEvent(event);return;}
  if (event.type === "typing") {
    typing.set(event.user.id, { ...event, time: Date.now() });
    updateTyping();
    return;
  }
  if (event.type === "message" || event.type === "message-update") {
    if(event.type==='message-update')hubUI.refresh().catch(()=>{});
    const m = event.message;
    if (event.type === "message") {
      noteOwnMessage(m);
      activityUI.incoming(m);
    } else activityUI.scheduleRefresh();
    if (m.channel === route.channel) {
      messageRevision++;
      const nearBottom =
        $("chat-scroll").scrollHeight -
          $("chat-scroll").scrollTop -
          $("chat-scroll").clientHeight <
        140;
      const index = messages.findIndex((x) => x.id === m.id);
      if (index >= 0) messages[index] = m;
      else if (event.type === "message" && !hasNewer) messages.push(m);
      messages.sort((a, b) => a.sequence - b.sequence);
      renderMessages();
      typing.delete(m.authorId);
      updateTyping();
      if (nearBottom && !hasNewer) scrollBottom();
    }
    if (panel === "pins") renderPanel();
  } else if (event.type === "message-delete") {
    hubUI.refresh().catch(()=>{});
    activityUI.scheduleRefresh();
    if (event.channel === route.channel) {
      messageRevision++;
      messages = messages.filter((m) => m.id !== event.id);
      renderMessages();
    }
  }
}
async function authenticated(data) {
  eventSource?.close();
  const destination = new URLSearchParams(location.search).get("next");
  if (["developers", "admin", "plus"].includes(destination)) {
    location.replace("/" + destination);
    return;
  }
  state = data;
  scheduledUI.apply(data.scheduled);
  hubUI.apply(data.hub);
  await workspaceUI.initialize(data.workspace);
  activityUI.reset();
  $("loading").hidden = true;
  $("auth").hidden = true;
  $("shell").hidden = false;
  connectEvents();
  drafts = storage.get("drafts:" + me().id, {});
  let previous = storage.get("route:" + me().id, route);
  if (
    previous.kind === "channel" &&
    !state.servers.some((s) => s.id === previous.server)
  )
    previous = { kind: "friends" };
  await navigate(previous);
  backgroundPushUI.apply().catch(()=>{});
  if(['success','cancelled','returned'].includes(new URLSearchParams(location.search).get('plus')))settings('Voxora Plus');
  const invite = location.pathname.match(/^\/invite\/([\w-]+)$/)?.[1];
  if (invite) joinDialog(invite);
}
function showAuth() {
  backgroundPushUI.reset();
  serverAssetsUI.stopPlayback();
  $("modal").close();$("modal-content").replaceChildren();
  if(signup)$("auth-switch").click();
  composerAccount=null;drafts={};$("message-input").value="";
  pictureUI.reset();
  profilePreviewRender=null;
  studioUI.reset();
  careUI.reset();
  notebookUI.reset();
  hubUI.reset();
  scheduledUI.reset();
  workspaceUI.reset();
  eventSource?.close();
  $("loading").hidden = true;
  $("shell").hidden = true;
  $("auth").hidden = false;
  $("auth-error").textContent = "";
  $("auth-password").value = "";
  document.title = "Log In | Voxora";
  const code=location.pathname.match(/^\/invite\/([\w-]+)$/)?.[1];
  if(code){let preview=$("auth-invite-preview");if(!preview){preview=node("div","auth-invite-preview");preview.id="auth-invite-preview";$("auth-form").prepend(preview);}invitePreview(code,preview)();}
}
$("auth-switch").onclick = () => {
  signup = !signup;
  $("auth-title").textContent = signup ? "Create an account" : "Welcome back!";
  $("auth-subtitle").textContent = signup
    ? "Your friends are waiting. Let’s get you set up."
    : "Your people. Your place. Pick up where you left off.";
  $("display-name-label").hidden = !signup;
  $("auth-submit").textContent = signup ? "Continue" : "Log In";
  $("auth-switch-label").textContent = signup
    ? "Already have an account?"
    : "Need an account?";
  $("auth-switch").textContent = signup ? "Log In" : "Register";
  $("auth-password").autocomplete = signup
    ? "new-password"
    : "current-password";
  $("auth-error").textContent = "";
};
$("auth-connection").onclick = connectionDialog;
$("auth-form").onsubmit = async (e) => {
  e.preventDefault();
  $("auth-submit").disabled = true;
  $("auth-error").textContent = "";
  try {
    const data = await api("/auth/" + (signup ? "register" : "login"), "POST", {
      username: $("auth-username").value,
      password: $("auth-password").value,
      displayName: $("register-name").value || $("auth-username").value,
    });
    await authenticated(data);
  } catch (error) {
    $("auth-error").textContent = error.message;
  } finally {
    $("auth-submit").disabled = false;
  }
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeOverlays();
    document.body.classList.remove("sidebar-open");
  }
  if (!state) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    quickSwitcher();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
    e.preventDefault();
    voice.toggleMute();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    voice.toggleDeafen();
  }
});
if (new URLSearchParams(location.search).get("register") === "1")
  $("auth-switch").click();
api("/state")
  .then(authenticated)
  .catch((error) => {
    if (error.status === 401) showAuth();
    else {
      $("loading").replaceChildren(
        node("p", "", error.message),
        button("Retry", () => location.reload(), "primary"),
      );
    }
  });
