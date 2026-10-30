import {
  PERMISSIONS,
  CHANNEL_PERMISSIONS,
  serverPermissions,
  channelPermissions,
  memberRoles,
  highestRole,
  roleRank,
  outranks,
  administrator,
  timedOut,
} from "./permissions.js";
export function createManagementUI({
  node,
  button,
  ib,
  input,
  field,
  modal,
  formDialog,
  confirmDialog,
  api,
  getState,
  getServer,
  person,
  avatar,
  refreshState,
  toast,
  copy,
  profile,
  renderChannels,
  renderBots,
  renderDiscovery,
  renderEmoji,
  renderOnboarding,
  renderAutoMod,
  renderModeration,
}) {
  const me = () => getState().me;
  const has = (s, p) => serverPermissions(s, me().id).includes(p);
  const current = (id) => getState().servers.find((s) => s.id === id);
  const roles = (s) => s.roles.slice().sort((a, b) => b.position - a.position);
  const editable = (s, r) =>
    me().id === s.ownerId || r.position < roleRank(s, me().id);
  const canAssign = (s, id) =>
    has(s, "manageRoles") &&
    (me().id === s.ownerId || outranks(s, me().id, id));
  const safe = (fn) => async (event) => {
    try {
      await fn(event);
    } catch (error) {
      toast(error.message, true);
    }
  };
  function rolePill(r) {
    const pill = node("span", "role-pill", r.name);
    pill.style.setProperty("--role-color", r.color || "#949ba4");
    return pill;
  }
  function assignedRoles(s, id) {
    return memberRoles(s, id)
      .filter((r) => r.id !== "everyone")
      .sort((a, b) => b.position - a.position);
  }
  function targetActions(s, id) {
    const items = [];
    if (canAssign(s, id))
      items.push({
        label: "Manage Roles",
        icon: "shield",
        run: () => assignDialog(s, id),
      });
    if (outranks(s, me().id, id)) {
      if (has(s, "moderateMembers") && !administrator(s, id))
        items.push({
          label: timedOut(s, id) ? "Remove Timeout" : "Timeout Member",
          icon: "volume",
          run: () => timeoutDialog(s, id),
        });
      if (has(s, "kickMembers"))
        items.push({
          label: "Kick Member",
          icon: "logout",
          danger: true,
          run: () => moderateDialog(s, id, "kick"),
        });
      if (has(s, "banMembers"))
        items.push({
          label: "Ban Member",
          icon: "shield",
          danger: true,
          run: () => moderateDialog(s, id, "ban"),
        });
    }
    return items;
  }
  function assignDialog(s, id) {
    const user = person(id),
      form = node("div", "role-assignment");
    const boxes = [];
    for (const role of roles(s).filter((r) => r.id !== "everyone")) {
      const checkbox = input("", "", "checkbox");
      checkbox.checked = (s.memberRoles[id] || []).includes(role.id);
      checkbox.disabled = !editable(s, role);
      checkbox.setAttribute("aria-label", role.name);
      const row = node("label", "permission-row", [
        node("span", "", [rolePill(role)]),
        checkbox,
      ]);
      form.append(row);
      boxes.push({ role, checkbox });
    }
    if (!boxes.length)
      form.append(
        node("p", "muted", "Create a role in Server Settings → Roles first."),
      );
    formDialog({
      title: "Roles for " + user.displayName,
      description:
        "Members inherit @everyone. You can assign roles below your highest role.",
      fields: [form],
      submitLabel: "Save Roles",
      submit: async () => {
        await api("/servers/" + s.id + "/members/" + id, "PATCH", {
          roles: boxes.filter((b) => b.checkbox.checked).map((b) => b.role.id),
        });
        await refreshState();
      },
    });
  }
  function timeoutDialog(s, id) {
    const user = person(id);
    const select = node("select");
    for (const [seconds, label] of [
      [60, "60 seconds"],
      [300, "5 minutes"],
      [600, "10 minutes"],
      [3600, "1 hour"],
      [86400, "1 day"],
      [604800, "1 week"],
      [2419200, "28 days"],
    ])
      select.append(new Option(label, String(seconds)));
    select.value = "600";
    const reason = input("", "Optional moderation reason");
    reason.maxLength = 500;
    const removing = timedOut(s, id);
    formDialog({
      title: (removing ? "Remove timeout for " : "Timeout ") + user.displayName,
      description: removing
        ? "Restore this member’s normal permissions."
        : "Timed-out members can read visible channels but cannot send messages, react, or join voice.",
      fields: [
        ...(!removing ? [field("DURATION", select)] : []),
        field("REASON", reason),
      ],
      submitLabel: removing ? "Remove Timeout" : "Timeout Member",
      submit: async () => {
        await api("/servers/" + s.id + "/members/" + id, "PATCH", {
          timeoutUntil: removing ? 0 : Date.now() + Number(select.value) * 1000,
          reason: reason.value,
        });
        await refreshState();
        toast(removing ? "Timeout removed." : "Member timed out.");
      },
    });
  }
  function moderateDialog(s, id, action) {
    const user = person(id),
      reason = input("", "Optional moderation reason");
    reason.maxLength = 500;
    formDialog({
      title: (action === "ban" ? "Ban " : "Kick ") + user.displayName,
      description:
        action === "ban"
          ? "This member will be removed and cannot rejoin until the ban is revoked."
          : "This member will be removed. They can rejoin using an invite.",
      fields: [field("REASON", reason)],
      submitLabel: action === "ban" ? "Ban Member" : "Kick Member",
      danger: true,
      submit: async () => {
        await api(
          "/servers/" + s.id + (action === "ban" ? "/bans/" : "/members/") + id,
          action === "ban" ? "POST" : "DELETE",
          { reason: reason.value },
        );
        await refreshState();
        toast(action === "ban" ? "Member banned." : "Member kicked.");
      },
    });
  }
  function open(s, tab = "Overview", selectedRole = null) {
    s = current(s.id);
    if (!s) return;
    const tabs = [];
    if (has(s, "manageServer")) tabs.push("Overview");
    if (has(s,'manageAutoMod'))tabs.push('AutoMod');
    if (has(s,'manageReports'))tabs.push('Moderation');
    if (has(s, "manageServer")) tabs.push("Discovery");
    if (has(s, "manageServer") || has(s, "manageRoles")) tabs.push("Onboarding");
    if (has(s, "manageServer")) tabs.push("Bots & Apps");
    if (has(s, "manageExpressions")) tabs.push("Emoji");
    if (has(s, "manageChannels")) tabs.push("Channels");
    if (has(s, "manageRoles")) tabs.push("Roles");
    if (
      ["manageRoles", "moderateMembers", "kickMembers", "banMembers"].some(
        (p) => has(s, p),
      )
    )
      tabs.push("Members");
    if (has(s, "inviteMembers")) tabs.push("Invites");
    if (has(s, "banMembers")) tabs.push("Bans");
    if (has(s, "viewAuditLog")) tabs.push("Audit Log");
    if (!tabs.length) {
      toast("You do not have server management permissions.", true);
      return;
    }
    if (!tabs.includes(tab)) tab = tabs[0];
    const nav = node("nav", "settings-nav", [node("h3", "", s.name)]),
      content = node("div", "settings-content manage-content");
    for (const name of tabs)
      nav.append(
        button(
          name,
          () => open(s, name),
          "manage-tab" + (tab === name ? " active" : ""),
        ),
      );
    if (s.ownerId === me().id) {
      nav.append(
        node("div", "settings-rule"),
        button("Transfer Ownership", () => transferDialog(s), "danger"),
        button(
          "Delete Server",
          () => {
            const value = input("", "Type " + s.name);
            formDialog({
              title: "Delete " + s.name,
              description:
                "Permanently delete the server, channels and all messages. Type the server name to confirm.",
              fields: [field("SERVER NAME", value)],
              submitLabel: "Delete Server",
              danger: true,
              submit: async () => {
                if (value.value !== s.name)
                  throw Error("The server name does not match.");
                await api("/servers/" + s.id, "DELETE");
                await refreshState();
              },
            });
          },
          "danger",
        ),
      );
    }
    content.append(node("h2", "", tab));
    modal([nav, content], "settings-dialog management-dialog");
    if (tab === "Overview") overview(s, content);
    if(tab==='AutoMod')renderAutoMod(s,content).catch(error=>toast(error.message,true));
    if(tab==='Moderation')content.append(node('p','management-help','Review member reports and AutoMod cases, claim work, and track channel activity.'),button('Open Moderation Queue',()=>renderModeration(s),'primary'));
    if (tab === "Discovery") renderDiscovery(s, content).catch((error) => toast(error.message, true));
    if (tab === "Emoji") renderEmoji(s, content).catch((error) => toast(error.message, true));
    if (tab === "Onboarding") renderOnboarding(s, content).catch(error => toast(error.message, true));
    if (tab === "Channels") renderChannels(s, content);
    if (tab === "Bots & Apps")
      renderBots(s, content).catch((error) => toast(error.message, true));
    if (tab === "Roles") roleEditor(s, content, selectedRole);
    if (tab === "Members") members(s, content);
    if (tab === "Invites")
      invites(s, content).catch((error) => toast(error.message, true));
    if (tab === "Bans")
      bans(s, content).catch((error) => toast(error.message, true));
    if (tab === "Audit Log")
      audit(s, content).catch((error) => toast(error.message, true));
  }
  function overview(s, content) {
    content.append(
      node("div", "server-stats", [
        node("div", "", [
          node("strong", "", String(s.members.length)),
          node("span", "", "Members"),
        ]),
        node("div", "", [
          node("strong", "", String(s.roles.length)),
          node("span", "", "Roles"),
        ]),
        node("div", "", [
          node("strong", "", String(s.channels.length)),
          node("span", "", "Visible Channels"),
        ]),
      ]),
    );
    const form = node("form"),
      name = input(s.name),
      color = input(s.color, "", "color"),
      description = node("textarea");
    name.required = true;
    name.maxLength = 60;
    color.className = "color-input";
    description.value = s.description || "";
    description.maxLength = 500;
    const save = node("button", "primary", "Save Changes");
    save.type = "submit";
    const error = node("p", "form-error");
    form.append(
      field("SERVER NAME", name),
      field("SERVER DESCRIPTION", description),
      field("SERVER COLOR", color),
      error,
      save,
    );
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        save.disabled = true;
        await api("/servers/" + s.id, "PATCH", {
          name: name.value,
          color: color.value,
          description: description.value,
        });
        await refreshState();
        toast("Server updated.");
      } catch (e) {
        error.textContent = e.message;
      } finally {
        save.disabled = false;
      }
    };
    content.append(form);
  }
  function roleEditor(s, content, id) {
    const layout = node("div", "roles-layout"),
      list = node("div", "roles-list"),
      editor = node("div", "role-editor");
    layout.append(list, editor);
    content.append(
      node(
        "p",
        "management-help",
        "Roles higher in the list have higher priority. Members inherit permissions from every assigned role. Administrators still follow role hierarchy.",
      ),
      layout,
    );
    list.append(
      button(
        "Create Role",
        () => {
          const name = input("", "New Role");
          name.required = true;
          name.maxLength = 40;
          formDialog({
            title: "Create Role",
            fields: [field("ROLE NAME", name)],
            submitLabel: "Create Role",
            submit: async () => {
              const role = await api("/servers/" + s.id + "/roles", "POST", {
                name: name.value,
              });
              await refreshState();
              open(s, "Roles", role.id);
            },
          });
        },
        "primary full",
      ),
    );
    const selected = roles(s).find((r) => r.id === id) || roles(s)[0];
    for (const role of roles(s)) {
      const row = node(
        "div",
        "role-list-row" + (selected?.id === role.id ? " active" : ""),
      );
      const dot = node("i", "role-color-dot");
      dot.style.background = role.color || "#949ba4";
      row.append(button("", () => open(s, "Roles", role.id), "role-select"));
      row.firstChild.append(dot, document.createTextNode(role.name));
      if (role.id !== "everyone" && editable(s, role)) {
        const order = roles(s).filter((r) => r.id !== "everyone"),
          index = order.findIndex((r) => r.id === role.id);
        for (const [delta, label] of [
          [-1, "up"],
          [1, "down"],
        ]) {
          const b = ib(
            "chevron",
            "Move " + role.name + " " + label,
            async () => {
              const next = order.slice();
              [next[index], next[index + delta]] = [
                next[index + delta],
                next[index],
              ];
              await api("/servers/" + s.id + "/roles/reorder", "POST", {
                roleIds: next.map((r) => r.id),
              });
              await refreshState();
              open(s, "Roles", role.id);
            },
            "role-" + label,
          );
          b.disabled =
            !order[index + delta] || !editable(s, order[index + delta]);
          row.append(b);
        }
      }
      list.append(row);
    }
    if (!selected) return;
    const role = selected,
      form = node("form"),
      readOnly = !editable(s, role);
    const heading = node("div", "role-editor-heading", [
      node("h3", "", "EDIT ROLE — " + role.name),
    ]);
    if (role.id !== "everyone" && !readOnly)
      heading.append(
        ib("trash", "Delete Role", () =>
          confirmDialog(
            "Delete " + role.name,
            "This removes the role from all members and channel overrides.",
            async () => {
              await api("/servers/" + s.id + "/roles/" + role.id, "DELETE");
              await refreshState();
              open(s, "Roles");
            },
          ),
        ),
      );
    editor.append(heading);
    if (readOnly)
      editor.append(
        node(
          "p",
          "management-notice",
          "This role is at or above your highest role and cannot be edited.",
        ),
      );
    const name = input(role.name);
    name.maxLength = 40;
    name.required = true;
    name.disabled = readOnly || role.id === "everyone";
    const color = input(role.color || "#949ba4", "", "color");
    color.className = "color-input";
    color.disabled = readOnly;
    const noColor = input("", "", "checkbox");
    noColor.checked = !role.color;
    noColor.disabled = readOnly;
    const hoist = input("", "", "checkbox");
    hoist.checked = role.hoist;
    hoist.disabled = readOnly || role.id === "everyone";
    form.append(
      field("ROLE NAME", name),
      field("ROLE COLOR", color),
      node("label", "inline-check", [
        noColor,
        document.createTextNode("Use default color"),
      ]),
      node("label", "inline-check", [
        hoist,
        document.createTextNode("Display role members separately"),
      ]),
    );
    const permissions = new Map();
    for (const group of [...new Set(PERMISSIONS.map((p) => p.group))]) {
      form.append(node("h3", "permission-group", group + " Permissions"));
      for (const p of PERMISSIONS.filter((p) => p.group === group)) {
        const check = input("", "", "checkbox");
        check.checked = role.permissions.includes(p.id);
        check.disabled =
          readOnly || (!has(s, p.id) && !role.permissions.includes(p.id));
        check.setAttribute("aria-label", p.name);
        permissions.set(p.id, check);
        form.append(
          node("label", "permission-row", [
            node("span", "", [
              node("strong", "", p.name),
              node("small", "", p.description),
            ]),
            check,
          ]),
        );
      }
    }
    const error = node("p", "form-error"),
      save = node("button", "primary", "Save Role");
    save.type = "submit";
    save.disabled = readOnly;
    form.append(error, save);
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        save.disabled = true;
        await api("/servers/" + s.id + "/roles/" + role.id, "PATCH", {
          name: name.value,
          color: noColor.checked ? null : color.value,
          hoist: hoist.checked,
          permissions: [...permissions]
            .filter(([, check]) => check.checked)
            .map(([id]) => id),
        });
        await refreshState();
        toast("Role saved.");
        open(s, "Roles", role.id);
      } catch (e) {
        error.textContent = e.message;
      } finally {
        save.disabled = readOnly;
      }
    };
    editor.append(form);
  }
  function members(s, content) {
    const search = input("", "Search members");
    search.setAttribute("aria-label", "Search server members");
    search.className = "management-search";
    const list = node("div");
    content.append(search, list);
    const render = () => {
      list.replaceChildren();
      for (const id of s.members.filter((id) =>
        (person(id).displayName + " " + person(id).username)
          .toLowerCase()
          .includes(search.value.toLowerCase()),
      )) {
        const user = person(id),
          row = node("div", "management-member");
        const identity = button("", () => profile(id), "management-identity");
        identity.append(
          avatar(user, "", true),
          node("span", "", [
            node("strong", "", user.displayName),
            node(
              "small",
              "",
              user.username + (id === s.ownerId ? " · Server Owner" : ""),
            ),
          ]),
        );
        const chips = node("div", "member-role-chips");
        for (const r of assignedRoles(s, id)) chips.append(rolePill(r));
        if (timedOut(s, id))
          chips.append(
            node(
              "span",
              "timeout-badge",
              "Timed out until " + new Date(s.timeouts[id]).toLocaleString(),
            ),
          );
        row.append(identity, chips);
        const actions = node("div", "member-management-actions");
        if (canAssign(s, id))
          actions.append(
            ib("shield", "Manage roles for " + user.displayName, () =>
              assignDialog(s, id),
            ),
          );
        for (const a of targetActions(s, id).filter(
          (a) => a.label !== "Manage Roles",
        ))
          actions.append(
            ib(
              a.icon,
              a.label + " — " + user.displayName,
              a.run,
              a.danger ? "danger" : "",
            ),
          );
        row.append(actions);
        list.append(row);
      }
    };
    search.oninput = render;
    render();
  }
  async function bans(s, content) {
    const list = node("div");
    content.append(
      node(
        "p",
        "management-help",
        "Banned members cannot rejoin through any invite until you revoke their ban.",
      ),
      list,
    );
    const data = await api("/servers/" + s.id + "/bans");
    if (!content.isConnected) return;
    if (!data.length)
      list.append(node("p", "settings-empty", "No banned members."));
    for (const ban of data) {
      const row = node("div", "management-member");
      row.append(
        node("div", "", [
          node("strong", "", ban.user?.displayName || ban.userId),
          node("p", "small muted", ban.reason || "No reason provided"),
        ]),
        button(
          "Revoke Ban",
          () =>
            confirmDialog(
              "Revoke Ban",
              "This user will be able to join using an invite again.",
              async () => {
                await api("/servers/" + s.id + "/bans/" + ban.userId, "DELETE");
                await refreshState();
                open(s, "Bans");
              },
            ),
          "secondary",
        ),
      );
      list.append(row);
    }
  }
  async function audit(s, content) {
    const search = input("", "Search audit log");
    search.setAttribute("aria-label", "Search audit log");
    search.className = "management-search";
    const list = node("div");
    content.append(
      search,
      button("Refresh", () => open(s, "Audit Log"), "secondary"),
      list,
    );
    const data = await api("/servers/" + s.id + "/audit");
    if (!content.isConnected) return;
    const render = () => {
      const entries = data.filter((e) =>
        (e.actorName + " " + e.action + " " + e.target + " " + e.reason)
          .toLowerCase()
          .includes(search.value.toLowerCase()),
      );
      list.replaceChildren();
      if (!entries.length)
        list.append(
          node("p", "settings-empty", "No matching management actions."),
        );
      for (const e of entries)
        list.append(
          node("article", "audit-entry", [
            node("div", "", [
              node("strong", "", e.actorName),
              document.createTextNode(" · " + e.action),
              node("time", "", new Date(e.time).toLocaleString()),
            ]),
            node("p", "", e.target),
            ...(e.reason
              ? [node("p", "audit-reason", "Reason: " + e.reason)]
              : []),
          ]),
        );
    };
    search.oninput = render;
    render();
  }
  async function invites(s, content) {
    content.append(
      button("Create Invite", () => newInvite(s), "primary"),
      node(
        "p",
        "management-help",
        "Manage invite expiration, maximum uses, and revocation. You can revoke invites you created; Manage Server can revoke any invite.",
      ),
    );
    const list = node("div");
    content.append(list);
    const data = await api("/servers/" + s.id + "/invites");
    if (!content.isConnected) return;
    if (!data.length)
      list.append(node("p", "settings-empty", "No active invites."));
    for (const invite of data) {
      const expired =
        (invite.expiresAt && invite.expiresAt <= Date.now()) ||
        (invite.maxUses && invite.uses >= invite.maxUses);
      const row = node("div", "invite-management-row", [
        node("div", "", [
          node("strong", "", invite.code),
          node(
            "small",
            "",
            (expired ? "Expired · " : "") +
              invite.uses +
              (invite.maxUses ? "/" + invite.maxUses : "") +
              " uses · " +
              (invite.expiresAt
                ? "Expires " + new Date(invite.expiresAt).toLocaleString()
                : "Never expires"),
          ),
        ]),
        ib("copy", "Copy Invite " + invite.code, () =>
          copy(location.origin + "/invite/" + invite.code),
        ),
        ib(
          "trash",
          "Revoke Invite " + invite.code,
          () =>
            confirmDialog(
              "Revoke Invite",
              "Anyone using this invite will no longer be able to join.",
              async () => {
                await api(
                  "/servers/" + s.id + "/invites/" + invite.code,
                  "DELETE",
                );
                await refreshState();
                open(s, "Invites");
              },
            ),
          "danger",
        ),
      ]);
      list.append(row);
    }
  }
  function newInvite(s) {
    const ttl = node("select"),
      max = input("0", "", "number");
    for (const [seconds, label] of [
      [1800, "30 minutes"],
      [3600, "1 hour"],
      [21600, "6 hours"],
      [86400, "1 day"],
      [604800, "7 days"],
      [0, "Never"],
    ])
      ttl.append(new Option(label, String(seconds)));
    ttl.value = "86400";
    max.min = 0;
    max.max = 1000;
    formDialog({
      title: "Create Invite",
      description:
        "Choose an expiration and usage limit. Zero uses means unlimited.",
      fields: [field("EXPIRES AFTER", ttl), field("MAXIMUM USES", max)],
      submitLabel: "Create Invite",
      submit: async () => {
        const invite = await api("/servers/" + s.id + "/invites", "POST", {
          expiresIn: Number(ttl.value),
          maxUses: Number(max.value),
        });
        await refreshState();
        await copy(location.origin + "/invite/" + invite.code);
        open(s, "Invites");
      },
    });
  }
  function transferDialog(s) {
    const target = node("select");
    for (const id of s.members.filter((id) => id !== me().id))
      target.append(new Option(person(id).displayName, id));
    if (!target.options.length) {
      toast("Invite another member before transferring ownership.", true);
      return;
    }
    const confirmation = input("", "Type " + s.name);
    formDialog({
      title: "Transfer Ownership",
      description:
        "The selected member will control this server. You will lose owner privileges. Type the server name to confirm.",
      fields: [
        field("NEW OWNER", target),
        field("CONFIRM SERVER NAME", confirmation),
      ],
      submitLabel: "Transfer Ownership",
      danger: true,
      submit: async () => {
        await api("/servers/" + s.id + "/transfer", "POST", {
          userId: target.value,
          confirmation: confirmation.value,
        });
        await refreshState();
        toast("Ownership transferred.");
      },
    });
  }
  function channelDialog(s, c) {
    const choices = node("select"),
      holder = node("div");
    const entries = (c.overwrites || []).map((o) => ({
      ...o,
      allow: [...o.allow],
      deny: [...o.deny],
    }));
    const available = [
      ...roles(s)
        .filter((r) => editable(s, r))
        .map((r) => ({
          key: "role:" + r.id,
          label: r.name,
          id: r.id,
          type: "role",
        })),
      ...s.members
        .filter((id) => outranks(s, me().id, id) || me().id === s.ownerId)
        .map((id) => ({
          key: "member:" + id,
          label: "Member: " + person(id).displayName,
          id,
          type: "member",
        })),
    ];
    if (!available.length) {
      toast("No manageable permission targets.", true);
      return;
    }
    for (const item of available)
      choices.append(new Option(item.label, item.key));
    const controls = new Map();
    let active = null;
    function store() {
      if (!active) return;
      const allow = [],
        deny = [];
      for (const [id, select] of controls) {
        if (select.value === "allow") allow.push(id);
        if (select.value === "deny") deny.push(id);
      }
      const index = entries.findIndex(
        (o) => o.id === active.id && o.type === active.type,
      );
      if (index >= 0) entries.splice(index, 1);
      if (allow.length || deny.length)
        entries.push({ id: active.id, type: active.type, allow, deny });
    }
    function render() {
      active = available.find((x) => x.key === choices.value);
      controls.clear();
      holder.replaceChildren();
      const existing = entries.find(
        (o) => o.id === active.id && o.type === active.type,
      );
      for (const p of PERMISSIONS.filter((p) =>
        CHANNEL_PERMISSIONS.includes(p.id),
      )) {
        const select = node("select");
        select.setAttribute("aria-label", p.name + " override");
        for (const [value, label] of [
          ["inherit", "/ Inherit"],
          ["allow", "✓ Allow"],
          ["deny", "✕ Deny"],
        ])
          select.append(new Option(label, value));
        select.value = existing?.allow.includes(p.id)
          ? "allow"
          : existing?.deny.includes(p.id)
            ? "deny"
            : "inherit";
        controls.set(p.id, select);
        holder.append(
          node("div", "permission-row", [
            node("span", "", [
              node("strong", "", p.name),
              node("small", "", p.description),
            ]),
            select,
          ]),
        );
      }
    }
    choices.onchange = () => {
      store();
      render();
    };
    render();
    formDialog({
      title: "Permissions — " + (c.type ? "#" : "Category: ") + c.name,
      description:
        (c.type
          ? "Editing channel permissions makes this channel independent of its category. "
          : "Changes apply immediately to all channels synced with this category. ") +
        "@everyone applies first, then combined role overrides, then member overrides. Administrator bypasses overrides.",
      fields: [field("ROLE OR MEMBER", choices), holder],
      submitLabel: "Save Permissions",
      submit: async () => {
        store();
        await api(
          c.type
            ? "/channels/" + c.id
            : "/servers/" + s.id + "/categories/" + c.id,
          "PATCH",
          { overwrites: entries },
        );
        await refreshState();
        toast((c.type ? "Channel" : "Category") + " permissions saved.");
      },
    });
    document
      .getElementById("modal")
      .classList.add("channel-permissions-dialog");
  }
  return {
    open,
    assignedRoles,
    rolePill,
    targetActions,
    assignDialog,
    channelDialog,
    has,
    canAssign,
  };
}
