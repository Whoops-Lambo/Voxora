import { test, expect } from "@playwright/test";
import { VoxoraBot } from "../../sdk/voxora.mjs";

async function register(page, username) {
  await page.goto("/app");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("DISPLAY NAME").fill(username);
  await page.getByLabel("USERNAME").fill(username);
  await page.getByLabel("PASSWORD").fill("Fixture-password-432");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#shell")).toBeVisible();
}
async function server(owner, name) {
  const s = await (
    await owner.request.post("/api/servers", { data: { name } })
  ).json();
  await owner.getByRole("button", { name, exact: true }).click();
  return s;
}
async function integrations(page) {
  await page.locator("#sidebar-top .server-heading").click();
  await page
    .getByRole("button", { name: "Server Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Bots & Apps", exact: true }).click();
}

test("install Voxora Helper, run slash commands, and vote in polls with live results", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const owner = await a.newPage(),
    member = await b.newPage();
  const errors = [];
  owner.on("pageerror", (e) => errors.push(e.message));
  member.on("pageerror", (e) => errors.push(e.message));
  try {
    await register(owner, "helper_owner");
    await register(member, "helper_member");
    const s = await server(owner, "Helper Hangout");
    await member.request.post("/api/invites/join", {
      data: { code: s.invite },
    });
    await member.getByRole("button", { name: s.name, exact: true }).click();
    await integrations(owner);
    await owner.getByRole("button", { name: "Add a Bot", exact: true }).click();
    await owner
      .getByLabel("CHOOSE A BOT", { exact: true })
      .selectOption("voxora-helper");
    await owner
      .getByRole("button", { name: "Install Bot", exact: true })
      .click();
    await expect(owner.locator(".bot-card")).toContainText("Voxora Helper");
    await owner.screenshot({
      path: "test-results/voxora-bot-integrations.png",
      fullPage: true,
    });
    await owner.getByRole("button", { name: "Close", exact: true }).click();
    await owner.locator("#message-input").fill("/pi");
    await owner
      .getByRole("button", { name: "/ping · Voxora Helper", exact: true })
      .click();
    await owner.locator("#message-input").press("Enter");
    await expect(member.locator("#message-list")).toContainText(
      "Pong! Voxora Helper is online.",
    );
    await expect(
      member
        .locator(".message-row")
        .filter({ hasText: "Pong!" })
        .locator(".bot-tag"),
    ).toHaveText("BOT");
    await member
      .getByRole("button", { name: "Create Poll", exact: true })
      .click();
    await member
      .getByLabel("QUESTION", { exact: true })
      .fill("What should we play?");
    await member
      .getByLabel("ANSWER 1", { exact: true })
      .fill("Co-op adventure");
    await member.getByLabel("ANSWER 2", { exact: true }).fill("Party games");
    await member
      .getByRole("button", { name: "Post Poll", exact: true })
      .click();
    const poll = () =>
      owner.locator(".poll-card").filter({ hasText: "What should we play?" });
    await expect(poll()).toBeVisible();
    await poll()
      .getByRole("button", { name: "Co-op adventure", exact: true })
      .click();
    await member
      .locator(".poll-card")
      .getByRole("button", { name: "Party games", exact: true })
      .click();
    await expect(poll()).toContainText("2 votes");
    await owner.screenshot({
      path: "test-results/voxora-polls.png",
      fullPage: true,
    });
    await member.reload();
    await expect(
      member
        .locator(".poll-card")
        .getByRole("button", { name: "Party games", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await member
      .locator(".poll-card")
      .getByRole("button", { name: "End Poll", exact: true })
      .click();
    await expect(poll()).toContainText("Poll ended");
    await expect(
      poll().getByRole("button", { name: "Co-op adventure", exact: true }),
    ).toBeDisabled();
    await integrations(owner);
    await owner.getByRole("button", { name: "Pause Bot", exact: true }).click();
    await expect(owner.locator(".bot-card")).toContainText("Paused");
    await owner.getByRole("button", { name: "Close", exact: true }).click();
    await member.locator("#message-input").fill("/ping");
    await expect(member.locator("#command-picker")).toContainText(
      "No commands available",
    );
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});

test("developer portal creates a one-time token, installs a custom bot and runs an SDK slash command", async ({
  page,
}) => {
  let bot, connection;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await register(page, "portal_developer");
    const s = await server(page, "Developer Sandbox");
    await page.goto("/developers");
    await expect(
      page.getByRole("heading", { name: "Developer Portal", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "New Application", exact: true })
      .click();
    await page
      .getByLabel("APPLICATION NAME", { exact: true })
      .fill("Browser Bot");
    await page
      .getByLabel("DESCRIPTION", { exact: true })
      .fill("A custom bot built from the portal.");
    await expect(page.getByLabel('APPLICATION NAME',{exact:true})).toHaveValue('Browser Bot');
    await expect(page.getByLabel('DESCRIPTION',{exact:true})).toHaveValue('A custom bot built from the portal.');
    await page
      .getByRole("button", { name: "Create Application", exact: true })
      .click();
    const token = await page
      .getByLabel("BOT TOKEN", { exact: true })
      .inputValue();
    expect(token.startsWith("vxb_")).toBe(true);
    await expect(page.getByLabel("BOT TOKEN", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
    const id = await page
      .getByLabel("APPLICATION ID", { exact: true })
      .inputValue();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.locator(".bot-card")).toContainText("Browser Bot");
    await page.screenshot({
      path: "test-results/voxora-developer-portal.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Install Bot", exact: true })
      .click();
    await page
      .getByLabel("INSTALL IN SERVER", { exact: true })
      .selectOption(s.id);
    await page
      .locator("#modal")
      .getByRole("button", { name: "Install Bot", exact: true })
      .click();
    bot = new VoxoraBot({ url: "http://127.0.0.1:3490", token });
    await bot.registerCommands([
      { name: "echo", description: "Echo your text" },
    ]);
    bot.on("error", (e) => errors.push("SDK " + e.message));
    bot.on("interaction", (i) => i.respond("Custom bot says: " + i.arguments));
    connection = bot.connect();
    await page.goto("/app");
    await page
      .locator("#server-rail")
      .getByRole("button", { name: s.name, exact: true })
      .click();
    await page.locator("#message-input").fill("/ec");
    await page
      .getByRole("button", { name: "/echo · Browser Bot", exact: true })
      .click();
    await page
      .locator("#message-input")
      .pressSequentially("Hello from the portal");
    await page.locator("#message-input").press("Enter");
    await expect(page.locator("#message-list")).toContainText(
      "Custom bot says: Hello from the portal",
    );
    await expect(
      page
        .locator(".message-row")
        .filter({ hasText: "Custom bot says:" })
        .locator(".bot-tag"),
    ).toHaveText("BOT");
    const listing = await (await page.request.get("/api/applications")).json();
    expect(JSON.stringify(listing).includes(token)).toBe(false);
    expect(listing.find((a) => a.id === id).hasToken).toBe(true);
    const kit = await page.request.get("/downloads/voxora-bot-starter.zip");
    expect(kit.status()).toBe(200);
    expect(kit.headers()["content-type"]).toContain("application/zip");
    expect(errors).toEqual([]);
  } finally {
    bot?.close();
    if (connection) await connection.catch(() => {});
  }
});
