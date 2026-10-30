export function createChannelUI({
  node,
  button,
  ib,
  input,
  field,
  formDialog,
  confirmDialog,
  api,
  getState,
  has,
  refreshState,
  navigate,
  permissions,
  openManager,
  toast,
}) {
  const latest = (s) => getState().servers.find((x) => x.id === s.id);
  const path = (s, c) =>
    c.type ? "/channels/" + c.id : "/servers/" + s.id + "/categories/" + c.id;
  const safe = (fn) => async (event) => {
    try {
      await fn(event);
    } catch (error) {
      toast(error.message, true);
    }
  };
  function categories(s, value) {
    const select = node("select");
    select.setAttribute("aria-label", "CATEGORY");
    select.append(new Option("No category", ""));
    for (const c of s.categories) select.append(new Option(c.name, c.id));
    select.value = value || "";
    return select;
  }
  function editChannel(c, s, categoryId, returnToManager = false) {
    const name = input(c?.name || "", "new-channel"),
      topic = input(
        c?.topic || "",
        "Let everyone know what this channel is for",
      ),
      category = categories(
        s,
        c
          ? c.categoryId
          : categoryId === undefined
            ? s.categories.find((x) => x.name === "TEXT CHANNELS")?.id
            : categoryId,
      ),
      delay = input(String(c?.slowmode || 0), "", "number"),
      privateChannel = input("", "", "checkbox"),
      announcement = input("", "", "checkbox");
    announcement.checked = !!c?.announcement;
    announcement.setAttribute("aria-label", "Announcement Channel");
    name.required = true;
    name.maxLength = 50;
    topic.maxLength = 250;
    delay.min = 0;
    delay.max = 21600;
    delay.step = 1;
    delay.setAttribute("aria-label", "SLOWMODE (SECONDS)");
    const delayField = field("SLOWMODE (SECONDS)", delay);
    delayField.append(
      node(
        "small",
        "management-help",
        "0 disables slowmode. Members wait between messages; Manage Messages and Manage Channels bypass it. Maximum: 6 hours.",
      ),
    );
    let type = c?.type || "text";
    delayField.hidden = type !== "text";
    const choices = node("div");
    if (!c)
      for (const value of ["text", "voice", "announcement"]) {
        const radio = input("", "", "radio");
        radio.name = "channel-type";
        radio.value = value;
        radio.checked = value === type;
        const row = node(
          "label",
          "choice-row" + (radio.checked ? " selected" : ""),
          [
            node("span", "", [
              node("strong", "", value === "text" ? "Text" : value === "voice" ? "Voice" : "Announcement"),
              node(
                "small",
                "",
                value === "announcement" ? "Publish posts to other servers that follow this channel." : value === "text"
                  ? "Send messages, images, and files."
                  : "Hang out together with voice and video.",
              ),
            ]),
            radio,
          ],
        );
        radio.onchange = () => {
          type = value;
          delayField.hidden = type === "voice";
          if (categoryId === undefined)
            category.value =
              s.categories.find(
                (x) =>
                  x.name ===
                  (type === "voice" ? "VOICE CHANNELS" : "TEXT CHANNELS"),
              )?.id || "";
          choices
            .querySelectorAll(".choice-row")
            .forEach((r) => r.classList.toggle("selected", r.contains(radio)));
        };
        choices.append(row);
      }
    const privacy = node("label", "permission-row", [
      node("span", "", [
        node("strong", "", "Private Channel"),
        node(
          "small",
          "",
          "Only you, the owner, administrators, and members granted access can see it. Add access with Channel Permissions.",
        ),
      ]),
      privateChannel,
    ]);
    privateChannel.setAttribute("aria-label", "Private Channel");
    formDialog({
      title: c ? "Edit #" + c.name : "Create Channel",
      fields: [
        ...(!c ? [node("div", "section-label", "CHANNEL TYPE"), choices] : []),
        field("CHANNEL NAME", name),
        field("CATEGORY", category),
        field("CHANNEL TOPIC", topic),
        delayField,
        ...(c?.type === "text" ? [node("label", "permission-row", [node("span", "", "Announcement Channel"), announcement])] : []),
        ...(!c && has(s, "manageRoles") ? [privacy] : []),
        ...(c
          ? [
              node(
                "p",
                "management-help",
                "Moving a channel keeps its current permissions. Use Sync Permissions to follow the destination category.",
              ),
            ]
          : []),
      ],
      submitLabel: c ? "Save Changes" : "Create Channel",
      submit: async () => {
        const details = {
          name: name.value,
          categoryId: category.value || null,
          topic: topic.value,
          ...(type !== "voice" ? { slowmode: Number(delay.value) } : {}),
          ...(c?.type === "text" ? { announcement: announcement.checked } : {}),
        };
        if (c) await api(path(s, c), "PATCH", details);
        else {
          const result = await api("/servers/" + s.id + "/channels", "POST", {
            ...details,
            type,
            private: privateChannel.checked,
          });
          await refreshState();
          if (!returnToManager)
            await navigate({
              kind: type === "voice" ? "voice" : "channel",
              server: s.id,
              channel: result.id,
            });
        }
        await refreshState();
        if (returnToManager) openManager(latest(s));
      },
    });
  }
  function editCategory(c, s, returnToManager = false) {
    const name = input(c?.name || "", "new category");
    name.required = true;
    name.maxLength = 40;
    formDialog({
      title: c ? "Edit Category" : "Create Category",
      fields: [field("CATEGORY NAME", name)],
      submitLabel: c ? "Save Changes" : "Create Category",
      submit: async () => {
        await api(
          "/servers/" + s.id + "/categories" + (c ? "/" + c.id : ""),
          c ? "PATCH" : "POST",
          { name: name.value },
        );
        await refreshState();
        if (returnToManager) openManager(latest(s));
      },
    });
  }
  function deleteCategory(c, s, returnToManager = false) {
    confirmDialog(
      "Delete Category",
      "Delete “" +
        c.name +
        "”? Its channels, messages, and current permissions will be kept under No category.",
      async () => {
        await api(path(s, c), "DELETE");
        await refreshState();
        if (returnToManager) openManager(latest(s));
      },
    );
  }
  async function move(s, c, delta, returnToManager = false) {
    const items = c.type
      ? s.channels.filter((x) => x.categoryId === c.categoryId)
      : s.categories;
    const index = items.findIndex((x) => x.id === c.id),
      next = index + delta;
    if (next < 0 || next >= items.length) return;
    await api(path(s, c), "PATCH", {
      beforeId: delta < 0 ? items[next].id : items[next + 1]?.id || null,
    });
    await refreshState();
    if (returnToManager) openManager(latest(s));
  }
  function moveTo(c, s, returnToManager = false) {
    const select = categories(s, c.categoryId);
    select.setAttribute("aria-label", "DESTINATION CATEGORY");
    formDialog({
      title: "Move #" + c.name,
      description:
        "The channel keeps its current permissions. Sync afterward to inherit the new category’s rules.",
      fields: [field("DESTINATION CATEGORY", select)],
      submitLabel: "Move Channel",
      submit: async () => {
        await api(path(s, c), "PATCH", {
          categoryId: select.value || null,
          beforeId: null,
        });
        await refreshState();
        if (returnToManager) openManager(latest(s));
      },
    });
  }
  function sync(c, s, returnToManager = false) {
    const category = s.categories.find((x) => x.id === c.categoryId);
    if (!category) return;
    confirmDialog(
      "Sync Channel Permissions",
      "Replace #" +
        c.name +
        "’s overrides with “" +
        category.name +
        "” permissions? The channel will follow future changes to that category.",
      async () => {
        await api(path(s, c), "PATCH", { syncPermissions: true });
        await refreshState();
        if (returnToManager) openManager(latest(s));
      },
    );
  }
  function categoryActions(c, s) {
    const items = [];
    if (has(s, "manageChannels"))
      items.push(
        {
          label: "Create Channel",
          icon: "plus",
          run: () => editChannel(null, s, c.id),
        },
        {
          label: "Edit Category",
          icon: "settings",
          run: () => editCategory(c, s),
        },
        {
          label: "Move Category Up",
          icon: "chevron",
          run: () => move(s, c, -1),
        },
        {
          label: "Move Category Down",
          icon: "chevron",
          run: () => move(s, c, 1),
        },
      );
    if (has(s, "manageRoles"))
      items.push({
        label: "Category Permissions",
        icon: "lock",
        run: () => permissions(s, c),
      });
    if (has(s, "manageChannels"))
      items.push({
        label: "Delete Category",
        icon: "trash",
        danger: true,
        run: () => deleteCategory(c, s),
      });
    return items;
  }
  function drag(element, s, kind, id, categoryId = null) {
    if (!has(s, "manageChannels")) return;
    element.draggable = true;
    element.dataset.layoutId = id || "uncategorized";
    element.addEventListener("dragstart", (event) => {
      if (!id) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(
        "text/voxora-layout",
        JSON.stringify({ server: s.id, kind, id }),
      );
      element.classList.add("layout-dragging");
    });
    element.addEventListener("dragend", () => {
      element.classList.remove("layout-dragging");
      document
        .querySelectorAll(".layout-drop-target")
        .forEach((x) => x.classList.remove("layout-drop-target"));
    });
    element.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes("text/voxora-layout")) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      element.classList.add("layout-drop-target");
    });
    element.addEventListener("dragleave", (event) => {
      if (!element.contains(event.relatedTarget))
        element.classList.remove("layout-drop-target");
    });
    element.addEventListener(
      "drop",
      safe(async (event) => {
        event.preventDefault();
        event.stopPropagation();
        element.classList.remove("layout-drop-target");
        const raw = event.dataTransfer.getData("text/voxora-layout");
        if (!raw) return;
        let source;
        try {
          source = JSON.parse(raw);
        } catch {
          return;
        }
        if (source.server !== s.id || source.id === id) return;
        const current = latest(s);
        const managerOpen = !!element.closest(".channel-manager");
        if (source.kind === "category" && kind === "category" && id) {
          const c = current.categories.find((x) => x.id === source.id);
          if (!c) return;
          await api(path(s, c), "PATCH", { beforeId: id });
        } else if (source.kind === "channel") {
          const c = current.channels.find((x) => x.id === source.id);
          if (!c) return;
          await api(path(s, c), "PATCH", {
            categoryId: kind === "channel" ? categoryId : id,
            beforeId: kind === "channel" ? id : null,
          });
        } else return;
        await refreshState();
        if (managerOpen) openManager(latest(s));
      }),
    );
  }
  function renderManager(s, content) {
    const manager = node("div", "channel-manager");
    content.append(
      node(
        "p",
        "management-help",
        "Drag channels and categories to organize your server, or use the move buttons. Moving channels keeps their permissions until you sync them.",
      ),
      node("div", "channel-manager-toolbar", [
        button("Create Category", () => editCategory(null, s, true), "primary"),
        button(
          "Create Channel",
          () => editChannel(null, s, null, true),
          "secondary",
        ),
      ]),
      manager,
    );
    for (const category of [null, ...s.categories]) {
      const section = node("section", "layout-category");
      const heading = node("div", "layout-category-heading", [
        node("strong", "", category?.name || "No category"),
      ]);
      drag(heading, s, "category", category?.id || null);
      if (category) {
        const index = s.categories.indexOf(category);
        for (const [delta, label] of [
          [-1, "up"],
          [1, "down"],
        ]) {
          const control = ib(
            "chevron",
            "Move category " + category.name + " " + label,
            () => move(s, category, delta, true),
            delta < 0 ? "move-up" : "move-down",
          );
          control.disabled =
            index + delta < 0 || index + delta >= s.categories.length;
          heading.append(control);
        }
        heading.append(
          ib("settings", "Edit category " + category.name, () =>
            editCategory(category, s, true),
          ),
        );
        if (has(s, "manageRoles"))
          heading.append(
            ib("lock", "Permissions for category " + category.name, () =>
              permissions(s, category),
            ),
          );
        heading.append(
          ib(
            "trash",
            "Delete category " + category.name,
            () => deleteCategory(category, s, true),
            "danger",
          ),
        );
      }
      section.append(heading);
      const channels = s.channels.filter(
        (c) => c.categoryId === (category?.id || null),
      );
      for (const [index, c] of channels.entries()) {
        const row = node("div", "layout-channel", [
          node("div", "layout-channel-label", [
            node("strong", "", (c.type === "text" ? "# " : "◖ ") + c.name),
            node(
              "small",
              "",
              (c.type === "text" ? "Text" : "Voice") +
                " · " +
                (c.permissionSynced ? "Synced" : "Custom permissions") +
                (c.slowmode ? " · " + c.slowmode + "s slowmode" : ""),
            ),
          ]),
        ]);
        drag(row, s, "channel", c.id, c.categoryId);
        const actions = node("div", "layout-channel-actions");
        for (const [delta, label] of [
          [-1, "up"],
          [1, "down"],
        ]) {
          const control = ib(
            "chevron",
            "Move channel " + c.name + " " + label,
            () => move(s, c, delta, true),
            delta < 0 ? "move-up" : "move-down",
          );
          control.disabled =
            index + delta < 0 || index + delta >= channels.length;
          actions.append(control);
        }
        actions.append(
          ib("reply", "Move channel " + c.name + " to category", () =>
            moveTo(c, s, true),
          ),
          ib("settings", "Edit channel " + c.name, () =>
            editChannel(c, s, undefined, true),
          ),
        );
        if (has(s, "manageRoles")) {
          actions.append(
            ib("lock", "Permissions for channel " + c.name, () =>
              permissions(s, c),
            ),
          );
          if (category && !c.permissionSynced)
            actions.append(
              ib("check", "Sync permissions for " + c.name, () =>
                sync(c, s, true),
              ),
            );
        }
        row.append(actions);
        section.append(row);
      }
      if (!channels.length)
        section.append(
          node("p", "layout-empty", "Drag a channel here, or create one."),
        );
      manager.append(section);
    }
  }
  return {
    editChannel,
    editCategory,
    deleteCategory,
    categoryActions,
    move,
    moveTo,
    sync,
    drag,
    renderManager,
  };
}
