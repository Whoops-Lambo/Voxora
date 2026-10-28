import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

test(
  "role hierarchy, channel overrides, moderation, invites and ownership are enforced and persist",
  { timeout: 45000 },
  async () => {
    const dir = await mkdtemp("/tmp/voxora-roles-");
    let child, origin;
    async function start() {
      child = spawn(
        process.execPath,
        [fileURLToPath(new URL("../server.js", import.meta.url))],
        {
          env: {
            ...process.env,
            PORT: "0",
            VOXORA_DATA_DIR: dir,
            VOXORA_HOST: "127.0.0.1",
          },
          stdio: ["ignore", "pipe", "inherit"],
        },
      );
      origin = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => reject(Error("Server exited " + code)));
        createInterface({ input: child.stdout }).on("line", (line) => {
          const match = line.match(/port (\d+)/);
          if (match) resolve("http://127.0.0.1:" + match[1]);
        });
      });
    }
    async function stop() {
      if (child?.exitCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await exited;
      }
    }
    async function call(cookie, route, method = "GET", data) {
      const r = await fetch(origin + "/api" + route, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const value = await r.json();
      return {
        status: r.status,
        data: value,
        cookie: r.headers.get("set-cookie")?.split(";")[0],
      };
    }
    try {
      await start();
      const accounts = [];
      for (const name of [
        "owner",
        "moderator",
        "member",
        "equal",
        "admin",
        "outsider",
      ]) {
        const r = await call(null, "/auth/register", "POST", {
          username: name,
          password: "Fixture-password-426",
          displayName: name,
        });
        assert.equal(r.status, 200);
        accounts.push({ id: r.data.me.id, cookie: r.cookie });
      }
      const [owner, mod, member, equal, admin, outsider] = accounts;
      const O = (route, method, data) =>
          call(owner.cookie, route, method, data),
        M = (route, method, data) => call(mod.cookie, route, method, data),
        U = (route, method, data) => call(member.cookie, route, method, data);
      const created = await O("/servers", "POST", { name: "Managed Server" });
      const s = created.data,
        base = "/servers/" + s.id,
        ch = s.channels.find((c) => c.type === "text").id,
        voice = s.channels.find((c) => c.type === "voice").id;
      for (const u of [mod, member, equal, admin])
        assert.equal(
          (await call(u.cookie, "/invites/join", "POST", { code: s.invite }))
            .status,
          200,
        );
      assert.equal(
        (
          await U(base + "/roles", "POST", {
            name: "Escalation",
            permissions: ["administrator"],
          })
        ).status,
        403,
      );
      assert.equal((await U(base + "/audit")).status, 403);
      assert.equal((await U(base + "/bans")).status, 403);
      const initial = s.roles.find((r) => r.id === "everyone").permissions;
      assert.equal(
        (
          await O(base + "/roles/everyone", "PATCH", {
            permissions: [...initial, "manageRoles"],
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await U(base + "/roles", "POST", {
            name: "Cannot insert below everyone",
            permissions: [],
          })
        ).status,
        403,
      );
      assert.equal(
        (await O("/state")).data.servers.find((x) => x.id === s.id).roles[0].id,
        "everyone",
      );
      assert.equal(
        (await O(base + "/roles/everyone", "PATCH", { permissions: initial }))
          .status,
        200,
      );
      const createRole = async (name, permissions, other = {}) => {
        const r = await O(base + "/roles", "POST", {
          name,
          permissions,
          ...other,
        });
        assert.equal(r.status, 201);
        return r.data;
      };
      const a = await createRole("Admin", ["administrator"]),
        low = await createRole("Lower Admin", ["administrator"]),
        secret = await createRole("Secret", ["viewChannel", "sendMessages"]);
      const moderator = await createRole(
        "Moderator",
        [
          "manageRoles",
          "manageChannels",
          "manageMessages",
          "kickMembers",
          "banMembers",
          "moderateMembers",
          "viewAuditLog",
        ],
        { color: "#eb459e", hoist: true },
      );
      assert.equal(
        (
          await O(base + "/roles/reorder", "POST", {
            roleIds: [a.id, moderator.id, secret.id, low.id],
          })
        ).status,
        200,
      );
      for (const id of [mod.id, equal.id])
        assert.equal(
          (await O(base + "/members/" + id, "PATCH", { roles: [moderator.id] }))
            .status,
          200,
        );
      assert.equal(
        (await O(base + "/members/" + admin.id, "PATCH", { roles: [a.id] }))
          .status,
        200,
      );
      assert.equal(
        (await M(base + "/roles/" + a.id, "PATCH", { name: "Hijacked" }))
          .status,
        403,
      );
      assert.equal(
        (
          await M(base + "/roles", "POST", {
            name: "Unowned admin",
            permissions: ["administrator"],
          })
        ).status,
        403,
      );
      assert.equal(
        (await M(base + "/members/" + member.id, "PATCH", { roles: [low.id] }))
          .status,
        403,
      );
      assert.equal(
        (
          await M(base + "/members/" + mod.id, "PATCH", {
            roles: [moderator.id, low.id],
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await M(base + "/roles/everyone", "PATCH", {
            permissions: ["administrator"],
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await M(base + "/roles/reorder", "POST", {
            roleIds: [moderator.id, a.id, secret.id, low.id],
          })
        ).status,
        403,
      );
      const assistant = await M(base + "/roles", "POST", {
        name: "Assistant",
        permissions: ["manageMessages"],
      });
      assert.equal(assistant.status, 201);
      assert.equal(
        (
          await M(base + "/roles/" + low.id, "PATCH", {
            name: "Lower Admin renamed",
            permissions: ["administrator"],
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await M(base + "/roles/" + assistant.data.id, "PATCH", {
            permissions: ["manageServer"],
          })
        ).status,
        403,
      );
      let finish, ready;
      const received = new Promise((resolve) => (ready = resolve));
      const suspended = new Promise((resolve, reject) => {
        const req = http.request(
          origin + "/api" + base + "/roles",
          {
            method: "POST",
            headers: { Cookie: mod.cookie, "Content-Type": "application/json" },
          },
          (res) => {
            let text = "";
            res.on("data", (part) => (text += part));
            res.on("end", () => resolve(res.statusCode));
          },
        );
        req.on("error", reject);
        req.write('{"name":', ready);
        finish = () => req.end('"Suspended role"}');
      });
      await received;
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(
        (await O(base + "/members/" + mod.id, "PATCH", { roles: [] })).status,
        200,
      );
      finish();
      assert.equal(await suspended, 403);
      assert.equal(
        (
          await O(base + "/members/" + mod.id, "PATCH", {
            roles: [moderator.id],
          })
        ).status,
        200,
      );

      assert.equal((await O(base + "/roles/everyone", "DELETE")).status, 400);
      assert.equal(
        (
          await O(base + "/roles/" + secret.id, "PATCH", {
            name: "Should not mutate",
            permissions: ["invalid"],
          })
        ).status,
        400,
      );
      assert.equal(
        (await O("/state")).data.servers
          .find((x) => x.id === s.id)
          .roles.find((r) => r.id === secret.id).name,
        "Secret",
      );
      const msg = (
        await U("/messages", "POST", { channel: ch, text: "A member message" })
      ).data;
      assert.equal(
        (await M("/messages/" + msg.id + "/pin", "POST", {})).status,
        200,
      );
      assert.equal((await M("/messages/" + msg.id, "DELETE")).status, 200);
      const other = (
        await M("/messages", "POST", { channel: ch, text: "Moderator message" })
      ).data;
      assert.equal((await U("/messages/" + other.id, "DELETE")).status, 403);
      // Everyone deny -> role allow -> member deny. Administrators bypass channel overrides.
      const privateChannel = (
        await O(base + "/channels", "POST", { name: "secret-room" })
      ).data;
      const everyoneDeny = {
          type: "role",
          id: "everyone",
          allow: [],
          deny: ["viewChannel", "sendMessages"],
        },
        roleAllow = {
          type: "role",
          id: secret.id,
          allow: ["viewChannel", "sendMessages"],
          deny: [],
        },
        memberDeny = {
          type: "member",
          id: member.id,
          allow: [],
          deny: ["viewChannel", "sendMessages"],
        };
      assert.equal(
        (
          await O("/channels/" + privateChannel.id, "PATCH", {
            overwrites: [everyoneDeny, roleAllow, memberDeny],
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await O(base + "/members/" + member.id, "PATCH", {
            roles: [secret.id],
          })
        ).status,
        200,
      );
      assert.equal(
        (await U("/messages?channel=" + privateChannel.id)).status,
        403,
      );
      assert.ok(
        !(await U("/state")).data.servers
          .find((x) => x.id === s.id)
          .channels.some((c) => c.id === privateChannel.id),
      );
      assert.equal(
        (await call(admin.cookie, "/messages?channel=" + privateChannel.id))
          .status,
        200,
      );
      const hidden = (
        await O("/messages", "POST", {
          channel: privateChannel.id,
          text: "Hidden secret content",
        })
      ).data;
      assert.equal((await U("/search?q=Hidden&server=" + s.id)).data.length, 0);
      assert.equal(
        (
          await O("/channels/" + privateChannel.id, "PATCH", {
            overwrites: [everyoneDeny, roleAllow],
          })
        ).status,
        200,
      );
      assert.equal(
        (await U("/messages?channel=" + privateChannel.id)).status,
        200,
      );
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: privateChannel.id,
            text: "Role allows posting",
          })
        ).status,
        201,
      );
      const denySend = { ...memberDeny, deny: ["sendMessages"] };
      assert.equal(
        (
          await O("/channels/" + privateChannel.id, "PATCH", {
            overwrites: [everyoneDeny, roleAllow, denySend],
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: privateChannel.id,
            text: "Denied by member override",
          })
        ).status,
        403,
      );
      assert.equal(
        (await M("/channels/" + ch, "PATCH", { name: "renamed-general" }))
          .status,
        200,
      );
      for (const target of [owner, equal, admin])
        assert.equal(
          (await M(base + "/members/" + target.id, "DELETE", {})).status,
          403,
        );
      assert.equal(
        (
          await M(base + "/members/" + admin.id, "PATCH", {
            timeoutUntil: Date.now() + 60000,
          })
        ).status,
        403,
      );
      // Timeout disconnects an active voice session and blocks all server participation.
      const events = await fetch(
        origin + "/api/events?client=role-test-member",
        { headers: { Cookie: member.cookie } },
      );
      const reader = events.body.getReader();
      await reader.read();
      assert.equal(
        (
          await fetch(origin + "/api/events?client=role-test-member", {
            headers: { Cookie: outsider.cookie },
          })
        ).status,
        409,
      );
      try {
        assert.equal(
          (
            await U("/voice/join", "POST", {
              channel: voice,
              clientId: "role-test-member",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await M(base + "/members/" + member.id, "PATCH", {
              timeoutUntil: Date.now() + 60000,
              reason: "Cool down",
            })
          ).status,
          200,
        );
        assert.equal((await U("/messages?channel=" + ch)).status, 200);
        assert.equal(
          (await U("/messages", "POST", { channel: ch, text: "Timed out" }))
            .status,
          403,
        );
        assert.equal(
          (
            await U("/messages/" + other.id + "/reactions", "POST", {
              emoji: "🔥",
            })
          ).status,
          403,
        );
        assert.equal((await U("/typing", "POST", { channel: ch })).status, 403);
        assert.equal(
          (
            await U("/voice/join", "POST", {
              channel: voice,
              clientId: "role-test-member",
            })
          ).status,
          403,
        );
        assert.ok(
          !(await O("/state")).data.voice.some((v) => v.userId === member.id),
        );
        assert.equal(
          (
            await M(base + "/members/" + member.id, "PATCH", {
              timeoutUntil: 0,
              reason: "Resolved",
            })
          ).status,
          200,
        );
      } finally {
        await reader.cancel();
      }
      assert.equal(
        (
          await M(base + "/bans/" + member.id, "POST", {
            reason: "Repeated spam",
          })
        ).status,
        200,
      );
      assert.equal(
        (await U("/invites/join", "POST", { code: s.invite })).status,
        403,
      );
      assert.equal((await U("/messages?channel=" + ch)).status, 403);
      assert.equal((await M(base + "/bans")).data[0].reason, "Repeated spam");
      assert.equal(
        (await M(base + "/bans/" + member.id, "DELETE")).status,
        200,
      );
      assert.equal(
        (await U("/invites/join", "POST", { code: s.invite })).status,
        200,
      );
      const invite = await M(base + "/invites", "POST", {
        expiresIn: 1800,
        maxUses: 1,
      });
      assert.equal(invite.status, 201);
      assert.equal(
        (
          await M(base + "/members/" + member.id, "DELETE", {
            reason: "Test kick",
          })
        ).status,
        200,
      );
      assert.equal(
        (await U("/invites/join", "POST", { code: invite.data.code })).status,
        200,
      );
      assert.equal(
        (await M(base + "/members/" + member.id, "DELETE", {})).status,
        200,
      );
      assert.equal(
        (await U("/invites/join", "POST", { code: invite.data.code })).status,
        404,
      );
      assert.equal(
        (await M(base + "/invites/" + s.invite, "DELETE")).status,
        403,
      );
      assert.equal(
        (await M(base + "/invites/" + invite.data.code, "DELETE")).status,
        200,
      );
      assert.equal(
        (await U("/invites/join", "POST", { code: s.invite })).status,
        200,
      );
      const logs = (await M(base + "/audit")).data;
      for (const action of [
        "Role created",
        "Member roles updated",
        "Channel permissions updated",
        "Member timed out",
        "Member banned",
        "Ban revoked",
        "Member kicked",
        "Invite created",
        "Invite revoked",
      ])
        assert.ok(
          logs.some((l) => l.action === action),
          action,
        );
      assert.ok(
        logs.some((l) => l.actorId === mod.id && l.reason === "Repeated spam"),
      );
      assert.equal(
        (
          await O(base + "/transfer", "POST", {
            userId: mod.id,
            confirmation: "wrong",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await O(base + "/transfer", "POST", {
            userId: mod.id,
            confirmation: s.name,
          })
        ).status,
        200,
      );
      assert.equal((await O(base, "DELETE")).status, 403);
      assert.equal(
        (
          await M(base + "/members/" + member.id, "PATCH", {
            roles: [secret.id],
          })
        ).status,
        200,
      );
      assert.equal(
        (await M(base + "/roles/" + secret.id, "DELETE")).status,
        200,
      );
      await stop();
      await start();
      const restored = (await M("/state")).data.servers.find(
        (x) => x.id === s.id,
      );
      assert.equal(restored.ownerId, mod.id);
      assert.ok(!restored.roles.some((r) => r.id === secret.id));
      assert.ok(!(restored.memberRoles[member.id] || []).includes(secret.id));
      assert.ok(
        restored.channels.every(
          (c) =>
            !c.overwrites.some((o) => o.type === "role" && o.id === secret.id),
        ),
      );
      assert.ok(
        (await M(base + "/audit")).data.some(
          (l) => l.action === "Ownership transferred",
        ),
      );
      assert.equal(
        (await call(outsider.cookie, "/messages?channel=" + privateChannel.id))
          .status,
        403,
      );
    } finally {
      await stop();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
