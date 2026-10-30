import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";

async function register(page, username) {
  await page.goto("/app");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("DISPLAY NAME").fill(username);
  await page.getByLabel("USERNAME").fill(username);
  await page.getByLabel("PASSWORD").fill("Fixture-password-626");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#message-input")).toBeVisible();
}
async function selectServer(page, server) {
  await page.locator("#server-rail").getByRole("button", { name: server.name, exact: true }).click();
}
async function send(page, text) {
  await page.locator("#message-input").fill(text);
  await page.locator("#message-input").press("Enter");
}

test("create announcement channels, follow into another server, publish attachments and unfollow", async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const owner = await a.newPage(), reader = await b.newPage(), errors = [];
  owner.on("pageerror", (e) => errors.push(e.message)); reader.on("pageerror", (e) => errors.push(e.message));
  try {
    await register(owner, "announcement_owner"); await register(reader, "announcement_reader");
    const source = await (await owner.request.post("/api/servers", { data: { name: "Platform News" } })).json();
    const destination = await (await owner.request.post("/api/servers", { data: { name: "Following Community" } })).json();
    await reader.request.post("/api/invites/join", { data: { code: destination.invite } });
    await owner.reload(); await reader.reload(); await selectServer(owner, source); await selectServer(reader, destination);
    await owner.locator("#sidebar-top .server-heading").click();
    await owner.getByRole("button", { name: "Server Settings", exact: true }).click();
    await owner.getByRole("button", { name: "Channels", exact: true }).click();
    await owner.getByRole("button", { name: "Create Channel", exact: true }).last().click();
    await owner.getByRole("radio", { name: /Announcement/ }).check();
    await owner.getByLabel("CHANNEL NAME").fill("release-news");
    await owner.locator("#modal").getByRole("button", { name: "Create Channel", exact: true }).click();
    await expect(owner.locator(".channel-manager")).toContainText("release-news");
    await owner.locator("#modal-close").click();
    await owner.getByRole("button", { name: "release-news", exact: true }).click();
    await owner.getByRole("button", { name: "Follow", exact: true }).click();
    await owner.getByLabel("DESTINATION SERVER").selectOption(destination.id);
    await owner.getByLabel("DESTINATION CHANNEL").selectOption(destination.channels[0].id);
    await owner.getByRole("button", { name: "Follow Channel", exact: true }).click();
    await expect(owner.locator("#modal")).not.toBeVisible();
    await owner.locator("#file-input").setInputFiles({ name: "release.txt", mimeType: "text/plain", buffer: Buffer.from("Release notes") });
    await send(owner, "Our first published announcement");
    const original = owner.locator(".message-row").filter({ hasText: "Our first published announcement" });
    await expect(original).toBeVisible();
    await expect(reader.locator("#message-list")).not.toContainText("Our first published announcement");
    await original.hover(); await original.getByRole("button", { name: "Publish Announcement", exact: true }).click();
    await owner.locator("#modal").getByRole("button", { name: "Confirm", exact: true }).click();
    const received = reader.locator(".message-row").filter({ hasText: "Our first published announcement" });
    await expect(received).toContainText("Published from Platform News · #release-news");
    await expect(received).toContainText("release.txt");
    await expect(original).toContainText("Published · 1 following channel(s)");
    await reader.screenshot({ path: "test-results/voxora-announcements.png", fullPage: true });
    await selectServer(owner, destination);
    await owner.getByRole("button", { name: "general", exact: true }).click({ button: "right" });
    await owner.getByRole("button", { name: "Following", exact: true }).click();
    await expect(owner.locator("#modal")).toContainText("Platform News · #release-news");
    await owner.getByRole("button", { name: "Unfollow", exact: true }).click();
    await expect(owner.locator("#modal")).toContainText("not following any announcement");
    expect(errors).toEqual([]);
    await reader.setViewportSize({ width: 390, height: 844 });
    await reader.screenshot({ path: "test-results/voxora-announcements-mobile.png", fullPage: true });
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await a.close(); await b.close(); }
});

test("the actual community bot template awards credits, handles purchases and moderates from slash commands", async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  // Let activity summaries and invocation updates overtake bot replies, as
  // happens on slow live connections. Replies must still reach the live view.
  await a.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      set onmessage(listener) {
        super.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === "message" && data.message.bot)
            setTimeout(() => listener.call(this, event), 350);
          else listener.call(this, event);
        };
      }
      get onmessage() { return super.onmessage; }
    };
  });
  const owner = await a.newPage(), member = await b.newPage();
  const data = await mkdtemp("/tmp/voxora-community-ui-");
  let child, output = "", errors = "";
  try {
    await register(owner, "template_owner"); await register(member, "template_member");
    const server = await (await owner.request.post("/api/servers", { data: { name: "Community Bot Lab" } })).json();
    await member.request.post("/api/invites/join", { data: { code: server.invite } });
    const app = await (await owner.request.post("/api/applications", { data: { name: "Community Bot" } })).json();
    const base = "/api/servers/" + server.id;
    await owner.request.post(base + "/bots", { data: { applicationId: app.application.id } });
    const role = await (await owner.request.post(base + "/roles", { data: { name: "Bot Moderator", permissions: ["moderateMembers", "kickMembers", "banMembers", "manageMessages"] } })).json();
    await owner.request.patch(base + "/members/" + app.application.userId, { data: { roles: [role.id] } });
    const botEnv = { ...process.env }; delete botEnv.FORCE_COLOR;
    child = spawn(process.execPath, ["examples/echo-bot.mjs"], { cwd: process.cwd(), env: { ...botEnv, VOXORA_URL: "http://127.0.0.1:3490", VOXORA_BOT_TOKEN: app.token, VOXORA_BOT_DATA_DIR: data }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => output += d); child.stderr.on("data", (d) => errors += d);
    await expect.poll(() => output).toContain("25 commands ready");
    await owner.reload(); await member.reload(); await selectServer(owner, server); await selectServer(member, server);
    async function command(page, name, args = "") {
      await page.locator("#message-input").fill("/" + name);
      await page.getByRole("button", { name: "/" + name + " · Community Bot", exact: true }).click();
      if (args) await page.locator("#message-input").pressSequentially(args);
      await page.locator("#message-input").press("Enter");
    }
    await command(owner, "daily"); await expect(owner.locator("#message-list")).toContainText("earned 250 credits");
    await command(owner, "buy", "bronze"); await expect(owner.locator("#message-list")).toContainText("Bought Bronze badge");
    await command(owner, "inventory"); await expect(owner.locator("#message-list")).toContainText("template_owner's inventory");
    await command(owner, "warn", "@template_member Follow the rules");
    await expect(owner.locator("#message-list")).toContainText("Warned template_member");
    await command(owner, "warnings", "@template_member"); await expect(owner.locator("#message-list")).toContainText("has 1 warning(s)");
    await command(member, "warn", "@template_owner Not allowed"); await expect(member.locator("#message-list")).toContainText("Both the command user and the bot need moderateMembers");
    await owner.screenshot({ path: "test-results/voxora-community-bot.png", fullPage: true });
    expect(errors.split("\n").filter((line) => line && !line.includes("Both the command user and the bot need moderateMembers"))).toEqual([]);
    expect(output.includes(app.token)).toBe(false);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const done = once(child, "exit"); child.kill(); await done; }
    await a.close(); await b.close(); await rm(data, { recursive: true, force: true });
  }
});
