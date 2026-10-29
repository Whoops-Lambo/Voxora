import { test, expect } from "@playwright/test";

async function register(page, name, display) {
  await page.goto("/");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("DISPLAY NAME").fill(display);
  await page.getByLabel("USERNAME").fill(name);
  await page.getByLabel("PASSWORD").fill("Fixture-password-962");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#message-input")).toBeVisible();
}
async function openChannels(page) {
  await page.locator("#sidebar-top .server-heading").click();
  await page
    .getByRole("button", { name: "Server Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Channels", exact: true }).click();
}
async function createCategory(page, name) {
  await page
    .getByRole("button", { name: "Create Category", exact: true })
    .click();
  await page.getByLabel("CATEGORY NAME").fill(name);
  await page
    .getByRole("button", { name: "Create Category", exact: true })
    .click();
  await expect(page.locator(".channel-manager")).toContainText(name);
}
async function createChannel(page, name, delay = "0", privateChannel = false) {
  await page
    .getByRole("button", { name: "Create Channel", exact: true })
    .last()
    .click();
  await page.getByLabel("CHANNEL NAME").fill(name);
  await page
    .getByLabel("CATEGORY", { exact: true })
    .selectOption({ label: "Projects" });
  await page.getByLabel("SLOWMODE (SECONDS)").fill(delay);
  if (privateChannel)
    await page
      .getByRole("checkbox", { name: "Private Channel", exact: true })
      .check();
  await page
    .locator("#modal")
    .getByRole("button", { name: "Create Channel", exact: true })
    .click();
  await expect(page.locator(".channel-manager")).toContainText("# " + name);
}
async function saveSendOverride(page, value) {
  await page.getByLabel("ROLE OR MEMBER").selectOption("role:everyone");
  await page
    .getByLabel("Send Messages override", { exact: true })
    .selectOption(value);
  await page
    .getByRole("button", { name: "Save Permissions", exact: true })
    .click();
  await expect(page.locator("#modal")).not.toBeVisible();
}

test("organize categories with drag and move controls, inherit permissions, keep private channels hidden and preserve slowmode across reload", async ({
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
    await register(owner, "channels_owner", "Channel Owner");
    await register(member, "channels_member", "Channel Member");
    await owner
      .getByRole("button", { name: "Add a Server", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Create My Own", exact: true })
      .click();
    await owner.getByLabel("SERVER NAME").fill("Creator Studio");
    await owner.getByRole("button", { name: "Create", exact: true }).click();
    await expect(owner.locator("#sidebar-top")).toContainText("Creator Studio");
    const state = await (await owner.request.get("/api/state")).json();
    const server = state.servers.find((s) => s.name === "Creator Studio");
    expect(
      (
        await member.request.post("/api/invites/join", {
          data: { code: server.invite },
        })
      ).status(),
    ).toBe(200);
    await member
      .getByRole("button", { name: "Creator Studio", exact: true })
      .click();
    await expect(member.locator("#sidebar-top")).toContainText(
      "Creator Studio",
    );
    await openChannels(owner);
    await createCategory(owner, "Projects");
    await createCategory(owner, "Lounge");
    await createChannel(owner, "alpha", "4");
    await createChannel(owner, "beta");
    await createChannel(owner, "secret", "0", true);
    await expect(
      member
        .locator("#channel-list")
        .getByRole("button", { name: "alpha", exact: true }),
    ).toBeVisible();
    await expect(
      member
        .locator("#channel-list")
        .getByRole("button", { name: "secret", exact: true }),
    ).toHaveCount(0);
    const project = () =>
      owner.locator(".layout-category").filter({ hasText: "Projects" });
    const channelRow = (name) =>
      owner
        .locator(".layout-channel")
        .filter({ has: owner.getByText("# " + name, { exact: true }) });
    await channelRow("beta").dragTo(channelRow("alpha"));
    await expect(project().locator(".layout-channel-label strong")).toHaveText([
      "# beta",
      "# alpha",
      "# secret",
    ]);
    await owner
      .getByRole("button", { name: "Move channel beta down", exact: true })
      .click();
    await expect(project().locator(".layout-channel-label strong")).toHaveText([
      "# alpha",
      "# beta",
      "# secret",
    ]);
    await owner
      .getByRole("button", { name: "Move category Lounge up", exact: true })
      .click();
    await expect(owner.locator(".layout-category-heading > strong")).toHaveText(
      ["No category", "TEXT CHANNELS", "VOICE CHANNELS", "Lounge", "Projects"],
    );
    await project().scrollIntoViewIfNeeded();
    await owner.screenshot({
      path: "test-results/voxora-channels.png",
      fullPage: true,
    });

    await member.getByRole("button", { name: "alpha", exact: true }).click();
    await owner
      .getByRole("button", {
        name: "Permissions for category Projects",
        exact: true,
      })
      .click();
    await saveSendOverride(owner, "deny");
    await expect(member.locator("#message-input")).toBeDisabled();
    await openChannels(owner);
    await owner
      .getByRole("button", {
        name: "Permissions for channel alpha",
        exact: true,
      })
      .click();
    await saveSendOverride(owner, "allow");
    await expect(member.locator("#message-input")).toBeEnabled();

    await openChannels(owner);
    await owner
      .getByRole("button", {
        name: "Move channel beta to category",
        exact: true,
      })
      .click();
    await owner
      .getByLabel("DESTINATION CATEGORY")
      .selectOption({ label: "Lounge" });
    await owner
      .getByRole("button", { name: "Move Channel", exact: true })
      .click();
    await expect(
      owner.locator(".layout-category").filter({ hasText: "Lounge" }),
    ).toContainText("# beta");
    await member.getByRole("button", { name: "beta", exact: true }).click();
    await expect(member.locator("#message-input")).toBeDisabled();
    await owner
      .getByRole("button", { name: "Sync permissions for beta", exact: true })
      .click();
    await owner.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(member.locator("#message-input")).toBeEnabled();
    await expect(channelRow("beta")).toContainText("Synced");

    await owner
      .getByRole("button", { name: "Delete category Projects", exact: true })
      .click();
    await owner.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      owner
        .locator(".layout-category-heading > strong")
        .filter({ hasText: "Projects" }),
    ).toHaveCount(0);
    await expect(
      owner.locator(".layout-category").filter({ hasText: "No category" }),
    ).toContainText("# alpha");
    await expect(
      member
        .locator("#channel-list")
        .getByRole("button", { name: "secret", exact: true }),
    ).toHaveCount(0);
    await owner.getByRole("button", { name: "Close", exact: true }).click();
    await owner.getByRole("button", { name: "alpha", exact: true }).click();
    await member.getByRole("button", { name: "alpha", exact: true }).click();
    await member.locator("#message-input").fill("First slowmode message");
    await member.locator("#message-input").press("Enter");
    await expect(member.locator("#message-list")).toContainText(
      "First slowmode message",
    );
    await expect(
      member.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    await expect(member.locator("#slowmode-status")).toContainText(
      "You can send again",
    );
    await member
      .locator("#message-input")
      .fill("Preserved draft during slowmode");
    await member.locator("#message-input").press("Enter");
    await expect(owner.locator("#message-list")).not.toContainText(
      "Preserved draft during slowmode",
    );
    await member.reload();
    await expect(member.locator("#message-input")).toHaveValue(
      "Preserved draft during slowmode",
    );
    await expect(
      member.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    await expect(
      member.getByRole("button", { name: "Send message", exact: true }),
    ).toBeEnabled({ timeout: 6500 });
    await member.locator("#message-input").press("Enter");
    await expect(owner.locator("#message-list")).toContainText(
      "Preserved draft during slowmode",
    );
    await expect(owner.locator("#slowmode-status")).toContainText(
      "You are exempt",
    );
    await member.screenshot({
      path: "test-results/voxora-slowmode.png",
      fullPage: true,
    });
    await openChannels(owner);
    await owner.setViewportSize({ width: 390, height: 844 });
    await expect(owner.locator(".channel-manager")).toBeVisible();
    expect(
      await owner
        .locator(".layout-category-heading > strong")
        .first()
        .evaluate((e) => e.getBoundingClientRect().width),
    ).toBeGreaterThan(100);
    expect(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await owner.screenshot({
      path: "test-results/voxora-channels-mobile.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});
