import { test, expect } from "@playwright/test";
const password = "Test-user-password-482";
async function register(page, username, displayName) {
  await page.goto("/");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("DISPLAY NAME").fill(displayName);
  await page.getByLabel("USERNAME").fill(username);
  await page.getByLabel("PASSWORD").fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#shell")).toBeVisible();
  await expect(page.locator("#message-input")).toBeVisible();
}
async function send(page, text) {
  await page.locator("#message-input").fill(text);
  await page.locator("#message-input").press("Enter");
  await expect(
    page
      .locator("#message-list .message-text")
      .filter({ hasText: text.replaceAll("**", "") }),
  ).toBeVisible();
}
async function contextMessage(page, text) {
  const row = page.locator(".message-row").filter({ hasText: text }).last();
  await row.click({ button: "right" });
  return row;
}

test("Discord-style chat: messages, replies, reactions, edit, pin, search, uploads and settings", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await register(page, "chat_owner", "Alex Rivera");
  await expect(
    page
      .locator("#server-rail")
      .getByRole("button", { name: "Voxora Community", exact: true }),
  ).toBeVisible();
  await send(page, "Working on **Voxora 2.0** today 🚀");
  await contextMessage(page, "Working on");
  await page.getByRole("button", { name: "Reply", exact: true }).last().click();
  await expect(page.locator("#reply-banner")).toContainText("Alex Rivera");
  await send(page, "The new layout is looking good.");
  await expect(page.locator(".message-reply")).toContainText("Working on");
  const original = page
    .locator(".message-row")
    .filter({ hasText: "Working on **Voxora" })
    .first();
  await contextMessage(page, "Working on");
  await page
    .getByRole("button", { name: "Edit Message", exact: true })
    .last()
    .click();
  await page
    .getByLabel("MESSAGE", { exact: true })
    .fill("Working on **Voxora 2.0** — the desktop app is back.");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.locator("#message-list")).toContainText(
    "the desktop app is back.",
  );
  const edited = page
    .locator(".message-row")
    .filter({ hasText: "the desktop app is back." })
    .first();
  await edited.hover();
  await edited
    .getByRole("button", { name: "Add Reaction", exact: true })
    .click();
  await page.getByRole("button", { name: "🔥", exact: true }).click();
  await expect(edited.locator(".reaction")).toContainText("1");
  await edited.click({ button: "right" });
  await page.getByRole("button", { name: "Pin Message", exact: true }).click();
  await page
    .getByRole("button", { name: "Pinned Messages", exact: true })
    .click();
  await expect(page.locator("#detail-panel")).toContainText(
    "the desktop app is back.",
  );
  await page
    .getByRole("textbox", { name: "Search messages", exact: true })
    .fill("desktop");
  await page
    .getByRole("textbox", { name: "Search messages", exact: true })
    .press("Enter");
  await expect(page.locator("#detail-panel")).toContainText("1 results");
  await page.locator("#file-input").setInputFiles({
    name: "release-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Voxora release notes"),
  });
  await page.locator("#message-input").fill("Release notes attached");
  await page.locator("#message-input").press("Enter");
  await expect(
    page.getByRole("link", { name: "release-notes.txt", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "User Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByLabel("ABOUT ME").fill("Building things with friends.");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.locator("#toast-stack")).toContainText(
    "profile has been updated",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Quick switcher" })
    .fill("development");
  await page
    .getByRole("button", { name: "development Voxora Community" })
    .click();
  await expect(page.locator("#topbar")).toContainText("development");
  await page.getByRole("button", { name: "general", exact: true }).click();
  await page
    .getByRole("button", { name: "Toggle Member List", exact: true })
    .click();
  await expect(page.locator("#detail-panel")).toBeHidden();
  await page
    .getByRole("button", { name: "Toggle Member List", exact: true })
    .click();
  await expect(page.locator("#detail-panel")).toBeVisible();
  await expect(page.locator("#toast-stack")).toBeEmpty({ timeout: 7000 });
  await page.screenshot({
    path: "test-results/voxora-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("two real users can join a private server, become friends and exchange private messages", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const alice = await a.newPage(),
    bob = await b.newPage();
  try {
    await register(alice, "alice_friends", "Alice");
    await register(bob, "bob_friends", "Bob");
    await alice
      .getByRole("button", { name: "Add a Server", exact: true })
      .click();
    await alice
      .getByRole("button", { name: "Create My Own", exact: true })
      .click();
    await alice.getByLabel("SERVER NAME").fill("Night Shift");
    await alice.getByRole("button", { name: "Create", exact: true }).click();
    await expect(alice.locator("#sidebar-top")).toContainText("Night Shift");
    await alice
      .getByRole("button", { name: "Invite People", exact: true })
      .click();
    const invite = await alice
      .getByRole("textbox", { name: "Invite link" })
      .inputValue();
    await alice.getByRole("button", { name: "Close", exact: true }).click();
    await bob
      .getByRole("button", { name: "Add a Server", exact: true })
      .click();
    await bob
      .getByRole("button", { name: "Join a Server", exact: true })
      .click();
    await bob.getByLabel("INVITE LINK").fill(invite);
    await bob.getByRole("button", { name: "Join Server", exact: true }).click();
    await expect(bob.locator("#sidebar-top")).toContainText("Night Shift");
    await send(alice, "Live from Night Shift");
    await expect(bob.locator("#message-list")).toContainText(
      "Live from Night Shift",
    );
    await alice
      .getByRole("button", { name: "Create Channel", exact: true })
      .first()
      .click();
    await alice.getByLabel("CHANNEL NAME").fill("ship-room");
    await alice
      .getByRole("button", { name: "Create Channel", exact: true })
      .last()
      .click();
    await expect(alice.locator("#topbar")).toContainText("ship-room");
    await expect(
      bob.getByRole("button", { name: "ship-room", exact: true }),
    ).toBeVisible();
    await alice
      .getByRole("button", { name: "Direct Messages", exact: true })
      .click();
    await alice
      .getByRole("button", { name: "Add Friend", exact: true })
      .click();
    await alice
      .getByRole("textbox", { name: "Friend username" })
      .fill("bob_friends");
    await alice
      .getByRole("button", { name: "Send Friend Request", exact: true })
      .click();
    await expect(alice.locator(".form-success")).toBeVisible();
    await bob
      .getByRole("button", { name: "Direct Messages", exact: true })
      .click();
    await bob.getByRole("button", { name: /^Pending/ }).click();
    await expect(bob.locator(".friend-row")).toContainText("Alice");
    await bob.getByRole("button", { name: "Accept", exact: true }).click();
    await alice.getByRole("button", { name: "All", exact: true }).click();
    await expect(alice.locator(".friend-row")).toContainText("Bob");
    await alice.getByRole("button", { name: "Message", exact: true }).click();
    await send(alice, "This is a private DM.");
    await expect(bob.locator("#channel-list")).toContainText("Alice");
    await bob.getByRole("button", { name: /Alice/ }).first().click();
    await expect(bob.locator("#message-list")).toContainText(
      "This is a private DM.",
    );
  } finally {
    await a.close();
    await b.close();
  }
});

test("voice connects two microphones and carries real WebRTC audio; mute and disconnect work", async ({
  browser,
}, testInfo) => {
  const options = { permissions: ["microphone", "camera"] };
  const a = await browser.newContext(options),
    b = await browser.newContext(options);
  const p = await a.newPage(),
    q = await b.newPage();
  for (const page of [p, q])
    await page.addInitScript(() => {
      window.__rtc = [];
      const Original = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Original {
        constructor(...args) {
          super(...args);
          window.__rtc.push(this);
        }
      };
    });
  try {
    await register(p, `voice_alice_${testInfo.repeatEachIndex}`, "Voice Alice");
    await register(q, `voice_bob_${testInfo.repeatEachIndex}`, "Voice Bob");
    await p.getByRole("button", { name: "General", exact: true }).click();
    await p.getByRole("button", { name: "Join Voice", exact: true }).click();
    await expect(p.locator("#voice-connected")).toBeVisible();
    await q.getByRole("button", { name: "General", exact: true }).click();
    await q.getByRole("button", { name: "Join Voice", exact: true }).click();
    await expect(q.locator("#voice-connected")).toBeVisible();
    await expect
      .poll(
        () =>
          p.evaluate(() =>
            window.__rtc.some((c) => c.connectionState === "connected"),
          ),
        { timeout: 20000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          q.evaluate(() =>
            window.__rtc.some((c) => c.connectionState === "connected"),
          ),
        { timeout: 20000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          q.evaluate(async () => {
            for (const pc of window.__rtc)
              for (const report of (await pc.getStats()).values())
                if (
                  report.type === "inbound-rtp" &&
                  report.kind === "audio" &&
                  report.bytesReceived > 0
                )
                  return true;
            return false;
          }),
        { timeout: 15000 },
      )
      .toBe(true);
    await p
      .locator("#user-controls")
      .getByRole("button", { name: "Mute", exact: true })
      .click();
    await expect
      .poll(() =>
        p.evaluate(() =>
          window.__rtc
            .flatMap((c) => c.getSenders())
            .filter((s) => s.track?.kind === "audio")
            .every((s) => !s.track.enabled),
        ),
      )
      .toBe(true);
    await q
      .locator("#user-controls")
      .getByRole("button", { name: "Deafen", exact: true })
      .click();
    await expect
      .poll(() =>
        q
          .locator("#remote-media audio")
          .evaluateAll((nodes) => nodes.every((n) => n.muted)),
      )
      .toBe(true);
    await p.getByRole("button", { name: "Turn On Video", exact: true }).click();
    await expect
      .poll(() => q.locator("#call-view video").count())
      .toBeGreaterThan(0);
    await p
      .locator("#voice-connected")
      .getByRole("button", { name: "Disconnect", exact: true })
      .click();
    await expect(p.locator("#voice-connected")).toBeHidden();
    await expect
      .poll(() =>
        q.evaluate(() =>
          window.__rtc.every((c) => c.connectionState === "closed"),
        ),
      )
      .toBe(true);
  } finally {
    await a.close();
    await b.close();
  }
});

test("responsive navigation and message sending work on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await register(page, "mobile_user", "Mobile User");
  await expect(
    page.getByRole("button", { name: "Show Channels", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show Channels", exact: true })
    .click();
  await page.getByRole("button", { name: "development", exact: true }).click();
  await send(page, "Hello from a narrow screen");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/voxora-mobile.png",
    fullPage: true,
  });
});
