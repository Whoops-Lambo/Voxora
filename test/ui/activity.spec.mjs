import { test, expect } from "@playwright/test";
async function register(page, username) {
  await page.goto("/app");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("DISPLAY NAME").fill(username);
  await page.getByLabel("USERNAME").fill(username);
  await page.getByLabel("PASSWORD").fill("Fixture-password-543");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#shell")).toBeVisible();
}
async function createServer(owner, member, name) {
  const s = await (
    await owner.request.post("/api/servers", { data: { name } })
  ).json();
  expect(
    (
      await member.request.post("/api/invites/join", {
        data: { code: s.invite },
      })
    ).status(),
  ).toBe(200);
  await member
    .getByRole("button", { name: "Direct Messages", exact: true })
    .click();
  return { ...s, text: s.channels.find((c) => c.type === "text").id };
}
async function send(who, channel, text) {
  const r = await who.request.post("/api/messages", {
    data: { channel, text },
  });
  expect(r.status()).toBe(201);
  return r.json();
}
const overview = async (page) =>
  await (await page.request.get("/api/activity")).json();

test("persistent unread badges, inbox, manual unread and mute controls work across reload and devices", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    c = await browser.newContext();
  const owner = await a.newPage(),
    member = await b.newPage();
  const errors = [];
  member.on("pageerror", (e) => errors.push(e.message));
  try {
    await register(owner, "inbox_owner");
    await register(member, "inbox_member");
    const s = await createServer(owner, member, "Inbox Studio");
    const message = await send(
      owner,
      s.text,
      "A real mention for @inbox_member",
    );
    const rail = () =>
      member.getByRole("button", { name: "Inbox Studio", exact: true });
    await expect(rail().locator(".rail-mention-badge")).toHaveText("1");
    await member.reload();
    await expect(rail().locator(".rail-mention-badge")).toHaveText("1");
    await member.getByRole("button", { name: "Inbox", exact: true }).click();
    await expect(member.locator("#detail-panel .result-card")).toContainText(
      message.text,
    );
    await member.screenshot({
      path: "test-results/voxora-inbox.png",
      fullPage: true,
    });
    await member.bringToFront();
    await member
      .getByRole("button", {
        name: "Open message from inbox_owner",
        exact: true,
      })
      .click();
    await expect(member.locator("#message-" + message.id)).toBeVisible();
    await expect(
      member.getByRole("separator", { name: "New messages" }),
    ).toBeVisible();
    await expect
      .poll(async () => (await overview(member)).channels[s.text].unread)
      .toBe(0);
    await member.locator("#message-" + message.id).click({ button: "right" });
    await member
      .getByRole("button", { name: "Mark Unread from Here", exact: true })
      .click();
    await expect(member.locator("#new-messages-bar")).toContainText(
      "1 new message",
    );
    await expect
      .poll(async () => (await overview(member)).channels[s.text].manualUnread)
      .toBe(true);
    const login = await c.request.post("http://127.0.0.1:3490/api/auth/login", {
      data: { username: "inbox_member", password: "Fixture-password-543" },
    });
    expect(login.status()).toBe(200);
    const remote = await (
      await c.request.get("http://127.0.0.1:3490/api/activity")
    ).json();
    expect(remote.channels[s.text].unread).toBe(1);
    expect(
      (
        await c.request.post("http://127.0.0.1:3490/api/read-state", {
          data: {
            channel: s.text,
            messageId: message.id,
            version: remote.channels[s.text].version,
          },
        })
      ).status(),
    ).toBe(200);
    await expect(member.locator("#new-messages-bar")).toBeHidden();
    // Independent headless contexts report focus simultaneously. Emulate the OS focus
    // signal for the inactive-window branch, including across navigation.
    await member.addInitScript(() => {
      window.fixtureFocused = false;
      document.hasFocus = () => window.fixtureFocused;
    });
    await member.evaluate(() => {
      window.fixtureFocused = false;
      document.hasFocus = () => window.fixtureFocused;
    });
    await owner.bringToFront();
    await send(
      owner,
      s.text,
      "Unread while another window is active @inbox_member",
    );
    await expect(member.locator("#new-messages-bar")).toContainText(
      "1 new message",
    );
    expect(await member.evaluate(() => document.hasFocus())).toBe(false);
    await member.reload();
    await expect(member.locator("#new-messages-bar")).toContainText(
      "1 new message",
    );
    await member.bringToFront();
    await member.evaluate(() => {
      window.fixtureFocused = true;
      window.dispatchEvent(new Event("focus"));
    });
    await expect
      .poll(async () => (await overview(member)).channels[s.text].unread)
      .toBe(0);
    await member
      .getByRole("button", { name: "Direct Messages", exact: true })
      .click();
    await rail().click({ button: "right" });
    await member
      .getByRole("button", { name: "Mute Server", exact: true })
      .click();
    await send(owner, s.text, "Muted mention for @inbox_member");
    await expect
      .poll(async () => (await overview(member)).channels[s.text].unread)
      .toBe(1);
    await expect(rail().locator(".rail-mention-badge")).toHaveCount(0);
    await member.getByRole("button", { name: "Inbox", exact: true }).click();
    await member.getByRole("button", { name: "Unread", exact: true }).click();
    await expect(member.locator("#detail-panel")).toContainText(
      "1 unread · Muted",
    );
    await member
      .getByRole("button", { name: "Close Panel", exact: true })
      .click();
    await rail().click({ button: "right" });
    await member
      .getByRole("button", { name: "Unmute Server", exact: true })
      .click();
    await expect(rail().locator(".rail-mention-badge")).toHaveText("1");
    await rail().click({ button: "right" });
    await member
      .getByRole("button", { name: "Mark Server as Read", exact: true })
      .click();
    await expect(rail().locator(".rail-mention-badge")).toHaveCount(0);
    await member.setViewportSize({ width: 390, height: 844 });
    await member.getByRole("button", { name: "Inbox", exact: true }).click();
    await expect(member.locator("#detail-panel")).toContainText(
      "You’re all caught up",
    );
    await member.screenshot({
      path: "test-results/voxora-inbox-mobile.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([a.close(), b.close(), c.close()]);
  }
});

test("desktop alerts are opt-in, private by default and honor channel overrides, mute and Do Not Disturb", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const owner = await a.newPage(),
    member = await b.newPage();
  try {
    await member.addInitScript(() => {
      window.recordedNotifications = [];
      window.notificationRequests = 0;
      window.Notification = class {
        static permission = "default";
        static async requestPermission() {
          window.notificationRequests++;
          this.permission = "granted";
          return "granted";
        }
        constructor(title, options) {
          window.recordedNotifications.push({ title, ...options });
        }
        close() {}
      };
    });
    await register(owner, "alerts_owner");
    await register(member, "alerts_member");
    const s = await createServer(owner, member, "Alerts Lab");
    await send(owner, s.text, "Before opting in @alerts_member");
    await expect
      .poll(async () => (await overview(member)).channels[s.text].unread)
      .toBe(1);
    expect(await member.evaluate(() => window.notificationRequests)).toBe(0);
    expect(
      await member.evaluate(() => window.recordedNotifications.length),
    ).toBe(0);
    await member
      .getByRole("button", { name: "User Settings", exact: true })
      .click();
    await member
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    await member
      .getByRole("checkbox", { name: "Desktop notifications", exact: true })
      .check();
    expect(await member.evaluate(() => window.notificationRequests)).toBe(1);
    await expect(
      member.getByRole("checkbox", {
        name: "Show message previews",
        exact: true,
      }),
    ).not.toBeChecked();
    await member.screenshot({
      path: "test-results/voxora-notifications.png",
      fullPage: true,
    });
    await member.getByRole("button", { name: "Close", exact: true }).click();
    await send(owner, s.text, "Secret text for @alerts_member");
    await expect
      .poll(() => member.evaluate(() => window.recordedNotifications.length))
      .toBe(1);
    expect(
      await member.evaluate(() => window.recordedNotifications[0]),
    ).toMatchObject({
      title: "New message · Voxora",
      body: "You have a new message in Voxora.",
      silent: true,
    });
    await send(owner, s.text, "An ordinary message without a ping");
    await expect(
      member.getByRole("button", { name: "Alerts Lab", exact: true }),
    ).toHaveAttribute("aria-description", /^3 unread messages/);
    expect(
      await member.evaluate(() => window.recordedNotifications.length),
    ).toBe(1);
    await member
      .getByRole("button", { name: "Alerts Lab", exact: true })
      .click();
    await member
      .getByRole("button", { name: "general", exact: true })
      .click({ button: "right" });
    await member
      .getByRole("button", { name: "Notification Settings", exact: true })
      .click();
    await member
      .getByLabel("NOTIFICATION MODE", { exact: true })
      .selectOption("all");
    await member
      .getByRole("button", { name: "Save Notifications", exact: true })
      .click();
    await member
      .getByRole("button", { name: "Direct Messages", exact: true })
      .click();
    await send(owner, s.text, "Channel override allows ordinary messages");
    await expect
      .poll(() => member.evaluate(() => window.recordedNotifications.length))
      .toBe(2);
    const profile = await (await member.request.get("/api/state")).json();
    await member.locator("#user-controls .user-identity").click();
    await member
      .getByRole("button", { name: "Do Not Disturb", exact: true })
      .click();
    await expect
      .poll(async () => (await overview(member)).doNotDisturb)
      .toBe(true);
    const beforeDND = (await overview(member)).channels[s.text].unread;
    await send(owner, s.text, "DND suppresses @alerts_member");
    await expect(
      member.getByRole("button", { name: "Alerts Lab", exact: true }),
    ).toHaveAttribute(
      "aria-description",
      new RegExp("^" + (beforeDND + 1) + " unread messages"),
    );
    expect(
      await member.evaluate(() => window.recordedNotifications.length),
    ).toBe(2);
    await member.request.patch("/api/profile", { data: { status: "online" } });
    await expect
      .poll(async () => (await overview(member)).doNotDisturb)
      .toBe(false);
    await member
      .getByRole("button", { name: "Alerts Lab", exact: true })
      .click({ button: "right" });
    await member
      .getByRole("button", { name: "Mute Server", exact: true })
      .click();
    const beforeMute = (await overview(member)).channels[s.text].unread;
    await send(
      owner,
      s.text,
      "Muted server overrides channel alerts @alerts_member",
    );
    await expect(
      member.getByRole("button", { name: "Alerts Lab", exact: true }),
    ).toHaveAttribute(
      "aria-description",
      new RegExp("^" + (beforeMute + 1) + " unread messages"),
    );
    expect((await overview(member)).channels[s.text].muted).toBe(true);
    expect(
      await member.evaluate(() => window.recordedNotifications.length),
    ).toBe(2);
    await member
      .getByRole("button", { name: "Alerts Lab", exact: true })
      .click({ button: "right" });
    await member
      .getByRole("button", { name: "Unmute Server", exact: true })
      .click();
    await member
      .getByRole("button", { name: "User Settings", exact: true })
      .click();
    await member
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    await member
      .getByRole("checkbox", { name: "Show message previews", exact: true })
      .check();
    await member.getByRole("button", { name: "Close", exact: true }).click();
    await send(owner, s.text, "Preview explicitly enabled");
    await expect
      .poll(() => member.evaluate(() => window.recordedNotifications.length))
      .toBe(3);
    expect(
      await member.evaluate(() => window.recordedNotifications.at(-1)),
    ).toMatchObject({
      title: "alerts_owner · #general",
      body: "Preview explicitly enabled",
    });
    expect(profile.me.username).toBe("alerts_member");
  } finally {
    await a.close();
    await b.close();
  }
});

test("inbox can jump to messages outside the latest 200 and page forward without acknowledging unseen history", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    c = await browser.newContext();
  const owner = await a.newPage(),
    member = await b.newPage();
  try {
    await register(owner, "history_owner");
    await register(member, "history_member");
    const s = await createServer(owner, member, "History Lab");
    await owner.goto("about:blank");
    expect(
      (
        await c.request.post("http://127.0.0.1:3490/api/auth/register", {
          data: {
            username: "history_writer",
            password: "Fixture-password-654",
          },
        })
      ).status(),
    ).toBe(200);
    await c.request.post("http://127.0.0.1:3490/api/invites/join", {
      data: { code: s.invite },
    });
    const first = await send(
      owner,
      s.text,
      "An older mention for @history_member",
    );
    for (let start = 0; start < 225; start += 15) {
      const requests = Array.from(
        { length: Math.min(15, 225 - start) },
        (_, i) => {
          const index = start + i;
          return (index < 120 ? owner.request : c.request).post(
            "http://127.0.0.1:3490/api/messages",
            { data: { channel: s.text, text: "History line " + index } },
          );
        },
      );
      const results = await Promise.all(requests);
      expect(results.every((r) => r.status() === 201)).toBe(true);
    }
    await expect
      .poll(async () => (await overview(member)).channels[s.text].unread)
      .toBe(226);
    await member.route("**/api/messages?*around=*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.continue();
    });
    await member.bringToFront();
    await member.getByRole("button", { name: "Inbox", exact: true }).click();
    await member
      .getByRole("button", {
        name: "Open message from history_owner",
        exact: true,
      })
      .click();
    await expect(member.locator("#message-" + first.id)).toBeVisible();
    await expect(
      member.getByRole("button", { name: "Jump to Present", exact: true }),
    ).toBeVisible();
    expect((await overview(member)).channels[s.text].unread).toBeGreaterThan(0);
    await member
      .getByRole("button", { name: "Load newer messages", exact: true })
      .click();
    await expect(member.locator("#message-list")).toContainText(
      "History line 224",
    );
    await member
      .getByRole("button", { name: "Jump to Present", exact: true })
      .count()
      .then(async (count) => {
        if (count)
          await member
            .getByRole("button", { name: "Jump to Present", exact: true })
            .click();
        else
          await member.locator("#chat-scroll").evaluate((e) => {
            e.scrollTop = e.scrollHeight;
          });
      });
    await expect
      .poll(async () => (await overview(member)).channels[s.text].unread)
      .toBe(0);
  } finally {
    await Promise.all([a.close(), b.close(), c.close()]);
  }
});
