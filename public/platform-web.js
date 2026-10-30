import { createBotUI } from "./bot-ui.js";
const $ = (id) => document.getElementById(id);
const node = (tag, cls = "", content) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (content !== undefined)
    e.append(...(Array.isArray(content) ? content : [content]));
  return e;
};
const safe = (fn) => async (event) => {
  try {
    return await fn(event);
  } catch (e) {
    toast(e.message, true);
  }
};
function button(label, fn, cls = "secondary") {
  const b = node("button", cls, label);
  b.type = "button";
  b.onclick = safe(fn);
  return b;
}
function input(value = "", placeholder = "", type = "text") {
  const e = node("input");
  e.type = type;
  e.value = value;
  e.placeholder = placeholder;
  return e;
}
function field(label, control) {
  control.setAttribute("aria-label", label);
  return node("label", "", [label, control]);
}
function toast(message, error = false) {
  const item = node("div", "toast" + (error ? " error" : ""), message);
  $("toast-stack").append(item);
  setTimeout(() => item.remove(), 6000);
}
function modal(children) {
  $("modal-content").replaceChildren(...children);
  if (!$("modal").open) $("modal").showModal();
}
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
function formDialog({
  title,
  description,
  fields,
  submit,
  submitLabel = "Save Changes",
  danger = false,
}) {
  const form = node("form"),
    error = node("div", "form-error"),
    save = node("button", danger ? "danger-button" : "primary", submitLabel);
  save.type = "submit";
  form.append(node("h2", "", title));
  if (description) form.append(node("p", "", description));
  form.append(
    ...fields,
    error,
    node("div", "modal-footer", [
      button("Cancel", () => $("modal").close()),
      save,
    ]),
  );
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await submit();
      if (form.isConnected) $("modal").close();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      save.disabled = false;
    }
  };
  modal([form]);
  setTimeout(() => form.querySelector("input,textarea,select")?.focus(), 30);
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
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied.");
  } catch {
    const value = input(text);
    value.readOnly = true;
    modal([node("h2", "", "Copy this value"), value]);
    value.select();
  }
}
async function api(path, method = "GET", data) {
  const r = await fetch("/api" + path, {
    method,
    headers:
      data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const value = await r.json();
  if (!r.ok) {
    const e = Error(value.error || "Request failed.");
    e.status = r.status;
    throw e;
  }
  return value;
}
let state = null,
  adminTab = "Overview";
async function refreshState() {
  state = await api("/state");
  header();
}
function link(label, href, cls = "secondary") {
  const a = node("a", cls, label);
  a.href = href;
  return a;
}
function header() {
  const box = $("account-nav");
  box.replaceChildren();
  if (state) {
    if (state.platform?.permissions.length)
      box.append(link("Admin", "/admin", ""));
    box.append(link(state.me.displayName, "/app", ""));
  } else box.append(link("Sign In", "/app", ""));
}
function portal(title, description, eyebrow) {
  const wrapper = node("section", "portal"),
    content = node("div");
  wrapper.append(
    node("div", "portal-heading", [
      node("div", "", [
        node("p", "eyebrow", eyebrow),
        node("h1", "", title),
        node("p", "", description),
      ]),
    ]),
    content,
  );
  $("page").replaceChildren(wrapper);
  document.title = title + " | Voxora";
  return content;
}
function signIn(target, next) {
  target.append(
    node("div", "auth-prompt", [
      node("h2", "", "Make it yours."),
      node("p", "", "Sign in to your Voxora account to continue."),
      node("div", "hero-actions", [
        link("Sign In", "/app?next=" + next, "primary"),
        link("Create Account", "/app?register=1&next=" + next),
      ]),
    ]),
  );
}
const bots = createBotUI({
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
});
function userRoles(u) {
  const line = node("div");
  for (const role of u.staffRoles) {
    const badge = node("span", "staff-pill", role.name);
    badge.style.color = role.color;
    line.append(badge);
  }
  return line;
}
async function assignments(u) {
  const data = await api("/platform/staff-roles"),
    boxes = [];
  const fields = data.roles.map((role) => {
    const check = input("", "", "checkbox");
    check.checked = u.staffRoleIds.includes(role.id);
    check.setAttribute("aria-label", role.name);
    boxes.push({ role, check });
    return node("label", "permission-row", [
      node("span", "", role.name),
      check,
    ]);
  });
  if (!fields.length) {
    toast("Create a staff role first.", true);
    return;
  }
  formDialog({
    title: "Voxora Staff Roles — " + u.username,
    description:
      "Platform staff permissions are separate from server roles. Only the platform owner can assign them.",
    fields,
    submitLabel: "Save Staff Roles",
    submit: async () => {
      await api("/platform/users/" + u.id, "PATCH", {
        staffRoleIds: boxes
          .filter((v) => v.check.checked)
          .map((v) => v.role.id),
      });
      await renderAdmin();
    },
  });
}
function suspend(u) {
  const duration = node("select"),
    why = input("", "Why is this account being moderated?");
  why.required = true;
  why.maxLength = 500;
  for (const [seconds, label] of [
    [3600, "1 hour"],
    [86400, "1 day"],
    [604800, "7 days"],
    [-1, "Until restored"],
  ])
    duration.append(new Option(label, String(seconds)));
  formDialog({
    title: (u.suspended ? "Restore " : "Suspend ") + u.username,
    description: u.suspended
      ? "Restore this user’s access to Voxora."
      : "End this account’s sessions and block sign-in and its bot applications for the selected duration.",
    fields: [
      ...(u.suspended ? [] : [field("SUSPENSION DURATION", duration)]),
      field("REASON", why),
    ],
    submitLabel: u.suspended ? "Restore Account" : "Suspend Account",
    danger: !u.suspended,
    submit: async () => {
      await api("/platform/users/" + u.id, "PATCH", {
        suspendFor: u.suspended ? 0 : Number(duration.value),
        reason: why.value,
      });
      await renderAdmin();
    },
  });
}
function staffRoleForm(role, definitions) {
  const name = input(role?.name || "", "Voxora Moderator"),
    color = input(role?.color || "#5865f2", "", "color"),
    boxes = [];
  name.required = true;
  name.maxLength = 40;
  const fields = [
    field("STAFF ROLE NAME", name),
    field("ROLE COLOR", color),
    ...definitions.map((p) => {
      const check = input("", "", "checkbox");
      check.checked = role?.permissions.includes(p.id) || false;
      check.setAttribute("aria-label", p.name);
      boxes.push({ p, check });
      return node("label", "permission-row", [
        node("span", "", [
          node("strong", "", p.name),
          node("small", "", p.description),
        ]),
        check,
      ]);
    }),
  ];
  formDialog({
    title: role ? "Edit Voxora Staff Role" : "Create Voxora Staff Role",
    fields,
    submitLabel: "Save Staff Role",
    submit: async () => {
      await api(
        "/platform/staff-roles" + (role ? "/" + role.id : ""),
        role ? "PATCH" : "POST",
        {
          name: name.value,
          color: color.value,
          permissions: boxes.filter((b) => b.check.checked).map((b) => b.p.id),
        },
      );
      await renderAdmin();
    },
  });
}
function deleteServer(s) {
  const confirmation = input("", "Type " + s.name),
    reason = input("", "Moderation reason");
  confirmation.required = true;
  reason.required = true;
  reason.maxLength = 500;
  formDialog({
    title: "Remove " + s.name,
    description:
      "This permanently removes the server, its channels, and its messages. Type the server name to confirm.",
    fields: [
      field("CONFIRM SERVER NAME", confirmation),
      field("REASON", reason),
    ],
    submitLabel: "Remove Server",
    danger: true,
    submit: async () => {
      await api("/platform/servers/" + s.id, "DELETE", {
        confirmation: confirmation.value,
        reason: reason.value,
      });
      await renderAdmin();
    },
  });
}
function moderateApp(a) {
  const reason = input("", "Moderation reason");
  reason.required = true;
  reason.maxLength = 500;
  formDialog({
    title: (a.disabled ? "Restore " : "Disable ") + a.name,
    description:
      "Disabling stops its bot API, gateway connections, and installed commands. Existing messages and installations are preserved.",
    fields: [field("REASON", reason)],
    submitLabel: a.disabled ? "Restore Application" : "Disable Application",
    danger: !a.disabled,
    submit: async () => {
      await api("/platform/applications/" + a.id, "PATCH", {
        disabled: !a.disabled,
        reason: reason.value,
      });
      await renderAdmin();
    },
  });
}
function record(title, lines, actions = [], badges) {
  const item = node("article", "admin-record", [
    node("h3", "", title),
    ...lines.map((line) => node("p", "", line)),
  ]);
  if (badges) item.append(badges);
  if (actions.length) item.append(node("div", "bot-actions", actions));
  return item;
}
async function adminList(content, kind, overview) {
  const search = input("", "Search " + kind),
    form = node("form", "admin-search"),
    list = node("div");
  search.setAttribute("aria-label", "Search " + kind);
  const submit = node("button", "primary", "Search");
  submit.type = "submit";
  form.append(search, submit);
  content.append(form, list);
  let offset = 0,
    more,
    loadVersion = 0;
  const renderItem = (v) => {
    if (kind === "users") {
      const actions = [];
      if (overview.owner && !v.owner)
        actions.push(button("Assign Staff Roles", () => assignments(v)));
      if (
        !v.owner &&
        v.id !== state.me.id &&
        (overview.owner || !v.staffRoles.length)
      )
        actions.push(
          button(
            v.suspended ? "Restore Account" : "Suspend Account",
            () => suspend(v),
            v.suspended ? "secondary" : "danger",
          ),
        );
      return record(
        v.displayName + " · @" + v.username,
        [
          v.suspended ? "Suspended · " + v.suspensionReason : "Active account",
          "Joined " + new Date(v.createdAt).toLocaleDateString(),
        ],
        actions,
        userRoles(v),
      );
    }
    if (kind === "servers")
      return record(
        v.name,
        [
          "Owner: @" + v.owner,
          v.memberCount + " members · " + v.channelCount + " channels",
        ],
        [button("Remove Server", () => deleteServer(v), "danger")],
      );
    if (kind === "applications")
      return record(
        v.name + (v.builtin ? " · Built-in" : ""),
        [
          "Developer: " + v.owner,
          v.installedServers +
            " installations · " +
            (v.disabled ? "Disabled: " + v.reason : "Enabled"),
        ],
        v.builtin && !overview.owner
          ? []
          : [
              button(
                v.disabled ? "Restore Application" : "Disable Application",
                () => moderateApp(v),
                v.disabled ? "secondary" : "danger",
              ),
            ],
      );
    return record(v.action, [
      v.actorName + " · " + v.target,
      new Date(v.time).toLocaleString(),
      v.reason || "No reason supplied",
    ]);
  };
  async function load(reset = false) {
    const version = ++loadVersion;
    const data = await api(
      "/platform/" +
        kind +
        "?" +
        new URLSearchParams({
          q: search.value,
          offset: String(reset ? 0 : offset),
        }),
    );
    if (!content.isConnected || version !== loadVersion) return;
    if (reset) {
      offset = 0;
      list.replaceChildren();
    }
    more?.remove();
    if (!data.items.length && !offset)
      list.append(node("p", "muted", "No matching records."));
    for (const item of data.items) list.append(renderItem(item));
    offset += data.items.length;
    if (data.hasMore) {
      more = button("Load More", () => load(), "secondary");
      list.append(more);
    }
  }
  form.onsubmit = safe(async (e) => {
    e.preventDefault();
    await load(true);
  });
  await load(true);
}
async function renderAdmin() {
  const target = portal(
    "Platform Admin",
    "Manage this Voxora installation, moderate accounts, and assign platform staff permissions.",
    "VOXORA STAFF",
  );
  if (!state) {
    signIn(target, "admin");
    return;
  }
  let overview;
  try {
    overview = await api("/platform/overview");
  } catch (e) {
    target.append(
      node("div", "auth-prompt", [
        node("h2", "", "Staff access required"),
        node("p", "", e.message),
        link("Open Voxora", "/app", "primary"),
      ]),
    );
    return;
  }
  const p = overview.permissions,
    tabs = ["Overview"];
  if (overview.owner || p.includes("manageUsers")) tabs.push("Accounts");
  if (p.includes("manageServers")) tabs.push("Servers");
  if (p.includes("manageApplications")) tabs.push("Bot Applications");
  if (overview.owner) tabs.push("Staff Roles");
  if (p.includes("viewAudit")) tabs.push("Audit Log");
  if (!tabs.includes(adminTab)) adminTab = "Overview";
  const nav = node("nav", "admin-nav", [
      node("p", "", overview.owner ? "PLATFORM OWNER" : "PLATFORM STAFF"),
    ]),
    content = node("div", "admin-content");
  for (const tab of tabs)
    nav.append(
      button(
        tab,
        () => {
          adminTab = tab;
          return renderAdmin();
        },
        tab === adminTab ? "active" : "",
      ),
    );
  target.append(node("div", "admin-layout", [nav, content]));
  content.append(node("h2", "", adminTab));
  if (adminTab === "Overview") {
    const stats = node("div", "admin-stats");
    for (const [key, label] of [
      ["users", "Human accounts"],
      ["servers", "Servers"],
      ["applications", "Custom bot applications"],
      ["suspended", "Suspended accounts"],
    ])
      stats.append(
        node("div", "admin-stat", [
          node("strong", "", String(overview.stats[key])),
          node("small", "", label),
        ]),
      );
    content.append(
      stats,
      node(
        "p",
        "bot-help",
        "Platform roles grant moderation tools across this installation. They do not grant access to private conversations or bypass server channel permissions. The first registered human account owns the platform.",
      ),
    );
  } else if (adminTab === "Staff Roles") {
    const data = await api("/platform/staff-roles");
    if (!content.isConnected) return;
    content.append(
      button(
        "Create Staff Role",
        () => staffRoleForm(null, data.permissions),
        "primary",
      ),
    );
    if (!data.roles.length)
      content.append(
        node(
          "p",
          "bot-empty",
          "Create a staff role, choose its permissions, then assign it from Accounts.",
        ),
      );
    for (const r of data.roles)
      content.append(
        record(
          r.name,
          [
            r.permissions
              .map((id) => data.permissions.find((p) => p.id === id)?.name)
              .join(" · ") || "No admin tools enabled",
          ],
          [
            button("Edit Staff Role", () => staffRoleForm(r, data.permissions)),
            button(
              "Delete Staff Role",
              () =>
                confirmDialog(
                  "Delete " + r.name,
                  "Remove this staff role and all its assignments?",
                  async () => {
                    await api("/platform/staff-roles/" + r.id, "DELETE");
                    await renderAdmin();
                  },
                ),
              "danger",
            ),
          ],
        ),
      );
  } else
    await adminList(
      content,
      {
        Accounts: "users",
        Servers: "servers",
        "Bot Applications": "applications",
        "Audit Log": "audit",
      }[adminTab],
      overview,
    );
}
function docs() {
  const target = portal(
    "Build a Voxora bot",
    "Start with the SDK, register commands, and connect your bot to the same backend as your community.",
    "DEVELOPER DOCUMENTATION",
  );
  target.className = "docs-content";
  target.append(
    link(
      "Download Bot Starter",
      "/downloads/voxora-bot-starter.zip",
      "primary",
    ),
    node("h2", "", "From application to first command"),
  );
  const list = node("ol");
  for (const text of [
    "Open Developer Portal, create an application, and copy its one-time bot token.",
    "Install the bot in a server where you have Manage Server. Its roles and channel restrictions control access.",
    "Download and extract the starter, then install Node.js 22 or later. On Windows, double-click start-bot.bat in the extracted folder; the first launch opens .env for your server URL and token.",
    "Upgrade to Voxora 2.5 or later. Save .env and launch start-bot.bat again, or run node start-bot.mjs from a terminal. The community template registers 25 moderation, economy, and utility commands; use /bothelp. Keep that process running to keep your bot online.",
  ])
    list.append(node("li", "", text));
  target.append(
    list,
    node("h3", "", "Run the starter"),
    node(
      "pre",
      "",
      "# Windows: double-click start-bot.bat.\n# Any terminal: run this, edit the generated .env, then run again.\nnode start-bot.mjs",
    ),
    node("h3", "", "Use the SDK"),
    node(
      "pre",
      "",
      'import { VoxoraBot } from "./sdk/voxora.mjs";\nconst bot = new VoxoraBot({\n  url: process.env.VOXORA_URL,\n  token: process.env.VOXORA_BOT_TOKEN,\n});\nawait bot.registerCommands([{ name: "hello", description: "Say hello" }]);\nbot.on("interaction", async (command) => {\n  await command.respond("Hello, " + command.user.displayName + "!");\n});\nawait bot.connect();',
    ),
    node("h2", "", "REST API"),
    node(
      "p",
      "",
      "Send Authorization: Bot <your token> to bot endpoints. HTTPS is required outside localhost. Tokens are not accepted in URLs and are never returned by listing endpoints.",
    ),
  );
  const table = node("table"),
    head = node("tr", "", [
      node("th", "", "Method & route"),
      node("th", "", "Purpose"),
    ]);
  table.append(head);
  for (const [route, purpose] of [
    ["GET /api/bot/me", "Current bot and accessible server/channel metadata"],
    [
      "GET /api/bot/events",
      "SSE gateway: READY, STATE_UPDATE, MESSAGE_CREATE/UPDATE/DELETE, INTERACTION_CREATE",
    ],
    ["PUT /api/bot/commands", "Register up to 25 slash commands"],
    ["GET /api/bot/interactions", "Recover pending command invocations"],
    ["GET /api/bot/interactions/:id/context", "Get current invoker permissions and server/member context (2.5+)"],
    ["POST /api/bot/interactions/:id/moderation", "Moderate with both user and bot permissions, hierarchy and action receipts (2.5+)"],
    [
      "POST /api/bot/interactions/:id/respond",
      "Respond once within 15 minutes",
    ],
    [
      "GET/POST /api/bot/channels/:id/messages",
      "Read accessible history or send text/polls",
    ],
    [
      "PATCH/DELETE /api/bot/messages/:id",
      "Edit own messages or delete with applicable permissions",
    ],
    ["POST /api/bot/messages/:id/reactions", "Toggle a reaction"],
    [
      "POST /api/bot/messages/:id/poll-close",
      "End a poll with applicable permissions",
    ],
  ])
    table.append(
      node("tr", "", [node("td", "", route), node("td", "", purpose)]),
    );
  target.append(
    table,
    node("h2", "", "Permissions and lifecycle"),
    node(
      "p",
      "",
      "Manage Server is required to install and configure bots. Server roles and channel overrides still apply; an installation’s channel list is an additional restriction. Pausing, uninstalling, kicking, banning, token revocation, application suspension, or owner suspension stops the corresponding access. Rotation closes old gateway connections immediately.",
    ),
    node(
      "p",
      "",
      "The gateway does not replay message events. Backfill with message history and deduplicate by message ID after reconnecting. The SDK recovers pending slash commands on reconnect; command responses are accepted once. Bot REST traffic is limited to 300 requests per minute per application, with a further 60-message limit on direct sends.",
    ),
    node(
      "p",
      "",
      "Voxora bots use an independent API. Discord tokens, discord.js, Discord OAuth, bot DMs, bot voice connections, ephemeral replies, and running third-party code inside the Voxora server are not supported.",
    ),
  );
}
async function start() {
  try {
    await refreshState();
  } catch {
    state = null;
    header();
  }
  if (location.pathname === "/developers/docs") docs();
  else if (location.pathname === "/developers") {
    const target = portal(
      "Developer Portal",
      "Build, manage, and install your own Voxora bot applications.",
      "YOUR APPS. YOUR IDEAS.",
    );
    if (state) await bots.developer(target);
    else signIn(target, "developers");
  } else if (location.pathname === "/admin") await renderAdmin();
  if (location.pathname === "/") {
    try {
      const info = await api("/info");
      for (const a of document.querySelectorAll("[data-windows-download]"))
        a.href =
          "https://github.com/Whoops-Lambo/Voxora/raw/refs/heads/main/installers/Voxora-Setup-" +
          encodeURIComponent(info.version) +
          ".exe";
    } catch {}
  }
}
start().catch((e) => toast(e.message, true));
