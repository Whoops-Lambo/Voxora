export function createCommunityUI({ node, button, input, field, modal, formDialog, confirmDialog, api, getState, hasServer, refreshState, navigate, toast, copy, onEnter }) {
  let current = null, timer;
  const categories = ["Community", "Gaming", "Study", "Creators", "Technology", "Other"];
  const close = () => { current = null; document.getElementById("modal").close(); };
  const select = (label, values, selected) => {
    const control = node("select"); control.setAttribute("aria-label", label);
    for (const [value, name] of values) control.append(new Option(name, value));
    if (selected !== undefined) control.value = selected;
    return control;
  };
  const area = (value, max) => { const control = node("textarea"); control.value = value || ""; control.maxLength = max; return control; };
  function mount(title, description) {
    const panel = node("section", "community-panel"), tools = node("div", "community-tools"), cards = node("div", "community-cards"), status = node("p", "muted");
    status.setAttribute("role", "status");
    panel.append(node("header", "community-hero", [node("p", "community-eyebrow", "VOXORA COMMUNITIES"), node("h2", "", title), node("p", "", description)]), tools, status, cards);
    modal([panel], "community-dialog");
    current = { panel, tools, cards, status, version: 0, load: null };
    return current;
  }
  async function enter(server) {
    await refreshState(); close();
    const c = server.channels.find((c) => c.type === "text") || server.channels[0];
    if (!c) { toast("Joined the server. An administrator needs to give you access to a channel."); onEnter?.(server); return; }
    await navigate({ kind: c.type === "voice" ? "voice" : "channel", server: server.id, channel: c.id });
    onEnter?.(server);
  }
  function card(name, subtitle, description, color = "#5865f2") {
    const element = node("article", "community-card"), head = node("div", "community-card-heading");
    const badge = node("span", "community-server-mark", name.slice(0, 2).toUpperCase()); badge.style.background = color;
    head.append(badge, node("div", "", [node("h3", "", name), node("small", "muted", subtitle)]));
    const actions = node("div", "community-card-actions");
    element.append(head, node("p", "community-card-description", description), actions);
    return { element, actions };
  }
  function discovery() {
    const view = mount("Discover Servers", "Find a community, meet your people, and join the conversation. Only communities that choose to be listed appear here.");
    const search = input("", "Search servers or tags"); search.setAttribute("aria-label", "SEARCH PUBLIC SERVERS");
    const category = select("DISCOVERY CATEGORY", [["", "All categories"], ...categories.map((c) => [c, c])]);
    const form = node("form", "community-search"), pager = node("div", "community-pager"); let offset = 0;
    form.append(search, category, button("Search", () => { offset = 0; return view.load(); }, "primary")); view.tools.append(form);
    form.onsubmit = (event) => { event.preventDefault(); offset = 0; view.load(); };
    let searchTimer;
    search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { offset = 0; view.load(); }, 250); };
    category.onchange = () => { offset = 0; view.load(); };
    view.panel.append(pager);
    view.load = async () => {
      const version = ++view.version;
      try {
        const result = await api("/discovery?q=" + encodeURIComponent(search.value) + "&category=" + encodeURIComponent(category.value) + "&offset=" + offset);
        if (current !== view || version !== view.version || !view.panel.isConnected) return;
        view.status.textContent = result.total + " listed server(s). Manage your listing in Server Settings → Discovery.";
        view.cards.replaceChildren();
        for (const s of result.items) {
          const c = card(s.name, s.category + " · " + s.memberCount + " members", s.summary, s.color);
          if (s.tags.length) c.element.insertBefore(node("div", "community-tags", s.tags.map((tag) => node("span", "", tag))), c.actions);
          c.actions.append(button(s.joined ? "Open Server" : "Join Server", async () => {
            const joined = s.joined && getState().servers.find((x) => x.id === s.id);
            await enter(joined || await api("/discovery/" + s.id + "/join", "POST", {}));
          }, "primary"));
          view.cards.append(c.element);
        }
        if (!result.items.length) view.cards.append(node("p", "community-empty", "No servers match yet. Try another search or list your own community."));
        pager.replaceChildren();
        if (offset) pager.append(button("Previous", () => { offset = Math.max(0, offset - 12); return view.load(); }));
        if (result.hasMore) pager.append(button("Next", () => { offset += 12; return view.load(); }));
      } catch (error) { if (current === view && version === view.version) view.status.textContent = error.message; }
    };
    view.load();
  }
  async function listing(server, content) {
    const settings = await api("/servers/" + server.id + "/discovery");
    const enabled = input("", "", "checkbox"); enabled.checked = settings.enabled;
    const summary = area(settings.summary, 300), tags = input(settings.tags.join(", "), "gaming, friendly, events");
    const category = select("SERVER CATEGORY", categories.map((c) => [c, c]), settings.category);
    const form = node("form", "community-settings"), error = node("p", "form-error");
    form.append(node("p", "management-help", "Listing lets signed-in users discover and join this community. Private channels keep their permissions. Your server stays unlisted until you enable this and save."), field("List this server in Discovery", enabled), field("PUBLIC SUMMARY", summary), field("SERVER CATEGORY", category), field("TAGS (UP TO 5, COMMA SEPARATED)", tags), error);
    const save = button("Save Listing", () => {} , "primary"); save.type = "submit"; form.append(save); content.append(form);
    form.onsubmit = async (event) => {
      event.preventDefault(); save.disabled = true; error.textContent = "";
      try {
        await api("/servers/" + server.id + "/discovery", "PATCH", { enabled: enabled.checked, summary: summary.value, category: category.value, tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean) });
        await refreshState(); toast(enabled.checked ? "Server listed in Discovery." : "Discovery listing disabled.");
      } catch (e) { error.textContent = e.message; } finally { save.disabled = false; }
    };
  }
  async function useTemplate(code, known) {
    const preview = known || await api("/server-templates/" + encodeURIComponent(code));
    const name = input(preview.name); name.required = true; name.maxLength = 60;
    formDialog({ title: "Create from " + preview.name, description: preview.channelCount + " channels · " + preview.categoryCount + " categories · " + preview.roleCount + " roles. Creates a new server you own. Messages, members, bots, and follows are not copied.", fields: [field("SERVER NAME", name)], submitLabel: "Create from Template", submit: async () => { const s = await api("/server-templates/" + encodeURIComponent(preview.code) + "/create", "POST", { name: name.value }); await enter(s); } });
  }
  function importTemplate() {
    const code = input("", "Paste a template code"); code.required = true;
    formDialog({ title: "Use a Shared Template", fields: [field("TEMPLATE CODE", code)], submitLabel: "Preview Template", submit: () => useTemplate(code.value.trim()) });
  }
  function templates() {
    const view = mount("Server Templates", "Start with a ready-made layout or use a shared template. Every new server begins with you as its owner.");
    view.tools.append(button("Use a Template Code", importTemplate, "primary"));
    view.load = async () => {
      const version = ++view.version;
      try {
        const data = await api("/server-templates");
        if (current !== view || version !== view.version || !view.panel.isConnected) return;
        view.status.textContent = "Presets include rules, announcements, voice rooms, and a private staff category. No roles are assigned automatically.";
        view.cards.replaceChildren();
        for (const t of [...data.presets, ...data.mine]) {
          const c = card(t.name, (t.builtin ? "Voxora preset" : "Your shared template") + " · " + t.channelCount + " channels", t.description);
          c.actions.append(button("Use Template", () => useTemplate(t.code, t), "primary"));
          if (!t.builtin) c.actions.append(button("Copy Code", () => copy(t.code)), button("Revoke", () => confirmDialog("Revoke Template", "Stop future use of this template code? Servers already created from it keep their layouts.", async () => { await api("/server-templates/" + t.code, "DELETE"); templates(); }), "danger"));
          view.cards.append(c.element);
        }
      } catch (error) { if (current === view) view.status.textContent = error.message; }
    };
    view.load();
  }
  function exportTemplate(server) {
    const name = input((server.name + " Layout").slice(0, 60)), description = area("", 300); name.maxLength = 60; name.required = true;
    formDialog({ title: "Share a Server Template", description: "This snapshot includes the server description, channel names and topics (including private ones), categories, roles, and role permissions. Messages, members, individual member overrides, bot tokens, and follows are excluded. Anyone with the code can create a copy, so share it only with people who should see the layout.", fields: [field("TEMPLATE NAME", name), field("TEMPLATE DESCRIPTION", description)], submitLabel: "Create Template Code", submit: async () => {
      const t = await api("/servers/" + server.id + "/templates", "POST", { name: name.value, description: description.value });
      const code = input(t.code); code.readOnly = true;
      modal([node("h2", "", "Template Ready"), node("p", "", "Share this code to let someone create a new server from your layout. Manage or revoke it in Server Templates."), field("TEMPLATE CODE", code), button("Copy Template Code", () => copy(t.code), "primary"), button("My Templates", templates)]);
    } });
  }
  const dateValue = (ms) => { const date = new Date(ms); return new Date(ms - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  function editEvent(server, event) {
    const latest = getState().servers.find((s) => s.id === server.id); if (!latest) return;
    const name = input(event?.name || "", "Community game night"), description = area(event?.description, 2000);
    name.required = true; name.maxLength = 100;
    const start = input(dateValue(event?.startsAt || Date.now() + 3600000), "", "datetime-local"), end = input(dateValue(event?.endsAt || Date.now() + 7200000), "", "datetime-local"); start.required = end.required = true;
    const voices = latest.channels.filter((c) => c.type === "voice" && c.permissions.includes("connect"));
    const kind = select("EVENT LOCATION TYPE", [["voice", "Voice channel"], ["external", "Somewhere else"]], event?.kind || (voices.length ? "voice" : "external"));
    const channel = select("EVENT VOICE CHANNEL", voices.map((c) => [c.id, c.name]), event?.channelId || voices[0]?.id), location = input(event?.location || "", "Place or https:// link"); location.maxLength = 200;
    const channelField = field("EVENT VOICE CHANNEL", channel), locationField = field("EVENT LOCATION", location);
    const toggle = () => { channelField.hidden = kind.value !== "voice"; locationField.hidden = kind.value === "voice"; }; kind.onchange = toggle; toggle();
    start.onchange = () => { if (new Date(end.value).getTime() <= new Date(start.value).getTime()) end.value = dateValue(new Date(start.value).getTime() + 3600000); };
    formDialog({ title: event ? "Edit Event" : "Schedule Event", description: "Times use your device's time zone. Members can RSVP, and managers can start an event up to 15 minutes early.", fields: [field("EVENT NAME", name), field("EVENT DESCRIPTION", description), field("START TIME", start), field("END TIME", end), field("EVENT LOCATION TYPE", kind), channelField, locationField], submitLabel: event ? "Save Event" : "Create Event", submit: async () => {
      await api("/servers/" + server.id + "/events" + (event ? "/" + event.id : ""), event ? "PATCH" : "POST", { name: name.value, description: description.value, kind: kind.value, channelId: kind.value === "voice" ? channel.value : null, location: kind.value === "external" ? location.value : "", startsAt: new Date(start.value).getTime(), endsAt: new Date(end.value).getTime() });
      await refreshState(); events(server);
    } });
  }
  function events(server, history = false) {
    const view = mount("Events in " + server.name, "Plan a voice meetup or an event somewhere else. RSVP to keep track of what interests you.");
    const create = button("Schedule Event", () => editEvent(server), "primary"); create.hidden = !hasServer("manageEvents", server);
    view.tools.append(button("Upcoming", () => events(server), history ? "secondary" : "primary"), button("Past Events", () => events(server, true), history ? "primary" : "secondary"), create);
    view.load = async () => {
      const version = ++view.version;
      try {
        const data = await api("/servers/" + server.id + "/events?history=" + (history ? "1" : "0"));
        if (current !== view || version !== view.version || !view.panel.isConnected) return;
        create.hidden = !data.canManage; view.status.textContent = data.events.length + (history ? " past event(s)" : " upcoming or active event(s)"); view.cards.replaceChildren();
        for (const e of data.events) {
          const c = card(e.name, e.status.toUpperCase() + " · " + e.interestedCount + " interested", e.description);
          const beginning = new Date(e.startsAt), ending = new Date(e.endsAt);
          const endLabel = beginning.toDateString() === ending.toDateString() ? ending.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ending.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
          const timing = node("p", "community-event-time", beginning.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + " → " + endLabel);
          c.element.insertBefore(timing, c.actions);
          const place = node("p", "muted", "Location: ");
          try {
            const url = new URL(e.location);
            if (e.kind === "external" && url.protocol === "https:" && !url.username && !url.password) { const link = node("a", "", e.location); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; place.append(link); }
            else place.append(e.location);
          } catch { place.append(e.location); }
          c.element.insertBefore(place, c.actions);
          if (!history) c.actions.append(button(e.interested ? "Not Interested" : "Interested", async () => { await api("/servers/" + server.id + "/events/" + e.id + "/rsvp", "POST", { interested: !e.interested }); if (current === view) await view.load(); }, e.interested ? "secondary" : "primary"));
          const calendar = node("a", "community-calendar", "Add to Calendar"); calendar.href = "/api/servers/" + server.id + "/events/" + e.id + "/calendar"; calendar.download = "voxora-event.ics"; c.actions.append(calendar);
          if (e.status === "active" && e.canJoin) c.actions.append(button("Open Voice Channel", () => { close(); return navigate({ kind: "voice", server: server.id, channel: e.channelId }); }, "primary"));
          if (e.canManage && !history) {
            const change = async (action) => { await api("/servers/" + server.id + "/events/" + e.id + "/" + action, "POST", {}); await refreshState(); events(server, history); };
            if (e.status === "scheduled") {
              c.actions.append(button("Edit Event", () => editEvent(server, e)));
              if (e.startsAt <= Date.now() + 15 * 60000 && e.endsAt > Date.now()) c.actions.append(button("Start Event", () => change("start"), "primary"));
            }
            if (e.status === "active") c.actions.append(button("Complete Event", () => change("complete")));
            c.actions.append(button("Cancel Event", () => confirmDialog("Cancel Event", "Cancel " + e.name + "? It will remain in past events.", () => change("cancel")), "danger"));
          }
          view.cards.append(c.element);
        }
        if (!data.events.length) view.cards.append(node("p", "community-empty", history ? "No past events yet." : "No upcoming events yet. A member with Manage Events can schedule the first one."));
      } catch (error) { if (current === view && version === view.version) { view.status.textContent = error.message; view.cards.replaceChildren(); } }
    };
    view.load();
  }
  function refresh() {
    if (!current?.panel.isConnected) { current = null; return; }
    clearTimeout(timer); timer = setTimeout(() => current?.load?.(), 120);
  }
  return { discovery, listing, templates, exportTemplate, events, refresh };
}
