import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, link, copyFile } from "node:fs/promises";
import path from "node:path";
import { isSuspended } from "./platform.js";

const pattern = /<:([A-Za-z0-9_]{2,32}):([a-f0-9-]{36})>/g;
export function initializeExpressions(state) { state.serverEmojis ||= []; }
export function imageInfo(bytes, fail) {
  let width, height, mime;
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR" && bytes.toString("ascii", bytes.length - 8, bytes.length - 4) === "IEND") {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); mime = "image/png";
  } else if (bytes.length >= 14 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) {
    width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8); mime = "image/gif";
  } else if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const kind = bytes.toString("ascii", 12, 16); mime = "image/webp";
    if (kind === "VP8X") { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1; }
    else if (kind === "VP8L" && bytes[20] === 47) { width = 1 + ((bytes[21] | bytes[22] << 8) & 16383); height = 1 + ((bytes[22] >> 6 | bytes[23] << 2 | bytes[24] << 10) & 16383); }
    else if (kind === "VP8 " && bytes.subarray(23, 26).equals(Buffer.from([157,1,42]))) { width = bytes.readUInt16LE(26) & 16383; height = bytes.readUInt16LE(28) & 16383; }
  }
  if (!mime || !width || !height || width > 256 || height > 256) fail(400, "Upload a PNG, GIF, or WebP image up to 256×256 pixels and 256 KB. SVG is not supported.");
  return { mime, width, height };
}
export function expressionService({ state, dataDir, body, bytes, json, fail, save, refresh, management, serverFor, userById }) {
  const dir = path.join(dataDir, "emojis"), pending = new Set();
  const code = (e) => "<:" + e.name + ":" + e.id + ">";
  const view = (e) => ({ id: e.id, serverId: e.serverId, name: e.name, mime: e.mime, width: e.width, height: e.height, url: "/api/emojis/" + e.id, code: code(e) });
  const member = (s, me) => s && state.servers.includes(s) && !isSuspended(me) && s.members.includes(me.id);
  const checkedName = (name) => { if (typeof name !== "string" || !/^[A-Za-z0-9_]{2,32}$/.test(name)) fail(400, "Emoji names use 2–32 letters, numbers, or underscores."); return name.toLowerCase(); };
  function validateText(text, channel) {
    const server = serverFor(channel);
    for (const match of String(text).matchAll(pattern)) {
      const e = state.serverEmojis.find((e) => e.id === match[2] && e.serverId === server?.id);
      if (!e) fail(400, "A custom emoji is unavailable or belongs to another server. Remove it or pick an emoji from this server.");
    }
  }
  function validateReaction(value, channel) {
    if (typeof value !== "string" || !value.trim()) fail(400, "Choose an emoji.");
    const tokens = [...value.matchAll(pattern)];
    if (tokens.length) { if (tokens.length !== 1 || tokens[0][0] !== value) fail(400, "Choose one emoji."); validateText(value, channel); return code(state.serverEmojis.find((e) => e.id === tokens[0][2])); }
    else if (value.length > 24) fail(400, "Choose a Unicode or server emoji.");
    return value;
  }
  function messageEmojis(text, channel, overrides = []) {
    const server = serverFor(channel), result = [], seen = new Set();
    for (const match of String(text).matchAll(pattern)) {
      const id = match[2]; if (seen.has(id)) continue; seen.add(id);
      const copied = overrides.find((e) => e.id === id);
      const file = copied && state.files.find((f) => f.id === copied.fileId && f.channel === channel);
      if (file) result.push({ id, name: copied.name, url: "/api/files/" + file.id });
      else { const e = state.serverEmojis.find((e) => e.id === id && e.serverId === server?.id); if (e) result.push(view(e)); }
    }
    return result;
  }
  async function serve(e, res) {
    let content; try { content = await readFile(path.join(dir, e.id)); } catch (error) { if (error.code === "ENOENT") fail(404, "Emoji not found."); throw error; }
    res.writeHead(200, { "Content-Type": e.mime, "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; sandbox" }); res.end(content);
  }
  async function handle(req, res, url, me) {
    const match = url.pathname.match(/^\/api\/servers\/([\w-]+)\/emojis(?:\/([\w-]+))?$/), asset = url.pathname.match(/^\/api\/emojis\/([\w-]+)$/);
    if (!match && !asset) return false;
    if (asset) {
      const e = state.serverEmojis.find((e) => e.id === asset[1]), s = e && state.servers.find((s) => s.id === e.serverId);
      if (!e || !member(s, me)) fail(404, "Emoji not found.");
      if (req.method !== "GET") fail(405, "Method not allowed."); await serve(e, res); return true;
    }
    const s = state.servers.find((s) => s.id === match[1]);
    if (!member(s, me)) fail(404, "Server not found.");
    if (req.method === "GET" && !match[2]) { json(res, 200, state.serverEmojis.filter((e) => e.serverId === s.id).map(view)); return true; }
    if (req.method === "POST" && !match[2]) {
      management.requirePermission(s, me, "manageExpressions");
      const content = await bytes(req, 256 * 1024), name = checkedName(url.searchParams.get("name"));
      const info = imageInfo(content, fail), key = s.id + ":" + name;
      management.requirePermission(s, me, "manageExpressions");
      if (pending.has(key) || state.serverEmojis.some((e) => e.serverId === s.id && e.name === name)) fail(409, "That emoji name is already in use.");
      if (state.serverEmojis.filter((e) => e.serverId === s.id).length + [...pending].filter((key) => key.startsWith(s.id + ":")).length >= 50) fail(400, "A server can have up to 50 custom emoji.");
      pending.add(key); const e = { id: randomUUID(), serverId: s.id, name, ...info, size: content.length, createdBy: me.id, createdAt: Date.now() }; let stored = false;
      try {
        await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, e.id), content);
        management.requirePermission(s, me, "manageExpressions"); if (!member(s, me)) fail(403, "Your permissions changed.");
        state.serverEmojis.push(e); stored = true; management.log(s, me, "Custom emoji uploaded", name); await save(); refresh(); json(res, 201, view(e));
      } finally { pending.delete(key); if (!stored) await unlink(path.join(dir, e.id)).catch(() => {}); }
      return true;
    }
    const d = req.method === "PATCH" ? await body(req) : {};
    if (!member(s, me)) fail(404, "Server not found.");
    management.requirePermission(s, me, "manageExpressions");
    const e = state.serverEmojis.find((e) => e.id === match[2] && e.serverId === s.id); if (!e) fail(404, "Emoji not found.");
    if (req.method === "PATCH") {
      const name = checkedName(d.name); if (pending.has(s.id + ":" + name) || state.serverEmojis.some((other) => other !== e && other.serverId === s.id && other.name === name)) fail(409, "That emoji name is already in use.");
      e.name = name;
      for (const m of [...state.messages, ...state.threadMessages]) for (const r of m.reactions || [])
        if ([...r.emoji.matchAll(pattern)].some((match) => match[2] === e.id)) r.emoji = code(e);
      management.log(s, me, "Custom emoji renamed", name); await save(); refresh(); json(res, 200, view(e)); return true;
    }
    if (req.method === "DELETE") {
      state.serverEmojis = state.serverEmojis.filter((other) => other !== e); management.log(s, me, "Custom emoji deleted", e.name); await save(); refresh(); await unlink(path.join(dir, e.id)).catch(() => {}); json(res, 200, { ok: true }); return true;
    }
    fail(405, "Method not allowed.");
  }
  async function cloneAssets(refs, channel, userId) {
    const files = [];
    try {
      for (const ref of refs) {
        const e = state.serverEmojis.find((e) => e.id === ref.id); if (!e) fail(400, "An emoji is no longer available.");
        const file = { id: randomUUID(), channel, userId, name: e.name, mime: e.mime, size: e.size, emojiId: e.id, emojiName: e.name };
        const to = path.join(dataDir, "uploads", file.id); await link(path.join(dir, e.id), to).catch(() => copyFile(path.join(dir, e.id), to)); files.push(file);
      }
      return files;
    } catch (error) { for (const f of files) await unlink(path.join(dataDir, "uploads", f.id)).catch(() => {}); throw error; }
  }
  async function sweep() {
    const orphans = state.serverEmojis.filter((e) => !state.servers.some((s) => s.id === e.serverId)); if (!orphans.length) return;
    state.serverEmojis = state.serverEmojis.filter((e) => !orphans.includes(e)); await save(); for (const e of orphans) await unlink(path.join(dir, e.id)).catch(() => {});
  }
  return { handle, validateText, validateReaction, messageEmojis, cloneAssets, sweep, list: (id) => state.serverEmojis.filter((e) => e.serverId === id).map(view), forUser: (me) => state.serverEmojis.filter((e) => member(state.servers.find((s) => s.id === e.serverId), me)).map(view), serve, byId: (id) => state.serverEmojis.find((e) => e.id === id) };
}
