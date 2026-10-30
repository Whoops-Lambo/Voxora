export function createBotUI({
  node,
  button,
  input,
  field,
  modal,
  formDialog,
  confirmDialog,
  api,
  getState,
  refreshState,
  toast,
  copy,
  openIntegrations,
  assignRoles,
}) {
  function tokenDialog(result) {
    const secret = input(result.token, "", "password");
    secret.readOnly = true;
    secret.autocomplete = "off";
    secret.spellcheck = false;
    secret.setAttribute("aria-label", "Bot token");
    const id = input(result.application.id);
    id.readOnly = true;
    id.setAttribute("aria-label", "Application ID");
    modal([
      node("h2", "", "Your Bot Token"),
      node(
        "p",
        "",
        "This token is shown once. Store it in your bot’s environment. Rotating or revoking it stops the old token immediately.",
      ),
      field("APPLICATION ID", id),
      field("BOT TOKEN", secret),
      node("div", "bot-actions", [
        button("Copy Token", () => copy(result.token), "primary"),
        button(
          "Show / Hide",
          () => {
            secret.type = secret.type === "password" ? "text" : "password";
          },
          "secondary",
        ),
        button(
          "Done",
          () => document.getElementById("modal").close(),
          "secondary",
        ),
      ]),
    ]);
  }
  function appForm(app, after) {
    const name = input(app?.name || "", "My Bot"),
      description = node("textarea");
    name.required = true;
    name.maxLength = 60;
    description.maxLength = 500;
    description.value = app?.description || "";
    formDialog({
      title: app ? "Edit Application" : "New Bot Application",
      fields: [
        field("APPLICATION NAME", name),
        field("DESCRIPTION", description),
      ],
      submitLabel: app ? "Save Application" : "Create Application",
      submit: async () => {
        const result = await api(
          "/applications" + (app ? "/" + app.id : ""),
          app ? "PATCH" : "POST",
          { name: name.value, description: description.value },
        );
        await after();
        if (!app) tokenDialog(result);
      },
    });
  }
  async function developer(content) {
    content.replaceChildren(
      node("div", "bot-toolbar", [
        button(
          "New Application",
          () => appForm(null, () => developer(content)),
          "primary",
        ),
        node("a", "secondary bot-link", "Download Bot Starter"),
      ]),
    );
    content.querySelector("a").href = "/downloads/voxora-bot-starter.zip";
    content.append(
      node(
        "p",
        "bot-help",
        "Create your bot, copy its token, run the SDK starter, then install the application in a server you manage. Bots run in your own process and connect to this Voxora backend.",
      ),
    );
    const list = node("div", "bot-grid");
    content.append(list);
    const apps = await api("/applications");
    if (!content.isConnected) return;
    if (!apps.length)
      list.append(
        node(
          "div",
          "bot-empty",
          "Your first bot starts here. Create an application to get its ID and a one-time token.",
        ),
      );
    for (const app of apps) {
      const card = node("article", "bot-card", [
        node("h3", "", app.name),
        node("span", "bot-label", "BOT APPLICATION"),
        node("p", "", app.description || "No description yet."),
        node("code", "bot-id", app.id),
        node(
          "p",
          "bot-help",
          app.installedServers +
            " installations · " +
            app.commands.length +
            " slash commands · Token " +
            (app.hasToken ? "active" : "revoked"),
        ),
      ]);
      if (app.disabled)
        card.append(
          node(
            "p",
            "bot-warning",
            "Disabled by platform staff: " + app.disabledReason,
          ),
        );
      const actions = node("div", "bot-actions", [
        button("Copy Application ID", () => copy(app.id), "secondary"),
        button(
          "Edit Application",
          () => appForm(app, () => developer(content)),
          "secondary",
        ),
        button("Install Bot", () => installFromPortal(app), "primary"),
        button(
          app.hasToken ? "Rotate Token" : "Generate Token",
          () =>
            confirmDialog(
              "Generate a new token?",
              "Existing bot processes must switch to the new token. The old token will stop working immediately.",
              async () => {
                const result = await api(
                  "/applications/" + app.id + "/token",
                  "POST",
                  {},
                );
                await developer(content);
                tokenDialog(result);
              },
            ),
          "secondary",
        ),
      ]);
      if (app.hasToken)
        actions.append(
          button(
            "Revoke Token",
            () =>
              confirmDialog(
                "Revoke Bot Token",
                "Disconnect this bot and stop all access using its current token?",
                async () => {
                  await api("/applications/" + app.id + "/revoke", "POST", {});
                  await developer(content);
                },
              ),
            "danger",
          ),
        );
      actions.append(
        button(
          "Delete Application",
          () =>
            confirmDialog(
              "Delete " + app.name,
              "Remove this bot from every server and revoke its token? Its historical messages will remain attributed.",
              async () => {
                await api("/applications/" + app.id, "DELETE");
                await developer(content);
              },
            ),
          "danger",
        ),
      );
      if (app.commands.length)
        card.append(
          node(
            "p",
            "bot-command-list",
            app.commands.map((c) => "/" + c.name).join(" · "),
          ),
        );
      card.append(actions);
      list.append(card);
    }
  }
  function installFromPortal(app) {
    const servers = getState().servers.filter((s) =>
      s.permissions.includes("manageServer"),
    );
    if (!servers.length) {
      toast(
        "Create a server or ask for Manage Server before installing a bot.",
        true,
      );
      return;
    }
    const select = node("select");
    select.setAttribute("aria-label", "INSTALL IN SERVER");
    for (const s of servers) select.append(new Option(s.name, s.id));
    formDialog({
      title: "Install " + app.name,
      description:
        "The bot inherits @everyone and its assigned roles. Restrict its channels in Server Settings → Bots & Apps.",
      fields: [field("INSTALL IN SERVER", select)],
      submitLabel: "Install Bot",
      submit: async () => {
        await api("/servers/" + select.value + "/bots", "POST", {
          applicationId: app.id,
          channelIds: null,
        });
        await refreshState();
        toast("Bot installed. Open its server to try its commands.");
      },
    });
  }
  function scopeFields(s, existing = null) {
    const all = input("", "", "checkbox");
    all.checked = !existing || existing.channelIds === null;
    all.setAttribute("aria-label", "All channels the bot can view");
    const channels = node("div", "bot-channel-scope"),
      choices = [];
    for (const c of s.channels.filter((c) => c.type === "text")) {
      const checkbox = input("", "", "checkbox");
      checkbox.checked = existing?.channelIds?.includes(c.id) || false;
      checkbox.setAttribute("aria-label", "Allow #" + c.name);
      channels.append(
        node("label", "bot-scope-row", [
          checkbox,
          node("span", "", "#" + c.name),
        ]),
      );
      choices.push({ id: c.id, checkbox });
    }
    const render = () => {
      channels.hidden = all.checked;
    };
    all.onchange = render;
    render();
    const fields = [
      node("label", "bot-scope-row", [
        all,
        node("span", "", "All channels the bot can view"),
      ]),
      channels,
    ];
    if (existing?.hiddenChannels)
      fields.unshift(
        node(
          "p",
          "bot-warning",
          "This installation also includes channels you cannot view. Saving a new selection replaces the full channel list.",
        ),
      );
    return {
      fields,
      value: () =>
        all.checked
          ? null
          : choices.filter((c) => c.checkbox.checked).map((c) => c.id),
    };
  }
  async function addBot(s) {
    const catalog = await api("/bot-catalog"),
      own = await api("/applications");
    const selection = node("select");
    selection.setAttribute("aria-label", "CHOOSE A BOT");
    selection.append(new Option("Choose a bot…", ""));
    for (const a of [...catalog, ...own])
      selection.append(
        new Option(
          a.name + (a.builtin ? " · Built-in" : " · Your application"),
          a.id,
        ),
      );
    const external = input("", "Or paste an application ID");
    external.setAttribute("aria-label", "EXTERNAL APPLICATION ID");
    const scope = scopeFields(s);
    formDialog({
      title: "Add a Bot",
      description:
        "Choose Voxora Helper, one of your applications, or a developer’s application ID. Bots receive their roles’ permissions inside the channels you allow.",
      fields: [
        field("CHOOSE A BOT", selection),
        field("EXTERNAL APPLICATION ID", external),
        ...scope.fields,
      ],
      submitLabel: "Install Bot",
      submit: async () => {
        const id = external.value.trim() || selection.value;
        if (!id) throw Error("Choose a bot or paste an application ID.");
        await api("/servers/" + s.id + "/bots", "POST", {
          applicationId: id,
          channelIds: scope.value(),
        });
        await refreshState();
        openIntegrations(getState().servers.find((x) => x.id === s.id));
      },
    });
  }
  async function integrations(s, content) {
    content.append(
      node("div", "bot-toolbar", [
        button("Add a Bot", () => addBot(s), "primary"),
        node("a", "secondary bot-link", "Developer Portal"),
      ]),
    );
    content.querySelector("a").href = "/developers";
    content.append(
      node(
        "p",
        "bot-help",
        "Install bots, pause them, and restrict channel access. Use server roles and Channel Permissions to grant capabilities; channel restrictions here also apply to administrators.",
      ),
    );
    const list = node("div", "bot-grid");
    content.append(list);
    const installed = await api("/servers/" + s.id + "/bots");
    if (!content.isConnected) return;
    if (!installed.length)
      list.append(
        node(
          "p",
          "bot-empty",
          "No bots installed yet. Add Voxora Helper to try /help, /ping, /roll, /server and /poll.",
        ),
      );
    for (const item of installed) {
      const app = item.application;
      const card = node("article", "bot-card", [
        node("h3", "", app.name),
        node("span", "bot-label", app.builtin ? "BUILT-IN BOT" : "CUSTOM BOT"),
        node("p", "", app.description),
        node(
          "p",
          "bot-help",
          (item.enabled
            ? item.online
              ? "Online"
              : "Offline — start its bot process"
            : "Paused") +
            " · " +
            (item.channelIds === null
              ? "All channels allowed by roles"
              : item.channelIds.length + " visible channels selected"),
        ),
        node(
          "p",
          "bot-command-list",
          app.commands.map((c) => "/" + c.name).join(" · "),
        ),
      ]);
      if (app.disabled)
        card.append(
          node(
            "p",
            "bot-warning",
            "Disabled by platform staff: " + app.disabledReason,
          ),
        );
      const actions = node("div", "bot-actions", [
        button(
          item.enabled ? "Pause Bot" : "Enable Bot",
          async () => {
            await api("/servers/" + s.id + "/bots/" + app.id, "PATCH", {
              enabled: !item.enabled,
            });
            await refreshState();
            openIntegrations(getState().servers.find((x) => x.id === s.id));
          },
          "secondary",
        ),
        button(
          "Channel Access",
          () => {
            const scope = scopeFields(s, item);
            formDialog({
              title: "Channel Access — " + app.name,
              fields: scope.fields,
              submitLabel: "Save Channel Access",
              submit: async () => {
                await api("/servers/" + s.id + "/bots/" + app.id, "PATCH", {
                  channelIds: scope.value(),
                });
                await refreshState();
                openIntegrations(getState().servers.find((x) => x.id === s.id));
              },
            });
          },
          "secondary",
        ),
      ]);
      if (assignRoles && s.permissions.includes("manageRoles"))
        actions.append(
          button(
            "Manage Bot Roles",
            () => assignRoles(s, app.userId),
            "secondary",
          ),
        );
      actions.append(
        button(
          "Remove Bot",
          () =>
            confirmDialog(
              "Remove " + app.name,
              "Remove the bot, its server roles, and its channel permission overrides?",
              async () => {
                await api("/servers/" + s.id + "/bots/" + app.id, "DELETE");
                await refreshState();
                openIntegrations(getState().servers.find((x) => x.id === s.id));
              },
            ),
          "danger",
        ),
      );
      card.append(actions);
      list.append(card);
    }
  }
  return { developer, integrations };
}
