import { test, expect } from "@playwright/test";
import { fixture } from "../support/server.mjs";

let featureServer;
test.beforeAll(async () => { featureServer = await fixture(); });
test.afterAll(async () => { await featureServer?.cleanup(); });

async function register(page, name) {
  await page.goto("/app");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("DISPLAY NAME").fill(name); await page.getByLabel("USERNAME").fill(name);
  await page.getByLabel("PASSWORD").fill("Fixture-password-736");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#message-input")).toBeVisible();
}
const selectServer = (page, name) => page.locator("#server-rail").getByRole("button", { name, exact: true }).click();
async function menu(page, name) {
  await page.locator("#sidebar-top .server-heading").click();
  await page.locator("#context-menu").getByRole("button", { name, exact: true }).click();
}
const card = (page, name) => page.locator("#modal .community-card").filter({ has: page.getByRole("heading", { name, exact: true }) });

test("opt in to Discovery, search and join a community without exposing private channels", async ({ browser }) => {
  const a = await browser.newContext({ baseURL: featureServer.origin }), b = await browser.newContext({ baseURL: featureServer.origin }), errors = [];
  const owner = await a.newPage(), visitor = await b.newPage();
  for (const page of [owner, visitor]) page.on("pageerror", (e) => errors.push(e.message));
  try {
    await register(owner, "discovery_ui_owner"); await register(visitor, "discovery_ui_visitor");
    const s = await (await owner.request.post("/api/servers", { data: { name: "Voxora Design Studio" } })).json();
    await owner.request.post("/api/servers/" + s.id + "/channels", { data: { name: "hidden-plans", private: true } });
    await owner.reload(); await selectServer(owner, s.name);
    await menu(owner, "Server Settings"); await owner.getByRole("button", { name: "Discovery", exact: true }).click();
    await owner.getByLabel("List this server in Discovery", { exact: true }).check();
    await owner.getByLabel("PUBLIC SUMMARY").fill("A place to share art and build better communities.");
    await owner.getByLabel("SERVER CATEGORY").selectOption("Creators");
    await owner.getByLabel("TAGS (UP TO 5, COMMA SEPARATED)").fill("design, friendly");
    await owner.getByRole("button", { name: "Save Listing", exact: true }).click();
    await expect(owner.locator("#toast-stack")).toContainText("Server listed");
    await visitor.getByRole("button", { name: "Discover Servers", exact: true }).click();
    await visitor.getByLabel("SEARCH PUBLIC SERVERS").fill("no-matching-community");
    await expect(visitor.locator("#modal .community-card")).toHaveCount(0);
    await visitor.getByLabel("SEARCH PUBLIC SERVERS").fill("design");
    await visitor.getByLabel("DISCOVERY CATEGORY").selectOption("Creators");
    await expect(card(visitor, s.name)).toContainText("A place to share art");
    await expect(visitor.locator("#modal")).not.toContainText("hidden-plans");
    await visitor.screenshot({ path: "test-results/voxora-discovery.png", fullPage: true });
    await visitor.setViewportSize({ width: 390, height: 844 });
    await visitor.screenshot({ path: "test-results/voxora-discovery-mobile.png", fullPage: true });
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card(visitor, s.name).getByRole("button", { name: "Join Server", exact: true }).click();
    await expect(visitor.locator("#modal")).not.toBeVisible();
    await expect(visitor.locator("#sidebar-top")).toContainText(s.name);
    await expect(visitor.getByRole("button", { name: "hidden-plans", exact: true })).toHaveCount(0);
    await owner.getByLabel("List this server in Discovery", { exact: true }).uncheck();
    await owner.getByRole("button", { name: "Save Listing", exact: true }).click();
    await expect(owner.locator("#toast-stack")).toContainText("Discovery listing disabled");
    await visitor.getByRole("button", { name: "Discover Servers", exact: true }).click();
    await visitor.getByLabel("SEARCH PUBLIC SERVERS").fill(s.name);
    await expect(visitor.locator("#modal")).toContainText("No servers match yet");
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});

test("create from a preset, share its layout by code, import as a new owner and revoke the code", async ({ browser }) => {
  const a = await browser.newContext({ baseURL: featureServer.origin }), b = await browser.newContext({ baseURL: featureServer.origin }), errors = [];
  const owner = await a.newPage(), creator = await b.newPage();
  for (const page of [owner, creator]) page.on("pageerror", (e) => errors.push(e.message));
  try {
    await register(owner, "layout_ui_owner"); await register(creator, "layout_ui_creator");
    await owner.getByRole("button", { name: "Add a Server", exact: true }).click();
    await owner.getByRole("button", { name: "Use a Template", exact: true }).click();
    await expect(owner.locator("#modal .community-card")).toHaveCount(4);
    await card(owner, "Gaming").getByRole("button", { name: "Use Template", exact: true }).click();
    await owner.getByLabel("SERVER NAME").fill("Raid Night");
    await owner.getByRole("button", { name: "Create from Template", exact: true }).click();
    await expect(owner.locator("#sidebar-top")).toContainText("Raid Night");
    await expect(owner.getByRole("button", { name: "matchmaking", exact: true })).toBeVisible();
    await menu(owner, "Create Server Template");
    await owner.getByLabel("TEMPLATE NAME").fill("Our Gaming Layout");
    await owner.getByLabel("TEMPLATE DESCRIPTION").fill("Gaming rooms, announcements, and private staff channels.");
    await owner.getByRole("button", { name: "Create Template Code", exact: true }).click();
    const code = await owner.getByLabel("TEMPLATE CODE", { exact: true }).inputValue(); expect(code).toMatch(/^[a-f0-9]{24}$/);
    await creator.getByRole("button", { name: "Add a Server", exact: true }).click();
    await creator.getByRole("button", { name: "Use a Template", exact: true }).click();
    await creator.getByRole("button", { name: "Use a Template Code", exact: true }).click();
    await creator.getByLabel("TEMPLATE CODE", { exact: true }).fill(code);
    await creator.getByRole("button", { name: "Preview Template", exact: true }).click();
    await creator.getByLabel("SERVER NAME").fill("My Raid Crew");
    await creator.getByRole("button", { name: "Create from Template", exact: true }).click();
    await expect(creator.locator("#sidebar-top")).toContainText("My Raid Crew");
    const state = await (await creator.request.get("/api/state")).json(), server = state.servers.find((s) => s.name === "My Raid Crew");
    expect(server.ownerId).toBe(state.me.id); expect(server.members).toEqual([state.me.id]);
    expect(server.channels.some((c) => c.name === "moderators")).toBe(true);
    await owner.getByRole("button", { name: "My Templates", exact: true }).click();
    await expect(card(owner, "Our Gaming Layout")).toBeVisible();
    await owner.screenshot({ path: "test-results/voxora-server-templates.png", fullPage: true });
    await card(owner, "Our Gaming Layout").getByRole("button", { name: "Revoke", exact: true }).click();
    await owner.locator("#modal").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(card(owner, "Our Gaming Layout")).toHaveCount(0);
    expect((await creator.request.get("/api/server-templates/" + code)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});

test("schedule events, synchronize RSVPs, export a calendar and manage the event lifecycle", async ({ browser }) => {
  const a = await browser.newContext({ baseURL: featureServer.origin }), b = await browser.newContext({ baseURL: featureServer.origin }), errors = [];
  const owner = await a.newPage(), member = await b.newPage();
  for (const page of [owner, member]) page.on("pageerror", (e) => errors.push(e.message));
  try {
    await register(owner, "events_ui_owner"); await register(member, "events_ui_member");
    const s = await (await owner.request.post("/api/servers", { data: { name: "Weekend Club" } })).json();
    await member.request.post("/api/invites/join", { data: { code: s.invite } });
    const privateVoice = await (await owner.request.post("/api/servers/" + s.id + "/channels", { data: { name: "staff-voice", type: "voice", private: true } })).json();
    await owner.request.post("/api/servers/" + s.id + "/events", { data: { name: "Staff Planning", kind: "voice", channelId: privateVoice.id, startsAt: Date.now() + 3600000, endsAt: Date.now() + 7200000 } });
    await owner.reload(); await member.reload(); await selectServer(owner, s.name); await selectServer(member, s.name);
    await menu(member, "Events"); await expect(member.locator("#modal")).not.toContainText("Staff Planning");
    await expect(member.getByRole("button", { name: "Schedule Event", exact: true })).toBeHidden();
    await owner.getByRole("button", { name: "Server Events", exact: true }).click();
    await owner.getByRole("button", { name: "Schedule Event", exact: true }).click();
    await owner.getByLabel("EVENT NAME").fill("Friday Community Night");
    await owner.getByLabel("EVENT DESCRIPTION").fill("Bring your ideas and questions.");
    const times = await owner.evaluate(() => { const format = (ms) => { const d = new Date(ms); return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }; return [format(Date.now() + 120000), format(Date.now() + 3600000)]; });
    await owner.getByLabel("START TIME").fill(times[0]); await owner.getByLabel("END TIME").fill(times[1]);
    await owner.getByLabel("EVENT LOCATION TYPE", { exact: true }).selectOption("external");
    await owner.getByLabel("EVENT LOCATION", { exact: true }).fill("https://example.com/community");
    await owner.getByRole("button", { name: "Create Event", exact: true }).click();
    await expect(card(member, "Friday Community Night")).toBeVisible();
    await card(member, "Friday Community Night").getByRole("button", { name: "Interested", exact: true }).click();
    await expect(card(owner, "Friday Community Night")).toContainText("1 interested");
    await expect(card(member, "Friday Community Night").getByRole("button", { name: "Not Interested", exact: true })).toBeVisible();
    const downloadPromise = member.waitForEvent("download");
    await card(member, "Friday Community Night").getByRole("link", { name: "Add to Calendar", exact: true }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/^voxora-event-.*\.ics$/);
    await card(owner, "Friday Community Night").getByRole("button", { name: "Start Event", exact: true }).click();
    await expect(card(member, "Friday Community Night")).toContainText("ACTIVE");
    await member.screenshot({ path: "test-results/voxora-scheduled-events.png", fullPage: true });
    await member.setViewportSize({ width: 390, height: 844 });
    await member.screenshot({ path: "test-results/voxora-scheduled-events-mobile.png", fullPage: true });
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card(owner, "Friday Community Night").getByRole("button", { name: "Complete Event", exact: true }).click();
    await owner.getByRole("button", { name: "Past Events", exact: true }).click();
    await expect(card(owner, "Friday Community Night")).toContainText("COMPLETED");
    await expect(card(member, "Friday Community Night")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});
