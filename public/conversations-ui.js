export function createConversationUI({ node, button, ib, input, field, modal, formDialog, confirmDialog, api, getState, getRoute, storage, refreshState, navigate, openMessage, formatted, emojiVisual, emojiPicker, toast, showThreadPanel, closeThreadPanel, reportMessage }) {
  let active = null, listView = null, savedView = null, readTimer, loadTimer;
  const refs = () => getState()?.savedMessageRefs || [];
  const savedRef = (m) => refs().find((i) => i.messageId === m.id && (i.threadId || null) === (m.threadId || null));
  const closeModal = () => document.getElementById("modal").close();
  async function toggleSaved(m) {
    const existing = savedRef(m);
    if (existing) await api("/saved-messages/" + existing.id, "DELETE");
    else await api("/saved-messages", "POST", { messageId: m.id, threadId: m.threadId || null });
    await refreshState(); toast(existing ? "Saved message removed." : "Message saved privately.");
    if (active?.pane?.isConnected) drawReplies(active);
  }
  function savedMessages() {
    const search = input("", "Search saved messages or notes"); search.setAttribute("aria-label", "SEARCH SAVED MESSAGES");
    const status = node("p", "muted"), results = node("div", "saved-results"), pager = node("div", "community-pager");
    const root = node("section", "saved-view", [node("h2", "", "Saved Messages"), node("p", "muted", "Private to your account. Content is shown only while you can still access it."), search, status, results, pager]);
    modal([root], "saved-dialog"); let offset = 0, version = 0, searchTimer;
    const view = savedView = { root, load: null };
    view.load = async () => {
      const request = ++version;
      try {
        const data = await api("/saved-messages?q=" + encodeURIComponent(search.value) + "&offset=" + offset);
        if (savedView !== view || request !== version || !root.isConnected) return;
        results.replaceChildren(); pager.replaceChildren(); status.textContent = data.total + " saved message(s)";
        for (const item of data.items) {
          const m = item.message, row = node("article", "saved-card");
          row.append(node("div", "saved-meta", m.author + " · " + new Date(m.time).toLocaleString() + (item.threadId ? " · Thread reply" : "")), node("div", "message-text", [formatted(m.text, m.customEmojis)]));
          if (m.attachments.length) row.append(node("p", "muted", m.attachments.map((f) => f.name).join(", ")));
          if (item.note) row.append(node("p", "saved-note", item.note));
          row.append(node("div", "thread-actions", [
            button("Open Message", async () => { closeModal(); if (item.threadId) await openThread(item.threadId, m.id); else await openMessage(m); }),
            button(item.note ? "Edit Note" : "Add Note", () => {
              const note = node("textarea"); note.value = item.note; note.maxLength = 500;
              formDialog({ title: "Private Note", fields: [field("NOTE", note)], submitLabel: "Save Note", submit: async () => { await api("/saved-messages/" + item.id, "PATCH", { note: note.value }); savedMessages(); } });
            }),
            button("Remove Save", async () => { await api("/saved-messages/" + item.id, "DELETE"); await refreshState(); await view.load(); }, "danger"),
          ])); results.append(row);
        }
        if (!data.items.length) results.append(node("p", "muted", "No saved messages match. Use a message's Save Message action to save it here."));
        if (data.unavailable.length) results.append(node("div", "saved-unavailable", [node("p", "muted", data.unavailable.length + " saved message(s) are deleted, blocked, or no longer accessible. Their content is hidden."), button("Remove Unavailable Saves", async () => { await api("/saved-messages/unavailable", "DELETE"); await refreshState(); await view.load(); })]));
        if (offset) pager.append(button("Previous", () => { offset = Math.max(0, offset - 20); return view.load(); }));
        if (data.hasMore) pager.append(button("Next", () => { offset += 20; return view.load(); }));
      } catch (error) { if (root.isConnected) status.textContent = error.message; }
    };
    search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { offset = 0; view.load(); }, 200); }; view.load();
  }
  function createThread(m) {
    if (m.thread) return openThread(m.thread.id);
    const name = input(m.text.slice(0, 80) || "Discussion"); name.required = true; name.maxLength = 80;
    formDialog({ title: "Create Thread", description: "Everyone who can view this channel can view the thread. Threads auto-archive after 24 hours without a reply.", fields: [field("THREAD NAME", name)], submitLabel: "Create Thread", submit: async () => { const t = await api("/threads", "POST", { messageId: m.id, name: name.value }); closeModal(); await openThread(t.id); } });
  }
  function threads(channel) {
    const root = node("section", "threads-view"), target = node("div", "saved-results"), status = node("p", "muted"); let archived = false;
    const view = listView = { root, load: null };
    root.append(node("h2", "", "Channel Threads"), node("div", "thread-actions", [button("Active Threads", () => { archived = false; return view.load(); }, "primary"), button("Archived Threads", () => { archived = true; return view.load(); })]), status, target);
    modal([root], "saved-dialog");
    view.load = async () => {
      try {
        const data = await api("/threads?channel=" + channel + "&archived=" + (archived ? "1" : "0")); if (listView !== view || !root.isConnected) return;
        status.textContent = data.length + (archived ? " archived" : " active") + " thread(s)"; target.replaceChildren();
        for (const t of data) target.append(node("article", "saved-card", [node("h3", "", t.name), node("p", "muted", t.replyCount + " replies · " + t.unreadCount + " unread" + (t.locked ? " · Locked" : "")), button("Open Thread", () => openThread(t.id), "primary")]));
        if (!data.length) target.append(node("p", "muted", "No threads here. Start one from a message's Create Thread action."));
      } catch (error) { status.textContent = error.message; target.replaceChildren(); }
    }; view.load();
  }
  async function openThread(id, around) {
    const t = await api("/threads/" + id), route = getRoute();
    if (route.channel !== t.channelId || route.kind !== "channel") await navigate({ kind: "channel", server: t.serverId, channel: t.channelId });
    closeModal(); active = { id, thread: t, messages: [], pane: null, version: 0, around, hasOlder: false, hasNewer: false, files: [], replyTo: null };
    showThreadPanel();
  }
  const draftKey = (view) => "thread-draft:" + getState().me.id + ":" + view.id;
  function scheduleRead() {
    clearTimeout(readTimer); readTimer = setTimeout(async () => {
      const view = active;
      if (!view?.pane?.isConnected || document.getElementById("modal").open || document.visibilityState !== "visible" || !document.hasFocus() || view.hasNewer) return;
      const bounds = view.log.getBoundingClientRect(); let through = 0;
      for (const row of view.log.querySelectorAll("[data-thread-sequence]")) { const r = row.getBoundingClientRect(); if (r.top < bounds.bottom && r.bottom > bounds.top) through = Math.max(through, Number(row.dataset.threadSequence)); }
      if (!through || through <= view.thread.readSequence) return;
      try { const result = await api("/threads/" + view.id + "/read", "POST", { through }); view.thread.readSequence = result.through; } catch {}
    }, 180);
  }
  function render(target) {
    if (!active) return;
    if (active.pane?.isConnected && target.contains(active.pane)) { refresh(); return; }
    const view = active, head = node("div", "thread-heading"), actions = node("div", "thread-actions"), log = node("div", "thread-log"), form = node("form", "thread-composer");
    const title = node("strong", "", view.thread.name), status = node("p", "muted small"), context = node("div", "thread-parent");
    log.setAttribute("role", "log"); log.setAttribute("aria-label", "Thread replies");
    const content = node("textarea"); content.maxLength = 2000; content.rows = 2; content.placeholder = "Reply in thread"; content.setAttribute("aria-label", "Thread message"); content.value = storage.get(draftKey(view), "");
    const upload = node("input"); upload.type = "file"; upload.multiple = true; upload.hidden = true; upload.setAttribute("aria-label", "Thread attachments");
    const files = node("div", "thread-files"), reply = node("div", "thread-reply");
    const tools = node("div", "thread-actions", [ib("plus", "Attach to Thread", () => upload.click()), ib("emoji", "Thread Emoji", (event) => emojiPicker(event, (emoji) => { content.setRangeText(emoji, content.selectionStart, content.selectionEnd, "end"); content.focus(); content.oninput(); })), button("Send Reply", () => form.requestSubmit(), "primary")]);
    form.append(reply, files, content, tools, upload);
    const pane = node("section", "thread-pane", [head, context, status, actions, log, form]);
    head.append(title, ib("close", "Close Thread", () => { active = null; closeThreadPanel(); }));
    Object.assign(view, { pane, head: title, status, actions, log, form, content, context, filesNode: files, replyNode: reply, upload });
    target.replaceChildren(pane); content.oninput = () => storage.set(draftKey(view), content.value);
    content.onkeydown = (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } };
    upload.onchange = () => { view.files = [...upload.files].slice(0, 5); files.textContent = view.files.map((f) => f.name).join(", "); };
    log.onscroll = scheduleRead;
    form.onsubmit = async (event) => {
      event.preventDefault(); if (view.sending || (!content.value.trim() && !view.files.length)) return; view.sending = true;
      try {
        const ids = [];
        for (const file of view.files) {
          const response = await fetch("/api/files?channel=" + view.thread.channelId, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) }, body: file }); const data = await response.json(); if (!response.ok) throw Error(data.error); ids.push(data.id);
        }
        await api("/threads/" + view.id + "/messages", "POST", { text: content.value, files: ids, replyTo: view.replyTo?.id || null });
        content.value = ""; storage.set(draftKey(view), ""); view.files = []; upload.value = ""; files.textContent = ""; view.replyTo = null; reply.replaceChildren(); view.around = null; view.messages = []; await load(view, { tail: true });
      } catch (error) { toast(error.message, true); } finally { view.sending = false; }
    };
    load(view, { tail: !view.around });
  }
  async function load(view, { tail = false, before } = {}) {
    const version = ++view.version;
    try {
      const data = await api("/threads/" + view.id + "/messages" + (before ? "?before=" + before : view.around ? "?around=" + view.around : ""));
      if (active !== view || version !== view.version || !view.pane.isConnected) return;
      const height = view.log.scrollHeight, top = view.log.scrollTop, near = height - top - view.log.clientHeight < 140;
      const oldest = view.messages[0]?.sequence;
      view.thread = data.thread; view.parent = data.parent;
      view.messages = [...new Map([...view.messages, ...data.messages].map((m) => [m.id, m])).values()].sort((a, b) => a.sequence - b.sequence);
      if (before || oldest === undefined || data.messages[0]?.sequence <= oldest) view.hasOlder = data.hasOlder;
      if (!before) view.hasNewer = data.hasNewer;
      drawReplies(view); controls(view);
      if (before) view.log.scrollTop = top + view.log.scrollHeight - height;
      else if (view.around && !view.located) { view.log.querySelector('[data-thread-message="' + view.around + '"]')?.scrollIntoView({ block: "center" }); view.located = true; }
      else if (tail || near) view.log.scrollTop = view.log.scrollHeight;
      scheduleRead();
    } catch (error) { if (active === view && version === view.version) { view.status.textContent = error.message; view.content.disabled = true; if (error.status === 403 || error.status === 404) { view.messages = []; view.log.replaceChildren(); for (const b of view.form.querySelectorAll("button")) b.disabled = true; } } }
  }
  function controls(view) {
    const t = view.thread; view.head.textContent = t.name; view.status.textContent = t.replyCount + " replies" + (t.locked ? " · Locked" : t.archived ? " · Archived" : " · Auto-archives after 24 hours inactive");
    view.context.replaceChildren(button("View original message", () => openMessage({ channel: t.channelId, id: t.parentId }), "text-button"));
    view.actions.replaceChildren();
    if (t.canArchive) view.actions.append(button("Rename Thread", () => {
      const name = input(t.name); name.required = true; name.maxLength = 80;
      formDialog({ title: "Rename Thread", fields: [field("THREAD NAME", name)], submitLabel: "Save Thread Name", submit: async () => { await update(view, { name: name.value }); closeModal(); } });
    }), button(t.archived ? "Reopen Thread" : "Archive Thread", () => update(view, { archived: !t.archived })));
    if (t.canManage) view.actions.append(button(t.locked ? "Unlock Thread" : "Lock Thread", () => update(view, { locked: !t.locked })), button("Delete Thread", () => confirmDialog("Delete Thread", "Delete this thread and every reply? Saved references will become unavailable.", async () => { await api("/threads/" + t.id, "DELETE"); closeModal(); active = null; closeThreadPanel(); }), "danger"));
    view.content.disabled = !t.canSend; for (const b of view.form.querySelectorAll("button")) b.disabled = !t.canSend;
    if (!t.canSend) view.content.placeholder = "This thread is archived, locked, or read-only.";
    else view.content.placeholder = "Reply in thread";
  }
  async function update(view, settings) { await api("/threads/" + view.id, "PATCH", settings); await load(view); }
  function drawReplies(view) {
    view.log.replaceChildren();
    if (view.hasOlder) view.log.append(button("Load Earlier Replies", () => load(view, { before: view.messages[0].id })));
    for (const m of view.messages) {
      const row = node("article", "thread-message"); row.dataset.threadMessage = m.id; row.dataset.threadSequence = m.sequence;
      row.append(node("div", "thread-message-meta", m.author + " · " + new Date(m.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + (m.editedAt ? " · edited" : "")));
      if (m.reply) row.append(node("small", "muted", "Replying to " + m.reply.author + ": " + m.reply.text));
      row.append(node("div", "message-text", [formatted(m.text, m.customEmojis)]));
      for (const f of m.attachments) { const a = node("a", "thread-attachment", f.name); a.href = f.url + "?download=1"; row.append(a); }
      const reactions = node("div", "reactions");
      for (const r of m.reactions) { const b = button("", async () => { await api("/thread-messages/" + m.id + "/reactions", "POST", { emoji: r.emoji }); refresh(); }, "reaction"); b.append(emojiVisual(r.emoji, m.customEmojis), document.createTextNode(" " + r.userIds.length)); b.disabled = !view.thread.canReact; b.setAttribute("aria-label", "React " + r.emoji); reactions.append(b); } row.append(reactions);
      const actions = node("div", "thread-message-actions");
      if(m.authorId!==getState().me.id)actions.append(ib('shield','Report Reply',()=>reportMessage(m)));
      actions.append(ib("bookmark", savedRef(m) ? "Unsave Reply" : "Save Reply", () => toggleSaved(m)), ib("reply", "Reply to Reply", () => { view.replyTo = m; view.replyNode.replaceChildren(node("span", "", "Replying to " + m.author), button("Cancel Reply", () => { view.replyTo = null; view.replyNode.replaceChildren(); })); view.content.focus(); }));
      actions.append(ib("emoji", "React to Reply", (event) => emojiPicker(event, async (emoji) => { await api("/thread-messages/" + m.id + "/reactions", "POST", { emoji }); refresh(); })));
      actions.querySelector('[aria-label="Reply to Reply"]').disabled = !view.thread.canSend;
      actions.querySelector('[aria-label="React to Reply"]').disabled = !view.thread.canReact;
      if (m.authorId === getState().me.id && view.thread.canSend) actions.append(ib("edit", "Edit Reply", () => {
        const text = node("textarea"); text.value = m.text; text.maxLength = 2000;
        formDialog({ title: "Edit Reply", fields: [field("REPLY TEXT", text)], submitLabel: "Save Reply", submit: async () => { await api("/thread-messages/" + m.id, "PATCH", { text: text.value }); closeModal(); refresh(); } });
      }));
      if (m.authorId === getState().me.id || getState().servers.find((s) => s.id === view.thread.serverId)?.channels.find((c) => c.id === view.thread.channelId)?.permissions.includes("manageMessages")) actions.append(ib("trash", "Delete Reply", () => confirmDialog("Delete Reply", "Delete this reply?", async () => { await api("/thread-messages/" + m.id, "DELETE"); closeModal(); refresh(); })));
      row.append(actions); view.log.append(row);
    }
    if (!view.messages.length) view.log.append(node("p", "muted", "Start the discussion with the first reply."));
    if (view.hasNewer) view.log.append(button("Jump to Latest Replies", () => { view.around = null; view.messages = []; return load(view, { tail: true }); }, "primary"));
  }
  function refresh() { clearTimeout(loadTimer); loadTimer = setTimeout(() => { if (active?.pane?.isConnected) load(active); if (listView?.root.isConnected) listView.load(); if (savedView?.root.isConnected) savedView.load(); }, 60); }
  function handleEvent(event) {
    if (event.type === "thread-deleted" && active?.id === event.threadId) { active = null; closeThreadPanel(); toast("This thread was deleted."); }
    else {
      if (active && active.id === event.threadId && active.pane?.isConnected) {
        if (event.type === "thread-message-delete") active.messages = active.messages.filter((m) => m.id !== event.id);
        if (event.type === "thread-message-update") active.messages = active.messages.map((m) => m.id === event.message.id ? event.message : m);
        drawReplies(active);
      }
      refresh();
    }
  }
  document.addEventListener("visibilitychange", scheduleRead); window.addEventListener("focus", scheduleRead); document.getElementById("modal").addEventListener("close", scheduleRead);
  return { createThread, openThread, threads, render, refresh, handleEvent, savedMessages, toggleSaved, isSaved: (m) => !!savedRef(m) };
}
