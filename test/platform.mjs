import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fixture, until } from "./support/server.mjs";

test(
  "first human owns the platform; scoped staff roles, suspensions and application moderation protect ownership and privacy",
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    let gateway;
    try {
      const owner = await f.register("platform_owner"),
        mod = await f.register("platform_mod"),
        regular = await f.register("platform_regular"),
        staff = await f.register("platform_staff");
      const O = (p, m, d) => f.call(owner, p, m, d),
        M = (p, m, d) => f.call(mod, p, m, d),
        U = (p, m, d) => f.call(regular, p, m, d);
      assert.equal(owner.data.platform.owner, true);
      assert.equal(mod.data.platform.owner, false);
      assert.equal((await O("/platform/me")).data.owner, true);
      assert.equal((await M("/platform/overview")).status, 403);
      assert.equal(
        (
          await M("/platform/staff-roles", "POST", {
            name: "Escalate",
            permissions: ["manageUsers"],
          })
        ).status,
        403,
      );
      const role = (
        await O("/platform/staff-roles", "POST", {
          name: "Voxora Moderator",
          color: "#3498db",
          permissions: ["manageUsers", "viewAudit"],
        })
      ).data;
      await O("/platform/users/" + mod.id, "PATCH", {
        staffRoleIds: [role.id],
      });
      await O("/platform/users/" + staff.id, "PATCH", {
        staffRoleIds: [role.id],
      });
      assert.equal((await M("/platform/overview")).status, 200);
      assert.equal((await M("/platform/users")).status, 200);
      assert.equal((await M("/platform/applications")).status, 403);
      assert.equal(
        (
          await M("/platform/users/" + regular.id, "PATCH", {
            staffRoleIds: [role.id],
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await M("/platform/users/" + staff.id, "PATCH", {
            suspendFor: -1,
            reason: "Not allowed",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await M("/platform/users/" + owner.id, "PATCH", {
            suspendFor: -1,
            reason: "Never allowed",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await O("/platform/users/" + owner.id, "PATCH", {
            suspendFor: -1,
            reason: "No self lockout",
          })
        ).status,
        403,
      );
      const app = (await U("/applications", "POST", { name: "Regular App" }))
        .data;
      assert.equal((await f.call({ token: app.token }, "/bot/me")).status, 200);
      gateway = await f.gateway(app.token);
      await until(() => gateway.events.some((e) => e.type === "READY"));
      await M("/platform/users/" + regular.id, "PATCH", {
        suspendFor: -1,
        reason: "Repeated abuse",
      });
      await until(() => gateway.closed());
      await gateway.close();
      gateway = null;
      assert.equal((await U("/state")).status, 401);
      assert.equal(
        (
          await f.call(null, "/auth/login", "POST", {
            username: "platform_regular",
            password: "Fixture-password-987",
          })
        ).status,
        403,
      );
      assert.equal((await f.call({ token: app.token }, "/bot/me")).status, 403);
      assert.equal(
        (
          await M("/platform/users/" + regular.id, "PATCH", {
            suspendFor: 0,
            reason: "Appeal accepted",
          })
        ).status,
        200,
      );
      const restored = await f.call(null, "/auth/login", "POST", {
        username: "platform_regular",
        password: "Fixture-password-987",
      });
      regular.cookie = restored.cookie;
      assert.equal(restored.status, 200);
      assert.equal((await f.call({ token: app.token }, "/bot/me")).status, 200);
      assert.equal(
        (
          await O("/platform/applications/" + app.application.id, "PATCH", {
            disabled: true,
            reason: "Bot policy violation",
          })
        ).status,
        200,
      );
      assert.equal((await f.call({ token: app.token }, "/bot/me")).status, 403);
      assert.equal((await U("/applications")).data[0].disabled, true);
      await O("/platform/applications/" + app.application.id, "PATCH", {
        disabled: false,
        reason: "Reviewed",
      });
      assert.equal((await f.call({ token: app.token }, "/bot/me")).status, 200);
      const other = (await U("/servers", "POST", { name: "Private Server" }))
        .data;
      assert.equal(
        (await M("/messages?channel=" + other.channels[0].id)).status,
        403,
      );
      assert.equal((await M("/platform/servers")).status, 403);
      const serverStaff = (
        await O("/platform/staff-roles", "POST", {
          name: "Server Operations",
          permissions: ["manageServers", "manageApplications"],
        })
      ).data;
      await O("/platform/users/" + mod.id, "PATCH", {
        staffRoleIds: [serverStaff.id],
      });
      assert.equal((await M("/platform/servers")).status, 200);
      assert.equal(
        (await M("/messages?channel=" + other.channels[0].id)).status,
        403,
        "platform moderation never grants channel read access",
      );
      assert.equal(
        (
          await M("/platform/servers/" + other.id, "DELETE", {
            confirmation: "Wrong",
            reason: "Abuse",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await M("/platform/servers/" + other.id, "DELETE", {
            confirmation: other.name,
            reason: "Community guidelines",
          })
        ).status,
        200,
      );
      // Role revocation takes effect even on a partially received administration request.
      let pending;
      const delayed = new Promise((resolve, reject) => {
        pending = http.request(
          f.origin + "/api/platform/applications/" + app.application.id,
          {
            method: "PATCH",
            headers: { Cookie: mod.cookie, "Content-Type": "application/json" },
          },
          (r) => {
            r.resume();
            r.on("end", () => resolve(r.statusCode));
          },
        );
        pending.on("error", reject);
        pending.write('{"disabled":true,');
      });
      await O("/platform/users/" + mod.id, "PATCH", { staffRoleIds: [] });
      pending.end('"reason":"Delayed"}');
      assert.equal(await delayed, 403);
      assert.equal((await f.call({ token: app.token }, "/bot/me")).status, 200);
      const audit = (await O("/platform/audit?q=Repeated%20abuse")).data;
      assert.equal(audit.items[0].target, "platform_regular");
      assert.equal(
        JSON.stringify((await O("/platform/applications")).data).includes(
          app.token,
        ),
        false,
      );
      assert.equal(
        JSON.stringify((await O("/platform/applications")).data).includes(
          "tokenHash",
        ),
        false,
      );
      await f.stop();
      await f.start();
      assert.equal((await O("/platform/me")).data.owner, true);
      assert.equal(
        (await f.call(staff, "/platform/me")).data.permissions.includes(
          "manageUsers",
        ),
        true,
      );
      await O("/platform/staff-roles/" + role.id, "DELETE");
      assert.equal((await f.call(staff, "/platform/overview")).status, 403);
      assert.equal((await U("/platform/users")).status, 403);
    } finally {
      await gateway?.close();
      await f.cleanup();
    }
  },
);
