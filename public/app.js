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
async function api(route, method = "GET", data) {
  const response = await fetch("/api" + route, {
    method,
    headers:
      data !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) {
    const e = new Error(result.error || "Request failed.");
    e.status = response.status;
    throw e;
  }
  return result;
}
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
let refreshTask = null,
  refreshAgain = false;
const unread = new Map(),
  typing = new Map();
const clientId = sessionStorage.getItem("voxora-client") || crypto.randomUUID();
sessionStorage.setItem("voxora-client", clientId);
const preferences = storage.get("preferences", {
  theme: "dark",
  compact: false,
  fontSize: 15,
  volume: 1,
  inputDevice: "",
});
const collapsed = storage.get("collapsed", {});
let drafts = {};
const notifications = [];
const voice = new Voice({
  api,
  clientId,
  getState: () => state,
  preferences,
  onChange: () => {
    renderUserControls();
    renderVoiceSidebar();
    if (route.kind === "voice") renderCall();
  },
  toast,
});
const me = () => state?.me;
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
function avatar(user, size = "", presence = false) {
  const a = node(
    "span",
    "avatar " + size,
    String(user.displayName || user.name || "V")
      .slice(0, 1)
      .toUpperCase(),
  );
  a.style.background = user.color || "#5865f2";
  if (presence) a.append(node("i", "status-dot " + (user.status || "offline")));
  return a;
}
function applyPreferences() {
  document.body.classList.toggle("light-mode", preferences.theme === "light");
  document.body.classList.toggle("compact", preferences.compact);
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
      $("modal").close();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      save.disabled = false;
    }
  };
  modal([f]);
  setTimeout(() => f.querySelector("input,textarea")?.focus(), 30);
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
  menu.replaceChildren();
  for (const item of items) {
    if (!item) {
      menu.append(node("div", "context-separator"));
      continue;
    }
    const b = button(
      item.label,
      async () => {
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
function emojiPicker(event, callback) {
  event.stopPropagation();
  const picker = $("emoji-picker");
  const search = input("", "Find the perfect emoji");
  const grid = node("div", "emoji-grid");
  const render = () =>
    grid.replaceChildren(
      ...emojiList
        .filter(([, name]) => name.includes(search.value.toLowerCase()))
        .map(([emoji, name]) => {
          const b = button(
            emoji,
            () => {
              picker.hidden = true;
              return callback(emoji);
            },
            "emoji-choice",
          );
          b.title = name;
          return b;
        }),
    );
  search.oninput = render;
  render();
  picker.replaceChildren(
    search,
    grid,
    node("small", "", "EMOJI · Click an emoji to use it"),
  );
  picker.hidden = false;
  const rect = event.currentTarget.getBoundingClientRect();
  picker.style.left =
    Math.max(8, Math.min(rect.right - 330, innerWidth - 338)) + "px";
  picker.style.top = Math.max(8, rect.top - picker.offsetHeight - 8) + "px";
  search.focus();
}
function userMenu(event) {
  context(event, [
    {
      label: "Set Online",
      icon: "check",
      run: () => api("/profile", "PATCH", { status: "online" }),
    },
    {
      label: "Idle",
      icon: "volume",
      run: () => api("/profile", "PATCH", { status: "idle" }),
    },
    {
      label: "Do Not Disturb",
      icon: "bell",
      run: () => api("/profile", "PATCH", { status: "dnd" }),
    },
    {
      label: "Invisible",
      icon: "shield",
      run: () => api("/profile", "PATCH", { status: "invisible" }),
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
  const rail = $("server-rail");
  const home = button(
    "",
    () => navigate({ kind: "friends" }),
    "rail-item" +
      (route.kind === "friends" || route.kind === "dm" ? " active" : ""),
  );
  home.title = "Direct Messages";
  home.setAttribute("aria-label", "Direct Messages");
  home.append(node("span", "voxora-mark", "V"));
  rail.replaceChildren(home, node("div", "rail-separator"));
  for (const s of state.servers) {
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
        (s.channels.some((c) => unread.get(c.id)) ? " unread" : ""),
    );
    b.style.background = active ? s.color : "";
    b.title = s.name;
    b.setAttribute("aria-label", s.name);
    b.oncontextmenu = (e) => serverMenu(e, s);
    rail.append(b);
  }
  rail.append(node("div", "rail-separator"));
  const add = ib("plus", "Add a Server", () => serverDialog(), "");
  add.className = "rail-item add-server";
  rail.append(add, node("div", "rail-spacer"));
  const download = ib("download", "Download the Windows app", () => {
    window.open("https://github.com/Whoops-Lambo/Voxora", "_blank", "noopener");
  });
  download.className = "rail-item add-server";
  rail.append(download);
}
function serverMenu(event, s = selectedServer()) {
  if (!s) return;
  const owner = s.ownerId === me().id;
  const items = [
    { label: "Invite People", icon: "friends", run: () => inviteDialog(s) },
  ];
  if (owner)
    items.push(
      {
        label: "Server Settings",
        icon: "settings",
        run: () => {
          const name = input(s.name);
          name.maxLength = 60;
          formDialog({
            title: "Server Overview",
            fields: [field("SERVER NAME", name)],
            submit: () =>
              api("/servers/" + s.id, "PATCH", { name: name.value }),
          });
        },
      },
      {
        label: "Create Channel",
        icon: "plus",
        run: () => channelDialog(null, s),
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
  if (route.kind === "friends" || route.kind === "dm") {
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
      if (unread.get(c.id))
        b.append(node("span", "badge", String(unread.get(c.id))));
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
    const heading = button("", (e) => serverMenu(e, s), "server-heading");
    heading.append(node("span", "", s.name), icon("chevron", 18));
    top.append(heading);
    const categories = [...new Set(s.channels.map((c) => c.category))];
    for (const category of categories) {
      const key = s.id + category;
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
        document.createTextNode(category.toUpperCase()),
      );
      head.append(collapse);
      if (s.ownerId === me().id)
        head.append(
          ib("plus", "Create Channel", () => channelDialog(null, s, category)),
        );
      list.append(head);
      for (const c of s.channels.filter((c) => c.category === category)) {
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
            (unread.get(c.id) ? " has-unread" : ""),
        );
        b.append(
          icon(c.type === "voice" ? "speaker" : "hash"),
          node("span", "channel-name", c.name),
        );
        if (unread.get(c.id))
          b.append(node("span", "badge", String(unread.get(c.id))));
        b.oncontextmenu = (e) => channelMenu(e, c, s);
        if (s.ownerId === me().id) {
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
        ib("inbox", "Inbox", () => showPanel("inbox"), "optional-action"),
        ib("help", "Help", helpDialog, "optional-action"),
      ]),
    );
    return;
  }
  const c = selectedChannel(),
    user = route.kind === "dm" ? dmPerson(selectedDM()) : null;
  const name = node("div", "header-name", [mobile]);
  if (user) name.append(avatar(user, "", true));
  else name.append(icon(route.kind === "voice" ? "speaker" : "hash", 23));
  name.append(node("strong", "", user?.displayName || c?.name || "channel"));
  if (c?.topic) name.append(node("span", "header-topic", c.topic));
  const actions = node("div", "header-actions");
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
    ib("inbox", "Inbox", () => showPanel("inbox"), "optional-action"),
    ib("help", "Help", helpDialog, "optional-action"),
  );
  bar.append(name, actions);
}
async function navigate(next) {
  if (route.channel && $("message-input"))
    drafts[route.channel] = $("message-input").value;
  closeOverlays();
  document.body.classList.remove("sidebar-open");
  route = next;
  storage.set("route:" + me().id, next);
  reply = null;
  pendingFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
  pendingFiles = [];
  searchQuery = "";
  unread.delete(next.channel);
  messages = [];
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
  $("chat-column").hidden = next.kind === "friends";
  $("call-view").hidden = next.kind !== "voice";
  $("chat-scroll").hidden = next.kind === "voice";
  $("composer-wrap").hidden = next.kind === "voice";
  if (next.kind === "friends") panel = "none";
  else if (next.kind === "voice") panel = "members";
  else if (next.kind === "dm") panel = "none";
  else panel = "members";
  $("message-input").value = drafts[next.channel] || "";
  $("message-input").placeholder =
    next.kind === "dm"
      ? "Message @" + dmPerson(selectedDM()).displayName
      : "Message #" + (selectedChannel()?.name || "general");
  document.title =
    (next.kind === "friends"
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
  if (next.kind === "friends") return renderFriends();
  if (next.kind === "voice") return renderCall();
  renderWelcome();
  renderMessages();
  await loadMessages();
}
async function loadMessages() {
  const id = ++loadId;
  const channel = route.channel;
  const data = await api("/messages?channel=" + encodeURIComponent(channel));
  if (id !== loadId || route.channel !== channel) return;
  hasOlder = data.length === 200;
  messages = [
    ...new Map([...data, ...messages].map((m) => [m.id, m])).values(),
  ].sort((a, b) => a.time - b.time);
  renderMessages();
  scrollBottom();
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
  if (isOwner())
    actions.append(
      button(
        "Edit Channel",
        () => channelDialog(c, selectedServer()),
        "",
        "edit",
      ),
    );
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
function formatted(text) {
  const fragment = document.createDocumentFragment();
  const regex =
    /```[\s\S]*?```|`[^`\n]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\|\|[^|]+\|\||\*[^*\n]+\*|https?:\/\/[^\s<>]+|@[a-zA-Z0-9_.]+/g;
  let start = 0;
  for (const match of text.matchAll(regex)) {
    fragment.append(document.createTextNode(text.slice(start, match.index)));
    const part = match[0];
    let e;
    if (part.startsWith("```")) {
      e = node("pre", "", part.slice(3, -3).replace(/^\w*\n/, ""));
    } else if (part.startsWith("`")) e = node("code", "", part.slice(1, -1));
    else if (part.startsWith("**")) e = node("strong", "", part.slice(2, -2));
    else if (part.startsWith("__")) e = node("u", "", part.slice(2, -2));
    else if (part.startsWith("~~")) e = node("s", "", part.slice(2, -2));
    else if (part.startsWith("||")) {
      e = node("span", "spoiler", part.slice(2, -2));
      e.tabIndex = 0;
      e.role = "button";
      e.setAttribute("aria-label", "Reveal spoiler");
      e.onclick = () => e.classList.toggle("revealed");
      e.onkeydown = (event) => {
        if (event.key === "Enter") e.click();
      };
    } else if (part.startsWith("*")) e = node("em", "", part.slice(1, -1));
    else if (part.startsWith("http")) {
      e = node("a", "", part);
      e.href = part;
      e.target = "_blank";
      e.rel = "noopener noreferrer";
    } else {
      e = node("span", "mention", part);
      const user = state.users.find((u) => u.username === part.slice(1));
      if (user) e.onclick = () => profile(user.id);
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
  e.append(formatted(m.text));
  if (m.editedAt) e.append(node("span", "edited", "(edited)"));
  return e;
}
function messageMenu(event, m) {
  const own = m.authorId === me().id,
    owner = isOwner();
  const items = [
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
  ];
  if (own || owner)
    items.push({
      label: m.pinned ? "Unpin Message" : "Pin Message",
      icon: "pin",
      run: () => api("/messages/" + m.id + "/pin", "POST", {}),
    });
  if (own)
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
          "Are you sure you want to delete this message? This cannot be undone.",
          () => api("/messages/" + m.id, "DELETE"),
        ),
    });
  context(event, items);
}
function renderMessages() {
  const list = $("message-list");
  list.replaceChildren();
  if (hasOlder)
    list.append(button("Load earlier messages", loadEarlier, "history-load"));
  let previous = null;
  for (const m of messages) {
    const date = dateLabel(m.time);
    if (!previous || dateLabel(previous.time) !== date)
      list.append(node("div", "message-date", date));
    const grouped =
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
        (m.text.includes("@" + me().username) ? " mentioned" : ""),
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
      const time = node(
        "time",
        "",
        dateLabel(m.time) + " at " + timeLabel(m.time),
      );
      time.dateTime = new Date(m.time).toISOString();
      meta.append(author);
      if (!m.authorId) meta.append(node("span", "bot-tag", "APP"));
      meta.append(time);
      if (m.pinned) {
        const p = icon("pin", 12);
        p.title = "Pinned message";
        meta.append(p);
      }
      body.append(meta);
    }
    body.append(messageText(m));
    for (const file of m.attachments || []) {
      if (
        ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          file.mime,
        )
      ) {
        const img = node("img", "attachment-image");
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
          node("span", "", r.emoji),
          document.createTextNode(String(r.userIds.length)),
        );
        reactions.append(b);
      }
      body.append(reactions);
    }
    const actions = node("div", "message-actions");
    const reactButton = ib("emoji", "Add Reaction", (e) =>
      emojiPicker(e, (emoji) => react(m, emoji)),
    );
    reactButton.dataset.emoji = "true";
    actions.append(
      reactButton,
      ib("reply", "Reply", () => setReply(m)),
    );
    if (m.authorId === me().id)
      actions.append(ib("edit", "Edit Message", () => editMessage(m)));
    actions.append(ib("more", "More", (e) => messageMenu(e, m)));
    row.append(body, actions);
    list.append(row);
    previous = m;
  }
}
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
  requestAnimationFrame(
    () => ($("chat-scroll").scrollTop = $("chat-scroll").scrollHeight),
  );
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
  value.maxLength = 2000;
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
    if (file.size > 8 * 1048576) {
      toast(file.name + " exceeds the 8 MB limit.", true);
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
$("composer-plus").append(icon("plus", 18));
$("composer-plus").onclick = () => $("file-input").click();
$("composer-emoji").append(icon("emoji", 24));
$("composer-emoji").dataset.emoji = "true";
$("composer-emoji").onclick = (e) =>
  emojiPicker(e, (emoji) => {
    $("message-input").setRangeText(
      emoji,
      $("message-input").selectionStart,
      $("message-input").selectionEnd,
      "end",
    );
    $("message-input").focus();
  });
$("send-message").append(icon("send", 21));
$("composer").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("message-input").value.trim();
  if (
    (!text && !pendingFiles.length) ||
    !["channel", "dm"].includes(route.kind)
  )
    return;
  const channel = route.channel;
  const currentFiles = [...pendingFiles];
  $("send-message").disabled = true;
  try {
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
    if (route.channel === channel) {
      if (!messages.some((m) => m.id === result.id)) messages.push(result);
      $("message-input").value = "";
      $("message-input").style.height = "";
      drafts[channel] = "";
      reply = null;
      pendingFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      pendingFiles = [];
      renderMessages();
      renderAttachments();
      renderReply();
      scrollBottom();
    }
    storage.set("drafts:" + me().id, drafts);
  } catch (error) {
    toast(error.message, true);
  } finally {
    $("send-message").disabled = false;
    $("message-input").focus();
  }
};
let lastTyping = 0;
$("message-input").oninput = () => {
  const e = $("message-input");
  e.style.height = "auto";
  e.style.height = Math.min(e.scrollHeight, 180) + "px";
  drafts[route.channel] = e.value;
  storage.set("drafts:" + me().id, drafts);
  if (e.value && Date.now() - lastTyping > 3000) {
    lastTyping = Date.now();
    api("/typing", "POST", { channel: route.channel }).catch(() => {});
  }
};
$("message-input").onkeydown = (e) => {
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
  const name = node("strong", "", user.displayName);
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
  panelElement.className =
    panel === "none" ? "hidden" : panel === "members" ? "" : "wide";
  panelElement.replaceChildren();
  if (panel === "none" || route.kind === "friends") return;
  if (panel === "members") {
    const s = selectedServer();
    if (!s) return;
    const members = s.members.map(person),
      online = members.filter((u) => u.status !== "offline"),
      offline = members.filter((u) => u.status === "offline");
    for (const [label, list] of [
      ["ONLINE", online],
      ["OFFLINE", offline],
    ]) {
      if (!list.length) continue;
      panelElement.append(
        node("div", "member-heading", label + " — " + list.length),
      );
      for (const u of list) panelElement.append(memberRow(u, s));
    }
    return;
  }
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
    if (!notifications.length)
      results.append(
        node(
          "p",
          "muted small",
          "You’re all caught up. Mentions and new direct messages will appear here.",
        ),
      );
    for (const m of notifications.slice().reverse())
      results.append(resultCard(m));
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
  card.onclick = run(async () => {
    if (route.channel !== m.channel) {
      const s = state.servers.find((s) =>
        s.channels.some((c) => c.id === m.channel),
      );
      await navigate(
        s
          ? { kind: "channel", server: s.id, channel: m.channel }
          : { kind: "dm", channel: m.channel },
      );
    }
    jumpTo(m.id);
  });
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
function profile(userId) {
  const user = person(userId);
  const banner = node("div", "profile-banner");
  banner.style.background = user.color;
  const card = node("div", "profile-card-body", [
    node("h2", "", user.displayName),
    node("p", "username", user.username),
  ]);
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
    card.append(
      node("div", "profile-divider"),
      node("h3", "", "ROLES"),
      node(
        "span",
        "role-pill",
        s.ownerId === userId ? "Server Owner" : "Member",
      ),
    );
  }
  const actions = node("div", "profile-buttons");
  if (userId === me().id)
    actions.append(
      button("Edit Profile", () => settings("Profiles"), "primary"),
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
  modal([banner, avatar(user, "xl", true), card], "profile-popup");
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
    ]),
  ]);
}
function joinDialog(code = "") {
  const value = input(code, "Enter an invite code or link");
  value.required = true;
  formDialog({
    title: "Join a Server",
    description: "Enter an invite below to join an existing server.",
    fields: [field("INVITE LINK", value)],
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
    },
  });
}
function inviteDialog(s) {
  if (!s) return;
  const link = location.origin + "/invite/" + s.invite;
  const value = input(link);
  value.readOnly = true;
  value.setAttribute("aria-label", "Invite link");
  const box = node("div", "invite-box", [
    value,
    button("Copy", () => copy(link), "primary"),
  ]);
  modal([
    node("h2", "", `Invite friends to ${s.name}`),
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
      "This invite stays valid while the server exists.",
    ),
  ]);
}
function channelDialog(c, s = selectedServer(), category) {
  const name = input(c?.name || "", "new-channel");
  name.required = true;
  name.maxLength = 50;
  const topic = input(
    c?.topic || "",
    "Let everyone know what this channel is for",
  );
  topic.maxLength = 250;
  const cat = input(c?.category || category || "TEXT CHANNELS");
  cat.maxLength = 40;
  let type = c?.type || "text";
  const choices = node("div");
  if (!c)
    for (const value of ["text", "voice"]) {
      const radio = input("", "", "radio");
      radio.name = "channel-type";
      radio.value = value;
      radio.checked = value === type;
      const row = node(
        "label",
        "choice-row" + (radio.checked ? " selected" : ""),
        [
          icon(value === "text" ? "hash" : "speaker", 25),
          node("span", "", [
            node("strong", "", value === "text" ? "Text" : "Voice"),
            node(
              "small",
              "",
              value === "text"
                ? "Send messages, images, and files."
                : "Hang out together with voice and video.",
            ),
          ]),
          radio,
        ],
      );
      radio.onchange = () => {
        type = value;
        cat.value = type === "voice" ? "VOICE CHANNELS" : "TEXT CHANNELS";
        choices
          .querySelectorAll(".choice-row")
          .forEach((r) => r.classList.toggle("selected", r.contains(radio)));
      };
      choices.append(row);
    }
  formDialog({
    title: c ? "Edit #" + c.name : "Create Channel",
    fields: [
      ...(!c ? [node("div", "section-label", "CHANNEL TYPE"), choices] : []),
      field("CHANNEL NAME", name),
      field("CATEGORY", cat),
      field("CHANNEL TOPIC", topic),
    ],
    submitLabel: c ? "Save Changes" : "Create Channel",
    submit: async () => {
      if (c)
        await api("/channels/" + c.id, "PATCH", {
          name: name.value,
          category: cat.value,
          topic: topic.value,
        });
      else {
        const result = await api("/servers/" + s.id + "/channels", "POST", {
          name: name.value,
          category: cat.value,
          topic: topic.value,
          type,
        });
        await refreshState();
        await navigate({
          kind: type === "voice" ? "voice" : "channel",
          server: s.id,
          channel: result.id,
        });
      }
      await refreshState();
      header();
      renderWelcome();
    },
  });
}
function channelMenu(event, c, s) {
  const items = [
    { label: "Copy Channel Name", icon: "copy", run: () => copy(c.name) },
  ];
  if (s.ownerId === me().id)
    items.push(
      {
        label: "Edit Channel",
        icon: "settings",
        run: () => channelDialog(c, s),
      },
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
          symbol: c.type === "voice" ? "speaker" : "hash",
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
        button("Join Voice", () => voice.join(channel), "primary"),
      ]),
    );
    return;
  }
  const grid = node("div", "call-grid");
  const participants = [
    { clientId, userId: me().id },
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
    const stream =
      p.clientId === clientId
        ? voice.videoStream
        : voice.connections.get(p.clientId)?.remoteStream;
    if (
      stream?.getVideoTracks().some((t) => t.readyState === "live" && !t.muted)
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
        ...(p.clientId === clientId && voice.muted ? [icon("micOff", 13)] : []),
      ]),
    );
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
      ib(
        voice.muted ? "micOff" : "mic",
        voice.muted ? "Unmute" : "Mute",
        () => voice.toggleMute(),
        voice.muted ? "active" : "",
      ),
      ib("disconnect", "Disconnect", () => voice.leave(), "hangup"),
    ]),
  );
}
function settings(tab = "My Account") {
  const tabs = [
    "My Account",
    "Profiles",
    "Privacy & Safety",
    "Voice & Video",
    "Appearance",
    "Server Connection",
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
  modal([nav, content], "settings-dialog");
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
    bio.maxLength = 190;
    const status = input(me().customStatus || "", "What’s happening?");
    status.maxLength = 80;
    const color = input(me().color, "", "color");
    color.className = "color-input";
    const error = node("div", "form-error");
    const save = node("button", "primary", "Save Changes");
    save.type = "submit";
    f.append(
      field("DISPLAY NAME", display),
      field("ABOUT ME", bio),
      field("CUSTOM STATUS", status),
      field("AVATAR COLOR", color),
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
    content.append(node("h3", "", "THEME"));
    const choices = node("div", "theme-choices");
    for (const theme of ["dark", "light"])
      choices.append(
        button(
          theme === "dark" ? "Dark" : "Light",
          () => {
            preferences.theme = theme;
            applyPreferences();
            settings(tab);
          },
          "theme-choice " +
            theme +
            (preferences.theme === theme ? " active" : ""),
        ),
      );
    const compact = input("", "", "checkbox");
    compact.checked = preferences.compact;
    compact.onchange = () => {
      preferences.compact = compact.checked;
      applyPreferences();
    };
    const size = input(String(preferences.fontSize), "", "range");
    size.min = 13;
    size.max = 20;
    size.oninput = () => {
      preferences.fontSize = Number(size.value);
      applyPreferences();
    };
    content.append(
      choices,
      node("div", "settings-row", [
        node("span", "", "Compact message display"),
        compact,
      ]),
      node("div", "settings-row", [node("span", "", "Chat font size"), size]),
    );
  }
  if (tab === "Voice & Video") {
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
      if (voice.channelId) await voice.changeMicrophone();
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
      button("Change Server", connectionDialog, "primary"),
    );
  }
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
function refreshState() {
  refreshAgain = true;
  if (refreshTask) return refreshTask;
  refreshTask = (async () => {
    try {
      do {
        refreshAgain = false;
        const next = await api("/state");
        if (!state) return;
        state = next;
        renderRail();
        renderSidebar();
        renderPanel();
        if (route.kind === "friends" && friendTab !== "Add Friend")
          renderFriends();
        if (route.kind === "voice") renderCall();
        if (["channel", "voice"].includes(route.kind) && !selectedChannel())
          await navigate({ kind: "friends" });
      } while (refreshAgain);
    } finally {
      refreshTask = null;
    }
  })();
  return refreshTask;
}
function connectEvents() {
  eventSource?.close();
  eventSource = new EventSource("/api/events?client=" + clientId);
  eventSource.onmessage = (event) => {
    handleEvent(JSON.parse(event.data)).catch((error) =>
      toast(error.message, true),
    );
  };
  eventSource.onerror = () => {
    if (voice.channelId) {
      voice.leave(false).catch(() => {});
      toast("Connection lost. Voice has been disconnected.", true);
    }
  };
}
async function handleEvent(event) {
  if (!state) return;
  if (event.type === "refresh" || event.type === "connected") {
    await refreshState();
    return;
  }
  if (event.type === "voice-peers" || event.type === "signal") {
    await voice.handle(event);
    return;
  }
  if (event.type === "typing") {
    typing.set(event.user.id, { ...event, time: Date.now() });
    updateTyping();
    return;
  }
  if (event.type === "message" || event.type === "message-update") {
    const m = event.message;
    if (m.channel === route.channel) {
      const nearBottom =
        $("chat-scroll").scrollHeight -
          $("chat-scroll").scrollTop -
          $("chat-scroll").clientHeight <
        140;
      const index = messages.findIndex((x) => x.id === m.id);
      if (index < 0) messages.push(m);
      else messages[index] = m;
      renderMessages();
      typing.delete(m.authorId);
      updateTyping();
      if (nearBottom) scrollBottom();
    } else if (event.type === "message" && m.authorId !== me().id) {
      unread.set(m.channel, (unread.get(m.channel) || 0) + 1);
      if (m.channel.startsWith("dm-") || m.text.includes("@" + me().username)) {
        notifications.push(m);
        if (notifications.length > 100) notifications.shift();
      }
      renderRail();
      renderSidebar();
    }
    if (panel === "pins") renderPanel();
  } else if (
    event.type === "message-delete" &&
    event.channel === route.channel
  ) {
    messages = messages.filter((m) => m.id !== event.id);
    renderMessages();
  }
}
async function authenticated(data) {
  state = data;
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
  const invite = location.pathname.match(/^\/invite\/([\w-]+)$/)?.[1];
  if (invite) joinDialog(invite);
}
function showAuth() {
  eventSource?.close();
  $("loading").hidden = true;
  $("shell").hidden = true;
  $("auth").hidden = false;
  $("auth-error").textContent = "";
  $("auth-password").value = "";
  document.title = "Log In | Voxora";
}
$("auth-switch").onclick = () => {
  signup = !signup;
  $("auth-title").textContent = signup ? "Create an account" : "Welcome back!";
  $("auth-subtitle").textContent = signup
    ? "Your friends are waiting. Let’s get you set up."
    : "We're so excited to see you again!";
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
