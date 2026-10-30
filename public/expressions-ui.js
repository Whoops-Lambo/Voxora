export function createExpressionUI({ node, button, input, field, formDialog, confirmDialog, api, refreshState, toast }) {
  async function manager(server, content) {
    const root = node("div"), list = node("div"), error = node("p", "form-error"), form = node("form", "emoji-upload");
    const name = input("", "wave"), file = input("", "", "file"); name.required = file.required = true; name.maxLength = 32; name.pattern = "[A-Za-z0-9_]{2,32}"; file.accept = ".png,.gif,.webp";
    const upload = button("Upload Emoji", () => {}, "primary"); upload.type = "submit";
    form.append(node("p", "management-help", "Add up to 50 PNG, GIF, or WebP images. Maximum 256 KB and 256×256 pixels. Members can use them in this server's messages, reactions, and threads."), field("EMOJI NAME", name), field("EMOJI IMAGE", file), error, upload);
    root.append(form, list); content.append(root);
    async function load() {
      const items = await api("/servers/" + server.id + "/emojis"); if (!root.isConnected) return; list.replaceChildren();
      for (const e of items) {
        const image = node("img"); image.src = e.url; image.alt = ":" + e.name + ":";
        list.append(node("div", "emoji-manager-row", [image, node("strong", "", ":" + e.name + ":"), button("Rename Emoji", () => {
          const value = input(e.name); value.maxLength = 32;
          formDialog({ title: "Rename Emoji", fields: [field("EMOJI NAME", value)], submitLabel: "Save Emoji Name", submit: async () => { await api("/servers/" + server.id + "/emojis/" + e.id, "PATCH", { name: value.value }); await refreshState(); toast("Emoji renamed."); } });
        }), button("Delete Emoji", () => confirmDialog("Delete Emoji", "Delete :" + e.name + ":? Existing messages keep a text fallback; published copies keep their image.", async () => { await api("/servers/" + server.id + "/emojis/" + e.id, "DELETE"); await refreshState(); toast("Emoji deleted."); }))]));
      }
      if (!items.length) list.append(node("p", "muted", "No custom emoji yet."));
    }
    form.onsubmit = async (event) => {
      event.preventDefault(); error.textContent = ""; upload.disabled = true;
      try {
        const image = file.files[0]; if (!image || image.size > 256 * 1024) throw Error("Choose an image up to 256 KB.");
        const response = await fetch("/api/servers/" + server.id + "/emojis?name=" + encodeURIComponent(name.value), { method: "POST", headers: { "Content-Type": image.type || "application/octet-stream" }, body: image });
        const data = await response.json(); if (!response.ok) throw Error(data.error);
        file.value = ""; name.value = ""; await refreshState(); await load(); toast("Custom emoji uploaded.");
      } catch (e) { error.textContent = e.message; } finally { upload.disabled = false; }
    }; await load();
  }
  return { manager };
}
