import { test, expect } from "@playwright/test";
import { fixture } from "../support/server.mjs";

async function register(page, name) {
  await page.goto("/app");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("DISPLAY NAME").fill(name);
  await page.getByLabel("USERNAME").fill(name);
  await page.getByLabel("PASSWORD").fill("Fixture-password-876");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#shell")).toBeVisible();
}
test("public homepage, first-account admin, assignable staff roles and live account moderation work", async ({
  browser,
}) => {
  const f = await fixture();
  const a = await browser.newContext({ baseURL: f.origin }),
    b = await browser.newContext({ baseURL: f.origin }),
    c = await browser.newContext({ baseURL: f.origin });
  const owner = await a.newPage(),
    staff = await b.newPage(),
    member = await c.newPage();
  const errors = [];
  for (const page of [owner, staff, member])
    page.on("pageerror", (e) => errors.push(e.message));
  try {
    await owner.goto("/");
    await expect(
      owner.getByRole("heading", { name: "Your people. Your place." }),
    ).toBeVisible();
    await owner.screenshot({
      path: "test-results/voxora-website.png",
      fullPage: true,
    });
    await owner.setViewportSize({ width: 390, height: 844 });
    expect(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await owner.screenshot({
      path: "test-results/voxora-website-mobile.png",
      fullPage: true,
    });
    await owner.setViewportSize({ width: 1440, height: 900 });
    await register(owner, "site_owner");
    await register(staff, "site_staff");
    await register(member, "site_member");
    const data = await (await owner.request.get("/api/state")).json();
    expect(data.platform.owner).toBe(true);
    await owner.goto("/admin");
    await owner
      .getByRole("button", { name: "Staff Roles", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Create Staff Role", exact: true })
      .click();
    await owner
      .getByLabel("STAFF ROLE NAME", { exact: true })
      .fill("Voxora Support");
    await owner
      .getByRole("checkbox", { name: "Manage Accounts", exact: true })
      .check();
    await owner
      .getByRole("checkbox", { name: "View Platform Audit Log", exact: true })
      .check();
    await owner
      .getByRole("button", { name: "Save Staff Role", exact: true })
      .click();
    await expect(owner.locator(".admin-record")).toContainText(
      "Voxora Support",
    );
    await owner.getByRole("button", { name: "Accounts", exact: true }).click();
    await owner.getByLabel("Search users", { exact: true }).fill("site_staff");
    await owner.getByRole("button", { name: "Search", exact: true }).click();
    await owner
      .locator(".admin-record")
      .filter({ hasText: "@site_staff" })
      .getByRole("button", { name: "Assign Staff Roles", exact: true })
      .click();
    await owner
      .getByRole("checkbox", { name: "Voxora Support", exact: true })
      .check();
    await owner
      .getByRole("button", { name: "Save Staff Roles", exact: true })
      .click();
    await expect(
      owner.locator(".staff-pill").filter({ hasText: "Voxora Support" }),
    ).toBeVisible();
    await owner.screenshot({
      path: "test-results/voxora-platform-admin.png",
      fullPage: true,
    });
    await staff.goto("/admin");
    await expect(
      staff.getByRole("button", { name: "Accounts", exact: true }),
    ).toBeVisible();
    await expect(
      staff.getByRole("button", { name: "Staff Roles", exact: true }),
    ).toHaveCount(0);
    await expect(
      staff.getByRole("button", { name: "Bot Applications", exact: true }),
    ).toHaveCount(0);
    await staff.getByRole("button", { name: "Accounts", exact: true }).click();
    await staff.getByLabel("Search users", { exact: true }).fill("site_member");
    await staff.getByRole("button", { name: "Search", exact: true }).click();
    await staff
      .getByRole("button", { name: "Suspend Account", exact: true })
      .click();
    await staff
      .getByLabel("REASON", { exact: true })
      .fill("Test moderation reason");
    await staff
      .locator("#modal")
      .getByRole("button", { name: "Suspend Account", exact: true })
      .click();
    await expect(
      staff.locator(".admin-record").filter({ hasText: "@site_member" }),
    ).toContainText("Suspended");
    await expect(member.locator("#auth")).toBeVisible();
    await expect(member.locator("#auth-error")).toContainText("suspended");
    await staff
      .getByRole("button", { name: "Restore Account", exact: true })
      .click();
    await staff.getByLabel("REASON", { exact: true }).fill("Review complete");
    await staff
      .locator("#modal")
      .getByRole("button", { name: "Restore Account", exact: true })
      .click();
    await expect(
      staff.locator(".admin-record").filter({ hasText: "@site_member" }),
    ).toContainText("Active account");
    await staff.getByRole("button", { name: "Audit Log", exact: true }).click();
    await staff
      .getByLabel("Search audit", { exact: true })
      .fill("Test moderation reason");
    await staff.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      staff
        .locator(".admin-record")
        .filter({ hasText: "Test moderation reason" }),
    ).toContainText("Account suspended");
    await member.goto("/admin");
    await expect(
      member.getByRole("link", { name: "Sign In", exact: true }).last(),
    ).toBeVisible();
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto("/admin");
    expect(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([a.close(), b.close(), c.close()]);
    await f.cleanup();
  }
});
