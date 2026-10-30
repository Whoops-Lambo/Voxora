import { randomBytes, randomUUID } from "node:crypto";
import { initializeServer, serverView } from "./management.js";
import { DEFAULT_PERMISSIONS, PERMISSION_IDS, serverPermissions, timedOut } from "./public/permissions.js";
import { isSuspended } from "./platform.js";

export const DISCOVERY_CATEGORIES = ["Community", "Gaming", "Study", "Creators", "Technology", "Other"];
const presetNames = { community: "Community", gaming: "Gaming", study: "Study Group", creator: "Creator Community" };
function preset(id) {
  if (!Object.hasOwn(presetNames, id)) return null;
  const chats = { community: ["general", "introductions", "off-topic"], gaming: ["general", "matchmaking", "clips"], study: ["general", "resources", "homework-help"], creator: ["general", "showcase", "feedback"] }[id];
  if (!chats) return null;
  const categories = ["Welcome", "Text Channels", "Voice Channels", "Staff"].map((name, i) => ({ id: "category-" + i, name, overwrites: i === 3 ? [{ type: "role", id: "everyone", deny: ["viewChannel"], allow: [] }, { type: "role", id: "moderator", deny: [], allow: ["viewChannel"] }] : [] }));
  const channel = (name, type, category, extra = {}) => ({ id: randomUUID(), name, type, categoryId: "category-" + category, permissionSynced: true, overwrites: [], topic: "", slowmode: 0, ...extra });
  return {
    name: presetNames[id], description: "A ready-to-customize " + presetNames[id].toLowerCase() + " server.", color: "#5865f2",
    roles: [
      { id: "everyone", name: "@everyone", color: null, hoist: false, position: 0, permissions: [...DEFAULT_PERMISSIONS] },
      { id: "moderator", name: "Moderator", color: "#57f287", hoist: true, position: 1, permissions: ["manageMessages", "moderateMembers", "kickMembers", "manageEvents"] },
    ],
    categories,
    channels: [
      channel("rules", "text", 0, { permissionSynced: false, overwrites: [{ type: "role", id: "everyone", deny: ["sendMessages"], allow: [] }] }),
      channel("announcements", "text", 0, { announcement: true, permissionSynced: false, overwrites: [{ type: "role", id: "everyone", deny: ["sendMessages"], allow: [] }] }),
      ...chats.map((name) => channel(name, "text", 1)),
      ...(["gaming", "study"].includes(id) ? ["Lobby", id === "gaming" ? "Squad One" : "Quiet Study", id === "gaming" ? "Squad Two" : "Group Study"] : ["Lounge"]).map((name) => channel(name, "voice", 2)),
      channel("moderators", "text", 3),
    ],
  };
}
export function initializeCommunity(state) {
  state.serverTemplates ||= [];
  state.scheduledEvents ||= [];
  for (const s of state.servers) s.discovery ||= { enabled: false, category: "Other", summary: "", tags: [] };
}
function layoutSnapshot(s) {
  const ids = new Set(s.roles.map((r) => r.id));
  const overrides = (entries = []) => entries.filter((o) => o.type === "role" && ids.has(o.id)).map((o) => ({ type: "role", id: o.id, allow: [...o.allow], deny: [...o.deny] }));
  return {
    name: s.name, description: s.description, color: s.color,
    roles: s.roles.map((r) => ({ id: r.id, name: r.name, color: r.color, hoist: !!r.hoist, position: r.position, permissions: r.permissions.filter((p) => PERMISSION_IDS.includes(p)) })),
    categories: s.categories.map((c) => ({ id: c.id, name: c.name, overwrites: overrides(c.overwrites) })),
    channels: s.channels.map((c) => ({ id: c.id, name: c.name, type: c.type, topic: c.topic || "", slowmode: c.slowmode || 0, announcement: !!c.announcement, categoryId: c.categoryId || null, permissionSynced: !!c.permissionSynced, overwrites: overrides(c.overwrites) })),
  };
}
export function instantiateLayout(layout, name, ownerId) {
  const roles = new Map(layout.roles.map((r) => [r.id, r.id === "everyone" ? "everyone" : randomUUID()]));
  const categories = new Map(layout.categories.map((c) => [c.id, randomUUID()]));
  const overrides = (entries = []) => entries.filter((o) => roles.has(o.id)).map((o) => ({ ...structuredClone(o), id: roles.get(o.id) }));
  const server = {
    id: randomUUID(), name, color: layout.color, description: layout.description || "", ownerId, members: [ownerId], createdAt: Date.now(), invite: randomBytes(6).toString("hex"),
    roles: layout.roles.map((r) => ({ ...structuredClone(r), id: roles.get(r.id) })),
    categories: layout.categories.map((c) => ({ ...structuredClone(c), id: categories.get(c.id), overwrites: overrides(c.overwrites) })),
    channels: layout.channels.map((c) => ({ ...structuredClone(c), id: randomUUID(), categoryId: categories.get(c.categoryId) || null, overwrites: overrides(c.overwrites) })),
    discovery: { enabled: false, category: "Other", summary: "", tags: [] },
  };
  initializeServer(server);
  return server;
}
const escapeCalendar = (s) => String(s).replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
const calendarDate = (value) => new Date(value).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
function foldCalendar(line) {
  let result = "", bytes = 0;
  for (const char of line) {
    const length = Buffer.byteLength(char);
    if (bytes + length > 75) { result += "\r\n "; bytes = 1; }
    result += char; bytes += length;
  }
  return result;
}

export function communityService({ state, body, json, fail, save, refresh, management, canRead, canChannel, userById, reads }) {
  const text = (value, max, required = false) => {
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(400, "Enter " + (required ? "nonempty " : "") + "text of up to " + max + " characters.");
    return value.trim();
  };
  const memberServer = (id, me) => {
    const s = state.servers.find((s) => s.id === id && s.members.includes(me.id));
    if (!s) fail(404, "Server not found.");
    return s;
  };
  const listed = (s) => s.discovery?.enabled && s.ownerId && !isSuspended(userById(s.ownerId));
  function listing(s, me) {
    return { id: s.id, name: s.name, color: s.color, summary: s.discovery.summary, category: s.discovery.category, tags: s.discovery.tags, memberCount: s.members.filter((id) => !userById(id)?.bot).length, joined: s.members.includes(me.id) };
  }
  function template(code) {
    const built = preset(code);
    if (built) return { code, name: built.name, description: built.description, layout: built, builtin: true };
    const found = state.serverTemplates.find((t) => t.code === code && !isSuspended(userById(t.createdBy)));
    if (!found) fail(404, "Template not found or revoked.");
    return found;
  }
  const templateView = (t) => ({ code: t.code, name: t.name, description: t.description, builtin: !!t.builtin, channelCount: t.layout.channels.length, categoryCount: t.layout.categories.length, roleCount: t.layout.roles.length, createdAt: t.createdAt || null });
  const eventReadable = (s, e, me) => !!(s.members.includes(me.id) && !isSuspended(me) && (e.kind === "external" || (s.channels.some((c) => c.id === e.channelId) ? canRead(me, e.channelId) : s.ownerId === me.id)));
  function eventView(s, e, me) {
    const interested = e.interestedIds.filter((id) => { const u = userById(id); return u && eventReadable(s, e, u); });
    const c = s.channels.find((c) => c.id === e.channelId);
    return { id: e.id, serverId: s.id, name: e.name, description: e.description, kind: e.kind, channelId: e.channelId, channelName: c?.name || null, location: e.kind === "voice" ? c?.name || "Deleted voice channel" : e.location, startsAt: e.startsAt, endsAt: e.endsAt, status: e.status, interested: interested.includes(me.id), interestedCount: interested.length, canManage: serverPermissions(s, me.id).includes("manageEvents"), canJoin: e.kind === "voice" && !!c && canChannel(me, c.id, "connect"), createdAt: e.createdAt };
  }
  function eventDetails(s, me, d, previous) {
    const next = { name: previous?.name || "", description: previous?.description || "", kind: previous?.kind || "voice", channelId: previous?.channelId || null, location: previous?.location || "", startsAt: previous?.startsAt, endsAt: previous?.endsAt };
    if (d.name !== undefined) next.name = text(d.name, 100, true);
    if (d.description !== undefined) next.description = text(d.description, 2000);
    if (d.kind !== undefined) next.kind = d.kind;
    if (d.channelId !== undefined) next.channelId = d.channelId;
    if (d.location !== undefined) next.location = text(d.location, 200);
    if (d.startsAt !== undefined) next.startsAt = d.startsAt;
    if (d.endsAt !== undefined) next.endsAt = d.endsAt;
    if (!next.name || !["voice", "external"].includes(next.kind)) fail(400, "Choose an event name and location type.");
    if (!Number.isSafeInteger(next.startsAt) || !Number.isSafeInteger(next.endsAt) || (next.startsAt < Date.now() - 60000 && next.startsAt !== previous?.startsAt) || next.startsAt > Date.now() + 366 * 86400000 || next.endsAt <= Date.now() || next.endsAt <= next.startsAt || next.endsAt - next.startsAt > 7 * 86400000) fail(400, "Schedule an event within the next year, lasting up to seven days.");
    if (next.kind === "voice") {
      if (!s.channels.some((c) => c.id === next.channelId && c.type === "voice") || !canRead(me, next.channelId) || !canChannel(me, next.channelId, "connect")) fail(403, "Choose a voice channel you can view and join.");
      next.location = "";
    } else {
      next.channelId = null; if (!next.location) fail(400, "Enter an event location or HTTPS link.");
      if (/^https?:\/\//i.test(next.location)) {
        let url; try { url = new URL(next.location); } catch { fail(400, "Enter a valid HTTPS event link."); }
        if (url.protocol !== "https:" || url.username || url.password) fail(400, "Use an HTTPS event link without embedded credentials.");
      }
    }
    return next;
  }
  async function handle(req, res, url, me) {
    const path = url.pathname, method = req.method;
    const discovery = path.match(/^\/api\/discovery(?:\/([\w-]+)\/join)?$/);
    const settings = path.match(/^\/api\/servers\/([\w-]+)\/discovery$/);
    const templates = path.match(/^\/api\/server-templates(?:\/([\w-]+)(?:\/(create))?)?$/);
    const exportTemplate = path.match(/^\/api\/servers\/([\w-]+)\/templates$/);
    const events = path.match(/^\/api\/servers\/([\w-]+)\/events(?:\/([\w-]+)(?:\/(rsvp|start|complete|cancel|calendar))?)?$/);
    if (!discovery && !settings && !templates && !exportTemplate && !events) return false;
    const d = ["POST", "PATCH"].includes(method) ? await body(req) : {};
    if (isSuspended(me) || me.bot) fail(403, "Use an active human account.");
    if (discovery) {
      if (!discovery[1] && method === "GET") {
        const q = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 100), category = url.searchParams.get("category") || "", offset = Number(url.searchParams.get("offset") || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || (category && !DISCOVERY_CATEGORIES.includes(category))) fail(400, "Invalid discovery filter.");
        const matches = state.servers.filter((s) => listed(s) && !s.bans.some((b) => b.userId === me.id) && (!category || s.discovery.category === category) && (s.name + " " + s.discovery.summary + " " + s.discovery.tags.join(" ")).toLowerCase().includes(q)).sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name));
        json(res, 200, { items: matches.slice(offset, offset + 12).map((s) => listing(s, me)), total: matches.length, offset, hasMore: offset + 12 < matches.length, categories: DISCOVERY_CATEGORIES }); return true;
      }
      if (!discovery[1] || method !== "POST") fail(405, "Method not allowed.");
      const s = state.servers.find((s) => s.id === discovery[1] && listed(s));
      if (!s) fail(404, "This server is no longer listed.");
      if (s.bans.some((b) => b.userId === me.id)) fail(403, "You are banned from this server.");
      if (!s.members.includes(me.id)) { s.members.push(me.id); reads.joined(me, s); management.log(s, me, "Joined through Discovery", me.displayName); }
      await save(); refresh(); json(res, 200, serverView(s, me)); return true;
    }
    if (settings) {
      const s = memberServer(settings[1], me); management.requirePermission(s, me, "manageServer");
      if (method === "GET") { json(res, 200, s.discovery); return true; }
      if (method !== "PATCH") fail(405, "Method not allowed.");
      const next = structuredClone(s.discovery);
      if (d.enabled !== undefined) { if (typeof d.enabled !== "boolean") fail(400, "Invalid discovery setting."); next.enabled = d.enabled; }
      if (d.summary !== undefined) next.summary = text(d.summary, 300);
      if (d.category !== undefined) { if (!DISCOVERY_CATEGORIES.includes(d.category)) fail(400, "Invalid discovery category."); next.category = d.category; }
      if (d.tags !== undefined) {
        if (!Array.isArray(d.tags) || d.tags.length > 5 || d.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 24)) fail(400, "Choose up to five tags, each 1–24 characters.");
        next.tags = [...new Set(d.tags.map((tag) => tag.trim().toLowerCase()))];
      }
      if (next.enabled && !next.summary) fail(400, "Add a public summary before listing the server.");
      s.discovery = next; management.log(s, me, next.enabled ? "Discovery listing updated" : "Discovery listing disabled", s.name);
      await management.commit(s); json(res, 200, next); return true;
    }
    if (templates) {
      const code = templates[1];
      if (!code && method === "GET") { json(res, 200, { presets: Object.keys(presetNames).map((id) => templateView(template(id))), mine: state.serverTemplates.filter((t) => t.createdBy === me.id).map(templateView) }); return true; }
      if (!code) fail(405, "Method not allowed.");
      const t = template(code);
      if (!templates[2] && method === "GET") { json(res, 200, templateView(t)); return true; }
      if (!templates[2] && method === "DELETE") {
        if (t.builtin || t.createdBy !== me.id) fail(403, "Only the template creator can revoke it.");
        state.serverTemplates = state.serverTemplates.filter((item) => item !== t); await save(); json(res, 200, { ok: true }); return true;
      }
      if (templates[2] !== "create" || method !== "POST") fail(405, "Method not allowed.");
      const s = instantiateLayout(t.layout, text(d.name, 60, true), me.id); state.servers.push(s); reads.joined(me, s);
      management.log(s, me, "Server created from template", t.name); await save(); refresh(); json(res, 201, serverView(s, me)); return true;
    }
    if (exportTemplate) {
      const s = memberServer(exportTemplate[1], me);
      if (method !== "POST") fail(405, "Method not allowed.");
      if (s.ownerId !== me.id) fail(403, "Only the server owner can share a layout template.");
      if (state.serverTemplates.filter((t) => t.createdBy === me.id).length >= 20) fail(400, "Revoke an older template before creating more than 20.");
      const t = { code: randomBytes(12).toString("hex"), name: text(d.name, 60, true), description: text(d.description || "", 300), layout: layoutSnapshot(s), createdBy: me.id, createdAt: Date.now() };
      state.serverTemplates.push(t); management.log(s, me, "Layout template created", t.name); await save(); json(res, 201, templateView(t)); return true;
    }
    const s = memberServer(events[1], me), id = events[2], action = events[3];
    if (!id && method === "GET") {
      const history = url.searchParams.get("history") === "1";
      const items = state.scheduledEvents.filter((e) => e.serverId === s.id && eventReadable(s, e, me) && (history ? ["completed", "cancelled"].includes(e.status) : ["scheduled", "active"].includes(e.status))).sort((a, b) => history ? b.startsAt - a.startsAt : a.startsAt - b.startsAt).slice(0, 100);
      json(res, 200, { events: items.map((e) => eventView(s, e, me)), canManage: serverPermissions(s, me.id).includes("manageEvents") }); return true;
    }
    if (!id && method === "POST") {
      management.requirePermission(s, me, "manageEvents");
      if (state.scheduledEvents.filter((e) => e.serverId === s.id && ["scheduled", "active"].includes(e.status)).length >= 100) fail(400, "A server can have up to 100 upcoming or active events.");
      const e = { id: randomUUID(), serverId: s.id, ...eventDetails(s, me, d), status: "scheduled", interestedIds: [], createdBy: me.id, createdAt: Date.now() };
      state.scheduledEvents.push(e); management.log(s, me, "Event scheduled", e.name); await save(); refresh(); json(res, 201, eventView(s, e, me)); return true;
    }
    const e = state.scheduledEvents.find((e) => e.id === id && e.serverId === s.id);
    if (!e || !eventReadable(s, e, me)) fail(404, "Event not found.");
    if (action === "calendar" && method === "GET") {
      const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Voxora//Server Events//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", "UID:" + e.id + "@voxora", "DTSTAMP:" + calendarDate(e.createdAt), "DTSTART:" + calendarDate(e.startsAt), "DTEND:" + calendarDate(e.endsAt), "SUMMARY:" + escapeCalendar(s.name + " — " + e.name), "DESCRIPTION:" + escapeCalendar(e.description), "LOCATION:" + escapeCalendar(eventView(s, e, me).location), "STATUS:" + (e.status === "cancelled" ? "CANCELLED" : "CONFIRMED"), "END:VEVENT", "END:VCALENDAR"];
      res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="voxora-event-' + e.id + '.ics"', "Cache-Control": "no-store" }); res.end(lines.map(foldCalendar).join("\r\n") + "\r\n"); return true;
    }
    if (action === "rsvp" && method === "POST") {
      if (!["scheduled", "active"].includes(e.status) || e.endsAt <= Date.now()) fail(409, "This event is closed.");
      if (timedOut(s, me.id)) fail(403, "You cannot RSVP while timed out.");
      if (typeof d.interested !== "boolean") fail(400, "Choose whether you are interested.");
      e.interestedIds = [...new Set(e.interestedIds.filter((userId) => userId !== me.id))]; if (d.interested) e.interestedIds.push(me.id);
      await save(); refresh(); json(res, 200, eventView(s, e, me)); return true;
    }
    management.requirePermission(s, me, "manageEvents");
    if (!action && method === "PATCH") {
      if (e.status !== "scheduled") fail(409, "Only scheduled events can be edited.");
      Object.assign(e, eventDetails(s, me, d, e)); management.log(s, me, "Event updated", e.name);
    } else if (method === "POST" && ["start", "complete", "cancel"].includes(action)) {
      if (action === "start") {
        if (e.status !== "scheduled" || e.startsAt > Date.now() + 15 * 60000 || e.endsAt <= Date.now()) fail(409, "Start a scheduled event within 15 minutes of its start time.");
        if (e.kind === "voice" && !canChannel(me, e.channelId, "connect")) fail(403, "You need Connect in this event's voice channel.");
        e.status = "active";
      } else if (action === "complete") { if (e.status !== "active") fail(409, "Only an active event can be completed."); e.status = "completed"; }
      else { if (!["active", "scheduled"].includes(e.status)) fail(409, "This event is already closed."); e.status = "cancelled"; }
      management.log(s, me, "Event " + e.status, e.name);
    } else fail(405, "Method not allowed.");
    await save(); refresh(); json(res, 200, eventView(s, e, me)); return true;
  }
  async function sweep() {
    let changed = false;
    const ids = new Set(state.servers.map((s) => s.id));
    const kept = state.scheduledEvents.filter((e) => ids.has(e.serverId));
    if (kept.length !== state.scheduledEvents.length) { state.scheduledEvents = kept; changed = true; }
    for (const e of kept) {
      if (["scheduled", "active"].includes(e.status) && e.endsAt <= Date.now()) { e.status = "completed"; changed = true; }
      if (e.kind === "voice" && ["scheduled", "active"].includes(e.status) && !state.servers.find((s) => s.id === e.serverId).channels.some((c) => c.id === e.channelId)) { e.status = "cancelled"; changed = true; }
    }
    if (changed) { await save(); refresh(); }
  }
  return { handle, sweep };
}
