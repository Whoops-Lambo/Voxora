import { test, expect } from "@playwright/test";
async function register(page, name, display) {
  await page.goto("/app");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("DISPLAY NAME").fill(display);
  await page.getByLabel("USERNAME").fill(name);
  await page.getByLabel("PASSWORD").fill("Fixture-password-852");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#message-input")).toBeVisible();
}
async function settings(page, tab) {
  await page.locator("#sidebar-top .server-heading").click();
  await page
    .getByRole("button", { name: "Server Settings", exact: true })
    .click();
  await page.getByRole("button", { name: tab, exact: true }).click();
}

test("server managers create, assign and order roles; channel overrides, moderation and transfer work", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    owner = await a.newPage(),
    member = await b.newPage();
  const errors = [];
  owner.on("pageerror", (e) => errors.push(e.message));
  member.on("pageerror", (e) => errors.push(e.message));
  try {
    await register(owner, "roles_owner", "Role Owner");
    await register(member, "roles_member", "Role Member");
    await owner
      .getByRole("button", { name: "Add a Server", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Create My Own", exact: true })
      .click();
    await owner.getByLabel("SERVER NAME").fill("Management Lab");
    await owner.getByRole("button", { name: "Create", exact: true }).click();
    await expect(owner.locator("#sidebar-top")).toContainText("Management Lab");
    await owner
      .getByRole("button", { name: "Invite People", exact: true })
      .click();
    const invite = await owner
      .getByRole("textbox", { name: "Invite link" })
      .inputValue();
    await owner.getByRole("button", { name: "Close", exact: true }).click();
    await member
      .getByRole("button", { name: "Add a Server", exact: true })
      .click();
    await member
      .getByRole("button", { name: "Join a Server", exact: true })
      .click();
    await member.getByLabel("INVITE LINK").fill(invite);
    await member
      .getByRole("button", { name: "Join Server", exact: true })
      .click();
    await expect(member.locator("#sidebar-top")).toContainText(
      "Management Lab",
    );
    await settings(owner, "Roles");
    await owner
      .getByRole("button", { name: "Create Role", exact: true })
      .click();
    await owner.getByLabel("ROLE NAME").fill("Support Team");
    await owner
      .getByRole("button", { name: "Create Role", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", { name: "EDIT ROLE — Support Team" }),
    ).toBeVisible();
    await owner.getByLabel("Use default color").uncheck();
    await owner.getByLabel("ROLE COLOR", { exact: true }).fill("#3498db");
    await owner.getByLabel("Display role members separately").check();
    for (const p of [
      "Manage Messages",
      "Timeout Members",
      "Manage Channels",
      "View Audit Log",
    ])
      await owner.getByRole("checkbox", { name: p, exact: true }).check();
    await owner.getByRole("button", { name: "Save Role", exact: true }).click();
    await expect(owner.locator("#toast-stack")).toContainText("Role saved");
    await owner
      .getByRole("button", { name: "Create Role", exact: true })
      .click();
    await owner.getByLabel("ROLE NAME").fill("Trial");
    await owner
      .getByRole("button", { name: "Create Role", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Move Trial down", exact: true })
      .click();
    await expect(owner.locator(".role-select").first()).toHaveText(
      "Support Team",
    );
    await owner.screenshot({
      path: "test-results/voxora-roles.png",
      fullPage: true,
    });
    await owner.getByRole("button", { name: "Members", exact: true }).click();
    await owner
      .getByRole("button", {
        name: "Manage roles for Role Member",
        exact: true,
      })
      .click();
    await owner
      .getByRole("checkbox", { name: "Support Team", exact: true })
      .check();
    await owner
      .getByRole("button", { name: "Save Roles", exact: true })
      .click();
    await expect(member.locator("#detail-panel")).toContainText("Support Team");
    await owner
      .getByRole("button", { name: "general", exact: true })
      .click({ button: "right" });
    await owner
      .getByRole("button", { name: "Channel Permissions", exact: true })
      .click();
    await owner.getByLabel("ROLE OR MEMBER").selectOption("role:everyone");
    await owner
      .getByLabel("Send Messages override", { exact: true })
      .selectOption("deny");
    await owner
      .getByRole("button", { name: "Save Permissions", exact: true })
      .click();
    await expect(member.locator("#message-input")).toBeDisabled();
    await owner
      .getByRole("button", { name: "general", exact: true })
      .click({ button: "right" });
    await owner
      .getByRole("button", { name: "Channel Permissions", exact: true })
      .click();
    const roleId = await owner
      .getByLabel("ROLE OR MEMBER")
      .locator("option")
      .filter({ hasText: "Support Team" })
      .getAttribute("value");
    await owner.getByLabel("ROLE OR MEMBER").selectOption(roleId);
    await owner
      .getByLabel("Send Messages override", { exact: true })
      .selectOption("allow");
    await owner
      .getByRole("button", { name: "Save Permissions", exact: true })
      .click();
    await expect(member.locator("#message-input")).toBeEnabled();
    await member.locator("#message-input").fill("Support can post here.");
    await member.locator("#message-input").press("Enter");
    await expect(owner.locator("#message-list")).toContainText(
      "Support can post here.",
    );
    await owner
      .locator("#detail-panel .member-row")
      .filter({ hasText: "Role Member" })
      .click({ button: "right" });
    await owner
      .getByRole("button", { name: "Timeout Member", exact: true })
      .click();
    await owner.getByLabel("DURATION").selectOption("60");
    await owner.getByLabel("REASON").fill("Please cool down");
    await owner
      .getByRole("button", { name: "Timeout Member", exact: true })
      .click();
    await expect(member.locator("#message-input")).toBeDisabled();
    await expect(member.locator("#message-input")).toHaveAttribute(
      "placeholder",
      "You are timed out in this server.",
    );
    await owner
      .locator("#detail-panel .member-row")
      .filter({ hasText: "Role Member" })
      .click({ button: "right" });
    await owner
      .getByRole("button", { name: "Remove Timeout", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Remove Timeout", exact: true })
      .click();
    await expect(member.locator("#message-input")).toBeEnabled();
    await settings(owner, "Audit Log");
    await owner
      .getByRole("textbox", { name: "Search audit log" })
      .fill("Please cool down");
    await expect(owner.locator(".audit-entry")).toContainText(
      "Member timed out",
    );
    await owner.screenshot({
      path: "test-results/voxora-management.png",
      fullPage: true,
    });
    await owner.getByRole("button", { name: "Close", exact: true }).click();
    await owner
      .locator("#detail-panel .member-row")
      .filter({ hasText: "Role Member" })
      .click({ button: "right" });
    await owner
      .getByRole("button", { name: "Ban Member", exact: true })
      .click();
    await owner.getByLabel("REASON").fill("Test ban");
    await owner
      .getByRole("button", { name: "Ban Member", exact: true })
      .click();
    await expect(
      member.getByRole("button", { name: "Management Lab", exact: true }),
    ).toHaveCount(0);
    await settings(owner, "Bans");
    await expect(owner.locator(".management-member")).toContainText("Test ban");
    await owner
      .getByRole("button", { name: "Revoke Ban", exact: true })
      .click();
    await owner.getByRole("button", { name: "Confirm", exact: true }).click();
    await owner.getByRole("button", { name: "Close", exact: true }).click();
    await member
      .getByRole("button", { name: "Add a Server", exact: true })
      .click();
    await member
      .getByRole("button", { name: "Join a Server", exact: true })
      .click();
    await member.getByLabel("INVITE LINK").fill(invite);
    await member
      .getByRole("button", { name: "Join Server", exact: true })
      .click();
    await expect(member.locator("#sidebar-top")).toContainText(
      "Management Lab",
    );
    await settings(owner, "Overview");
    await owner
      .getByRole("button", { name: "Transfer Ownership", exact: true })
      .click();
    await owner.getByLabel("NEW OWNER").selectOption({ label: "Role Member" });
    await owner.getByLabel("CONFIRM SERVER NAME").fill("Management Lab");
    await owner
      .getByRole("button", { name: "Transfer Ownership", exact: true })
      .click();
    await owner.locator("#sidebar-top .server-heading").click();
    await expect(
      owner.getByRole("button", { name: "Server Settings", exact: true }),
    ).toHaveCount(0);
    await member.locator("#sidebar-top .server-heading").click();
    await expect(
      member.getByRole("button", { name: "Server Settings", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});

test("listen-only voice receives audio without capturing a microphone and revocation disconnects it", async ({
  browser,
}) => {
  const a = await browser.newContext({ permissions: ["microphone", "camera"] }),
    b = await browser.newContext({ permissions: ["microphone", "camera"] }),
    owner = await a.newPage(),
    listener = await b.newPage();
  await listener.addInitScript(() => {
    window.__rtc = [];
    window.__microphoneCalls = 0;
    const Original = RTCPeerConnection;
    window.RTCPeerConnection = class extends Original {
      constructor(...args) {
        super(...args);
        window.__rtc.push(this);
      }
    };
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (constraints.audio) window.__microphoneCalls++;
      return original(constraints);
    };
  });
  try {
    await register(owner, "listen_owner", "Listen Owner");
    await register(listener, "listen_member", "Listen Member");
    const s = await (
      await owner.request.post("/api/servers", {
        data: { name: "Listening Lab" },
      })
    ).json();
    await listener.request.post("/api/invites/join", {
      data: { code: s.invite },
    });
    const data = await (await listener.request.get("/api/state")).json();
    const voice = s.channels.find((c) => c.type === "voice");
    const overwrite = {
      id: data.me.id,
      type: "member",
      allow: [],
      deny: ["speak", "video"],
    };
    await owner.request.patch("/api/channels/" + voice.id, {
      data: { overwrites: [overwrite] },
    });
    for (const page of [owner, listener]) {
      await page
        .getByRole("button", { name: "Listening Lab", exact: true })
        .click();
      await page.getByRole("button", { name: "General", exact: true }).click();
      await page
        .getByRole("button", { name: "Join Voice", exact: true })
        .click();
      await expect(page.locator("#voice-connected")).toBeVisible();
    }
    await expect
      .poll(
        () =>
          listener.evaluate(async () => {
            for (const c of window.__rtc)
              for (const report of (await c.getStats()).values())
                if (
                  report.type === "inbound-rtp" &&
                  report.kind === "audio" &&
                  report.bytesReceived > 0
                )
                  return true;
            return false;
          }),
        { timeout: 20000 },
      )
      .toBe(true);
    expect(await listener.evaluate(() => window.__microphoneCalls)).toBe(0);
    expect(
      await listener.evaluate(() =>
        window.__rtc
          .flatMap((c) => c.getSenders())
          .some((s) => s.track?.kind === "audio"),
      ),
    ).toBe(false);
    await owner.request.patch("/api/channels/" + voice.id, {
      data: {
        overwrites: [{ ...overwrite, deny: ["connect", "speak", "video"] }],
      },
    });
    await expect(listener.locator("#voice-connected")).toBeHidden();
    await expect
      .poll(() =>
        listener.evaluate(() =>
          window.__rtc.every((c) => c.connectionState === "closed"),
        ),
      )
      .toBe(true);
  } finally {
    await a.close();
    await b.close();
  }
});
