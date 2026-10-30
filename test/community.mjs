import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fixture, until } from "./support/server.mjs";

function delayed(f, who, path, data) {
  let request;
  const payload = JSON.stringify(data);
  const result = new Promise((resolve, reject) => {
    request = http.request(f.origin + "/api" + path, { method: "PATCH", headers: { Cookie: who.cookie, "Content-Type": "application/json" } }, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.on("error", reject); request.write(payload.slice(0, -1));
  });
  return { result, end: () => request.end(payload.slice(-1)) };
}

test("discovery is opt-in, exposes only public metadata, honors bans, privacy, revocation and pagination", async () => {
  const f = await fixture();
  try {
    const owner = await f.register("discover_owner"), member = await f.register("discover_member"), newcomer = await f.register("discover_new"), banned = await f.register("discover_banned");
    const O = (p, m, d) => f.call(owner, p, m, d), N = (p, m, d) => f.call(newcomer, p, m, d);
    const server = (await O("/servers", "POST", { name: "Game Forge" })).data, base = "/servers/" + server.id;
    assert.equal((await N("/discovery")).data.total, 0);
    const privateChannel = (await O(base + "/channels", "POST", { name: "secret-finance", private: true })).data;
    await O("/messages", "POST", { channel: privateChannel.id, text: "PRIVATE-MESSAGE-CONTENT" });
    await O("/servers/" + server.id, "PATCH", { description: "INTERNAL-DESCRIPTION" });
    for (const who of [member, banned]) await f.call(who, "/invites/join", "POST", { code: server.invite });
    assert.equal((await N(base + "/discovery")).status, 404);
    assert.equal((await f.call(member, base + "/discovery", "PATCH", { enabled: true, summary: "No" })).status, 403);
    assert.equal((await O(base + "/discovery", "PATCH", { enabled: true })).status, 400);
    assert.equal((await O(base + "/discovery", "PATCH", { enabled: true, summary: "Friendly gaming and meetups", category: "Gaming", tags: ["games", "Games"] })).status, 200);
    const directory = (await N("/discovery?q=meetups&category=Gaming")).data;
    assert.equal(directory.total, 1); assert.deepEqual(directory.items[0].tags, ["games"]);
    for (const secret of [privateChannel.id, "secret-finance", "PRIVATE-MESSAGE-CONTENT", "INTERNAL-DESCRIPTION", server.invite, owner.id]) assert.ok(!JSON.stringify(directory).includes(secret));
    const joined = await N("/discovery/" + server.id + "/join", "POST", {});
    assert.equal(joined.status, 200); assert.ok(!joined.data.channels.some((c) => c.id === privateChannel.id));
    assert.equal((await N("/messages?channel=" + privateChannel.id)).status, 403);
    await N("/discovery/" + server.id + "/join", "POST", {});
    assert.equal((await O("/state")).data.servers.find((s) => s.id === server.id).members.filter((id) => id === newcomer.id).length, 1);
    await O(base + "/bans/" + banned.id, "POST", { reason: "Fixture ban" });
    assert.equal((await f.call(banned, "/discovery")).data.total, 0);
    assert.equal((await f.call(banned, "/discovery/" + server.id + "/join", "POST", {})).status, 403);
    await O(base + "/discovery", "PATCH", { enabled: false });
    assert.equal((await N("/discovery/" + server.id + "/join", "POST", {})).status, 404);
    const role = (await O(base + "/roles", "POST", { name: "Community Manager", permissions: ["manageServer"] })).data;
    await O(base + "/members/" + member.id, "PATCH", { roles: [role.id] });
    const pending = delayed(f, member, base + "/discovery", { enabled: true, summary: "Should stay unlisted" });
    await O(base + "/roles/" + role.id, "PATCH", { permissions: [] }); pending.end();
    assert.equal(await pending.result, 403); assert.equal((await N("/discovery")).data.total, 0);
    for (let index = 0; index < 13; index++) {
      const s = (await O("/servers", "POST", { name: "Paging " + index })).data;
      await O("/servers/" + s.id + "/discovery", "PATCH", { enabled: true, summary: "Paging fixture", category: "Study" });
    }
    const page = (await N("/discovery?q=Paging")).data, next = (await N("/discovery?q=Paging&offset=12")).data;
    assert.equal(page.items.length, 12); assert.equal(page.hasMore, true); assert.equal(next.items.length, 1);
    assert.ok(!page.items.some((a) => a.id === next.items[0].id));
    await f.stop(); await f.start(); assert.equal((await N("/discovery?q=Paging")).data.total, 13);
  } finally { await f.cleanup(); }
});

test("templates clone layouts and role privacy with fresh IDs without members, content, bot secrets or follows", async () => {
  const f = await fixture();
  try {
    const owner = await f.register("layout_owner"), creator = await f.register("layout_creator"), visitor = await f.register("layout_visitor");
    const O = (p, m, d) => f.call(owner, p, m, d), C = (p, m, d) => f.call(creator, p, m, d);
    const presets = (await O("/server-templates")).data.presets;
    assert.equal(presets.length, 4);
    for (const invalid of ["__proto__", "constructor", "toString"])
      assert.equal((await O("/server-templates/" + invalid)).status, 404);
    const source = (await O("/server-templates/community/create", "POST", { name: "Original Layout" })).data;
    const base = "/servers/" + source.id, privateChannel = source.channels.find((c) => c.name === "moderators");
    assert.ok(privateChannel); assert.equal(source.discovery.enabled, false);
    await f.call(visitor, "/invites/join", "POST", { code: source.invite });
    assert.ok(!(await f.call(visitor, "/state")).data.servers.find((s) => s.id === source.id).channels.some((c) => c.id === privateChannel.id));
    assert.equal((await f.call(visitor, "/messages", "POST", { channel: source.channels.find((c) => c.name === "rules").id, text: "Not allowed" })).status, 403);
    await O("/messages", "POST", { channel: privateChannel.id, text: "DO-NOT-COPY-CONTENT" });
    const app = (await O("/applications", "POST", { name: "Source Bot" })).data;
    await O(base + "/bots", "POST", { applicationId: app.application.id });
    assert.equal((await f.call(visitor, base + "/templates", "POST", { name: "Unauthorized" })).status, 403);
    const template = (await O(base + "/templates", "POST", { name: "Shared Layout", description: "A reusable layout" })).data;
    assert.match(template.code, /^[a-f0-9]{24}$/);
    assert.ok(!JSON.stringify((await C("/server-templates/" + template.code)).data).includes("moderators"));
    const snapshot = JSON.parse(await readFile(f.dir + "/state.json", "utf8")).serverTemplates[0].layout;
    for (const secret of [owner.id, visitor.id, app.token, "tokenHash", "DO-NOT-COPY-CONTENT", source.invite]) assert.ok(!JSON.stringify(snapshot).includes(secret));
    const cloned = (await C("/server-templates/" + template.code + "/create", "POST", { name: "Copied Layout" })).data;
    assert.equal(cloned.ownerId, creator.id); assert.deepEqual(cloned.members, [creator.id]);
    assert.equal(cloned.channels.length, source.channels.length); assert.equal(cloned.categories.length, source.categories.length);
    assert.ok(cloned.channels.every((c) => !source.channels.some((old) => old.id === c.id)));
    const oldModerator = source.roles.find((r) => r.name === "Moderator"), newModerator = cloned.roles.find((r) => r.name === "Moderator");
    assert.notEqual(newModerator.id, oldModerator.id); assert.deepEqual(newModerator.permissions, oldModerator.permissions);
    assert.ok(cloned.categories.find((c) => c.name === "Staff").overwrites.some((o) => o.id === newModerator.id));
    const raw = JSON.parse(await readFile(f.dir + "/state.json", "utf8")).servers.find((s) => s.id === cloned.id);
    assert.deepEqual(raw.memberRoles, {}); assert.deepEqual(raw.botInstallations, []); assert.deepEqual(raw.bans, []);
    assert.equal((await C("/messages?channel=" + cloned.channels.find((c) => c.name === "moderators").id)).data.length, 0);
    await f.call(visitor, "/invites/join", "POST", { code: cloned.invite });
    const visitorClone = (await f.call(visitor, "/state")).data.servers.find((s) => s.id === cloned.id);
    assert.ok(!visitorClone.channels.some((c) => c.name === "moderators"));
    await O("/channels/" + privateChannel.id, "PATCH", { name: "renamed-after-export" });
    await f.stop(); await f.start();
    const frozen = (await C("/server-templates/" + template.code + "/create", "POST", { name: "Frozen Snapshot" })).data;
    assert.ok(frozen.channels.some((c) => c.name === "moderators"));
    assert.equal((await C("/server-templates/" + template.code, "DELETE")).status, 403);
    assert.equal((await O("/server-templates/" + template.code, "DELETE")).status, 200);
    assert.equal((await C("/server-templates/" + template.code + "/create", "POST", { name: "Revoked" })).status, 404);
    for (const code of ["gaming", "study", "creator"]) assert.equal((await C("/server-templates/" + code + "/create", "POST", { name: code })).status, 201);
  } finally { await f.cleanup(); }
});

test("events enforce current permissions, private-channel visibility, RSVP ownership, calendar safety, lifecycle and persistence", async () => {
  const f = await fixture();
  try {
    const owner = await f.register("events_owner"), manager = await f.register("events_manager"), member = await f.register("events_member"), outsider = await f.register("events_outsider");
    const O = (p, m, d) => f.call(owner, p, m, d), M = (p, m, d) => f.call(member, p, m, d);
    const server = (await O("/servers", "POST", { name: "Events Club" })).data, base = "/servers/" + server.id, path = base + "/events";
    for (const u of [manager, member]) await f.call(u, "/invites/join", "POST", { code: server.invite });
    const privateVoice = (await O(base + "/channels", "POST", { name: "Staff Voice", type: "voice", private: true })).data;
    const role = (await O(base + "/roles", "POST", { name: "Event Manager", permissions: ["manageEvents"] })).data;
    await O(base + "/members/" + manager.id, "PATCH", { roles: [role.id] });
    const draft = { name: "Community Night", description: "Games and a chat", kind: "external", location: "https://example.com/meet", startsAt: Date.now() + 120000, endsAt: Date.now() + 3600000 };
    assert.equal((await M(path, "POST", draft)).status, 403);
    assert.equal((await O(path, "POST", { ...draft, endsAt: draft.startsAt - 1 })).status, 400);
    assert.equal((await O(path, "POST", { ...draft, location: "https://user:secret@example.com" })).status, 400);
    const privateEvent = (await O(path, "POST", { ...draft, name: "Private Meeting", kind: "voice", channelId: privateVoice.id })).data;
    assert.ok(!(await M(path)).data.events.some((e) => e.id === privateEvent.id));
    assert.equal((await f.call(manager, path + "/" + privateEvent.id + "/start", "POST", {})).status, 404);
    assert.equal((await fetch(f.origin + "/api" + path + "/" + privateEvent.id + "/calendar", { headers: { Cookie: member.cookie } })).status, 404);
    const event = (await f.call(manager, path, "POST", draft)).data;
    assert.equal((await f.call(outsider, path)).status, 404);
    const votes = await Promise.all(Array.from({ length: 4 }, () => M(path + "/" + event.id + "/rsvp", "POST", { interested: true, userId: owner.id })));
    assert.ok(votes.every((v) => v.status === 200 && v.data.interestedCount === 1));
    assert.equal((await O(path)).data.events.find((e) => e.id === event.id).interested, false);
    const calendar = await fetch(f.origin + "/api" + path + "/" + event.id + "/calendar", { headers: { Cookie: member.cookie } });
    assert.equal(calendar.status, 200); assert.match(calendar.headers.get("content-type"), /text\/calendar/);
    const ics = await calendar.text(); assert.match(ics, /BEGIN:VCALENDAR\r\n/); assert.ok(!ics.includes(member.id));
    await O(base + "/members/" + member.id, "PATCH", { timeoutUntil: Date.now() + 60000 });
    assert.equal((await M(path + "/" + event.id + "/rsvp", "POST", { interested: false })).status, 403);
    await O(base + "/members/" + member.id, "PATCH", { timeoutUntil: 0 });
    const far = (await O(path, "POST", { ...draft, startsAt: Date.now() + 86400000, endsAt: Date.now() + 90000000 })).data;
    assert.equal((await O(path + "/" + far.id + "/start", "POST", {})).status, 409);
    assert.equal((await O(path + "/" + event.id + "/start", "POST", {})).data.status, "active");
    assert.equal((await O(path + "/" + event.id, "PATCH", { name: "Too late" })).status, 409);
    assert.equal((await O(path + "/" + event.id + "/complete", "POST", {})).data.status, "completed");
    assert.equal((await M(path + "/" + event.id + "/rsvp", "POST", { interested: false })).status, 409);
    assert.ok((await O(path + "?history=1")).data.events.some((e) => e.id === event.id));
    const pending = delayed(f, manager, path + "/" + far.id, { name: "Should not edit" });
    await O(base + "/roles/" + role.id, "PATCH", { permissions: [] }); pending.end(); assert.equal(await pending.result, 403);
    const escaped = (await O(path, "POST", { ...draft, name: "Meet, greet; \nBEGIN:VEVENT", description: "🎉".repeat(100) + "\r\nATTENDEE:fake" })).data;
    const safe = await (await fetch(f.origin + "/api" + path + "/" + escaped.id + "/calendar", { headers: { Cookie: member.cookie } })).text();
    assert.equal(safe.split("\r\nBEGIN:VEVENT").length, 2); assert.ok(safe.includes("\\nBEGIN:VEVENT"));
    assert.ok(safe.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
    await M(path + "/" + escaped.id + "/rsvp", "POST", { interested: true });
    await f.stop(); await f.start();
    assert.equal((await M(path)).data.events.find((e) => e.id === escaped.id).interested, true);
    await O(path + "/" + far.id + "/cancel", "POST", {});
    await O("/channels/" + privateVoice.id, "DELETE");
    assert.equal((await O(path + "?history=1")).data.events.find((e) => e.id === privateEvent.id).status, "cancelled");
    const expiring = (await O(path, "POST", { ...draft, name: "Short Event", startsAt: Date.now(), endsAt: Date.now() + 1200 })).data;
    await until(async () => (await O(path + "?history=1")).data.events.some((e) => e.id === expiring.id && e.status === "completed"), 5000);
  } finally { await f.cleanup(); }
});
