import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

test(
  "category inheritance, private channels, ordering and persistent slowmode enforce access",
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp("/tmp/voxora-channels-");
    let child, origin;
    async function start() {
      child = spawn(
        process.execPath,
        [fileURLToPath(new URL("../server.js", import.meta.url))],
        {
          env: {
            ...process.env,
            PORT: "0",
            VOXORA_HOST: "127.0.0.1",
            VOXORA_DATA_DIR: dir,
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
      if (child?.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await exited;
      }
      child = null;
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
      return {
        status: r.status,
        data: await r.json(),
        cookie: r.headers.get("set-cookie")?.split(";")[0],
        retryAfter: r.headers.get("retry-after"),
      };
    }
    try {
      await start();
      const accounts = [];
      for (const username of [
        "channel_owner",
        "channel_member",
        "channel_manager",
      ]) {
        const r = await call(null, "/auth/register", "POST", {
          username,
          displayName: username,
          password: "Fixture-password-275",
        });
        assert.equal(r.status, 200);
        accounts.push({ id: r.data.me.id, cookie: r.cookie });
      }
      const [owner, member, manager] = accounts;
      const O = (route, method, data) =>
          call(owner.cookie, route, method, data),
        U = (route, method, data) => call(member.cookie, route, method, data),
        M = (route, method, data) => call(manager.cookie, route, method, data);
      const created = await O("/servers", "POST", { name: "Channel Lab" });
      const s = created.data,
        base = "/servers/" + s.id;
      assert.ok(
        s.channels.every((c) => c.permissionSynced),
        "new server defaults follow their categories",
      );
      const getServer = async (who = O) =>
        (await who("/state")).data.servers.find((x) => x.id === s.id);
      const getChannel = async (id, who = O) =>
        (await getServer(who)).channels.find((c) => c.id === id);
      for (const account of [member, manager])
        assert.equal(
          (
            await call(account.cookie, "/invites/join", "POST", {
              code: s.invite,
            })
          ).status,
          200,
        );
      assert.equal(
        s.categories.length,
        2,
        "legacy category names migrate into durable categories",
      );
      assert.equal(
        (await U(base + "/categories", "POST", { name: "Forbidden" })).status,
        403,
      );
      const a = (await O(base + "/categories", "POST", { name: "Projects" }))
        .data;
      const b = (await O(base + "/categories", "POST", { name: "Lounge" }))
        .data;
      assert.equal(
        (await O(base + "/categories", "POST", { name: "projects" })).status,
        400,
      );
      assert.equal(
        (await O(base + "/categories/" + b.id, "PATCH", { beforeId: a.id }))
          .status,
        200,
      );
      assert.ok(
        (await getServer()).categories.findIndex((c) => c.id === b.id) <
          (await getServer()).categories.findIndex((c) => c.id === a.id),
      );
      const make = async (name, categoryId = a.id, extra = {}) => {
        const r = await O(base + "/channels", "POST", {
          name,
          categoryId,
          ...extra,
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        return r.data;
      };
      const first = await make("first"),
        second = await make("second"),
        third = await make("third");
      assert.equal(first.permissionSynced, true);
      assert.equal(
        (await O("/channels/" + third.id, "PATCH", { beforeId: first.id }))
          .status,
        200,
      );
      assert.deepEqual(
        (await getServer()).channels
          .filter((c) => c.categoryId === a.id)
          .map((c) => c.name),
        ["third", "first", "second"],
      );
      assert.equal(
        (
          await O("/channels/" + first.id, "PATCH", {
            name: "should-not-save",
            beforeId: "missing",
          })
        ).status,
        400,
      );
      assert.equal(
        (await getChannel(first.id)).name,
        "first",
        "invalid ordering never partly edits a channel",
      );
      const denySend = [
        { type: "role", id: "everyone", allow: [], deny: ["sendMessages"] },
      ];
      assert.equal(
        (
          await O(base + "/categories/" + a.id, "PATCH", {
            overwrites: denySend,
          })
        ).status,
        200,
      );
      assert.equal(
        (await U("/messages", "POST", { channel: first.id, text: "Blocked" }))
          .status,
        403,
      );
      assert.equal(
        (await getChannel(first.id, U)).permissions.includes("sendMessages"),
        false,
      );
      assert.equal(
        (await O("/channels/" + first.id, "PATCH", { overwrites: [] })).status,
        200,
      );
      assert.equal((await getChannel(first.id)).permissionSynced, false);
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: first.id,
            text: "Independent",
          })
        ).status,
        201,
      );
      assert.equal(
        (await O("/channels/" + second.id, "PATCH", { categoryId: b.id }))
          .status,
        200,
      );
      assert.equal((await getChannel(second.id)).permissionSynced, false);
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: second.id,
            text: "Still blocked after move",
          })
        ).status,
        403,
      );
      assert.equal(
        (await O("/channels/" + second.id, "PATCH", { syncPermissions: true }))
          .status,
        200,
      );
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: second.id,
            text: "Destination permissions",
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await O(base + "/categories/" + b.id, "PATCH", {
            name: "Public Lounge",
          })
        ).status,
        200,
      );
      assert.equal((await getChannel(second.id)).category, "Public Lounge");
      // Removing a category preserves both message history and inherited restrictions.
      assert.equal(
        (await O(base + "/categories/" + a.id, "DELETE")).status,
        200,
      );
      assert.equal((await getChannel(third.id)).categoryId, null);
      assert.equal((await getChannel(third.id)).permissionSynced, false);
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: third.id,
            text: "Still blocked after deletion",
          })
        ).status,
        403,
      );
      assert.equal(
        (await U("/messages?channel=" + first.id)).data[0].text,
        "Independent",
      );

      const secret = await make("staff-only", b.id, { private: true });
      assert.equal(
        (await getServer(U)).channels.some((c) => c.id === secret.id),
        false,
      );
      assert.equal((await U("/messages?channel=" + secret.id)).status, 403);
      assert.equal(
        (await U("/channels/" + secret.id, "PATCH", { overwrites: [] })).status,
        403,
      );
      assert.equal(
        (
          await O("/messages", "POST", {
            channel: secret.id,
            text: "Staff history",
          })
        ).status,
        201,
      );
      assert.equal(
        (await O("/channels/" + secret.id, "PATCH", { categoryId: null }))
          .status,
        200,
      );
      assert.equal(
        (await U("/messages?channel=" + secret.id)).status,
        403,
        "moving private channels preserves privacy",
      );
      const staff = (
        await O(base + "/roles", "POST", { name: "Staff", permissions: [] })
      ).data;
      await O(base + "/members/" + member.id, "PATCH", { roles: [staff.id] });
      await O("/channels/" + secret.id, "PATCH", {
        overwrites: [
          { type: "role", id: "everyone", allow: [], deny: ["viewChannel"] },
          { type: "role", id: staff.id, allow: ["viewChannel"], deny: [] },
        ],
      });
      assert.equal(
        (await U("/messages?channel=" + secret.id)).data[0].text,
        "Staff history",
      );
      const staffCategory = (
        await O(base + "/categories", "POST", { name: "Staff Only" })
      ).data;
      const inheritedSecret = await make("inherited-secret", staffCategory.id);
      await O(base + "/categories/" + staffCategory.id, "PATCH", {
        overwrites: [
          { type: "role", id: "everyone", allow: [], deny: ["viewChannel"] },
          { type: "role", id: staff.id, allow: ["viewChannel"], deny: [] },
        ],
      });
      assert.equal(
        (await U("/messages?channel=" + inheritedSecret.id)).status,
        200,
      );
      await O(base + "/roles/" + staff.id, "DELETE");
      assert.equal(
        (await U("/messages?channel=" + inheritedSecret.id)).status,
        403,
      );
      assert.equal(
        (await getServer(U)).categories.some((c) => c.id === staffCategory.id),
        false,
      );
      assert.equal(
        (await getServer()).categories
          .find((c) => c.id === staffCategory.id)
          .overwrites.some((o) => o.id === staff.id),
        false,
      );
      const managerRole = (
        await O(base + "/roles", "POST", {
          name: "Channel Manager",
          permissions: ["manageChannels", "manageRoles"],
        })
      ).data;
      await O(base + "/members/" + manager.id, "PATCH", {
        roles: [managerRole.id],
      });
      const guarded = (
        await O(base + "/categories", "POST", { name: "Guarded" })
      ).data;
      await O(base + "/categories/" + guarded.id, "PATCH", {
        overwrites: [
          { type: "role", id: "everyone", allow: ["manageMessages"], deny: [] },
        ],
      });
      await O("/channels/" + first.id, "PATCH", { categoryId: guarded.id });
      assert.equal(
        (await M("/channels/" + first.id, "PATCH", { syncPermissions: true }))
          .status,
        403,
        "sync cannot grant permissions the manager lacks",
      );
      assert.equal(
        (
          await M(base + "/categories/" + guarded.id, "PATCH", {
            overwrites: [
              {
                type: "role",
                id: managerRole.id,
                allow: ["sendMessages"],
                deny: [],
              },
            ],
          })
        ).status,
        403,
        "category changes respect hierarchy",
      );
      const ownPrivate = await M(base + "/channels", "POST", {
        name: "manager-room",
        private: true,
      });
      assert.equal(ownPrivate.status, 201);
      assert.equal(
        (await M("/messages?channel=" + ownPrivate.data.id)).status,
        200,
        "private-channel creator retains only existing read access",
      );
      assert.equal(
        (await U("/messages?channel=" + ownPrivate.data.id)).status,
        403,
      );

      // A request whose payload arrives after role revocation uses current permissions.
      const endpoint = new URL(origin + "/api" + base + "/categories");
      let pending;
      const delayed = new Promise((resolve, reject) => {
        pending = http.request(
          endpoint,
          {
            method: "POST",
            headers: {
              Cookie: manager.cookie,
              "Content-Type": "application/json",
            },
          },
          (r) => {
            r.resume();
            r.on("end", () => resolve(r.statusCode));
          },
        );
        pending.on("error", reject);
        pending.write('{"name":"Revoked');
      });
      await O(base + "/members/" + manager.id, "PATCH", { roles: [] });
      pending.end(' category"}');
      assert.equal(await delayed, 403);
      assert.equal(
        (await getServer()).categories.some(
          (c) => c.name === "Revoked category",
        ),
        false,
      );

      const slow = await make("slow-chat", b.id, { slowmode: 2 });
      const attempts = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          U("/messages", "POST", { channel: slow.id, text: "Attempt " + i }),
        ),
      );
      assert.equal(attempts.filter((r) => r.status === 201).length, 1);
      assert.equal(
        attempts.filter((r) => r.status === 429).length,
        3,
        "concurrent sends share one cooldown",
      );
      const blocked = attempts.find((r) => r.status === 429);
      assert.ok(blocked.data.nextAllowedAt > Date.now());
      assert.ok(Number(blocked.retryAfter) > 0);
      assert.equal(
        (await U("/state")).data.cooldowns[slow.id],
        blocked.data.nextAllowedAt,
      );
      const sent = attempts.find((r) => r.status === 201).data;
      assert.equal(
        (
          await U("/messages/" + sent.id, "PATCH", {
            text: "Editing is allowed",
          })
        ).status,
        200,
      );
      assert.equal((await U("/messages/" + sent.id, "DELETE")).status, 200);
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: slow.id,
            text: "Delete cannot reset the clock",
          })
        ).status,
        429,
      );
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: second.id,
            text: "Other channels are independent",
          })
        ).status,
        201,
      );
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await O("/messages", "POST", {
              channel: slow.id,
              text: "Owner bypass " + i,
            })
          ).status,
          201,
        );
      // A long cooldown survives restart, including when the original message was deleted.
      await O("/channels/" + slow.id, "PATCH", { slowmode: 30 });
      await stop();
      await start();
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: slow.id,
            text: "Restart cannot reset the clock",
          })
        ).status,
        429,
      );
      assert.equal((await getChannel(second.id)).category, "Public Lounge");
      assert.equal((await getChannel(third.id)).categoryId, null);
      assert.equal(
        (
          await O("/channels/" + slow.id, "PATCH", {
            slowmode: -1,
            name: "Invalid",
          })
        ).status,
        400,
      );
      assert.equal((await getChannel(slow.id)).name, "slow-chat");
      assert.equal(
        (
          await O(
            "/channels/" + s.channels.find((c) => c.type === "voice").id,
            "PATCH",
            { slowmode: 10 },
          )
        ).status,
        400,
      );
      const moderator = (
        await O(base + "/roles", "POST", {
          name: "Message Moderator",
          permissions: ["manageMessages"],
        })
      ).data;
      await O(base + "/members/" + member.id, "PATCH", {
        roles: [moderator.id],
      });
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await U("/messages", "POST", {
              channel: slow.id,
              text: "Moderator bypass " + i,
            })
          ).status,
          201,
        );
      await O(base + "/members/" + member.id, "PATCH", { roles: [] });
      await O("/channels/" + slow.id, "PATCH", { slowmode: 1 });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: slow.id,
            text: "Cooldown expired",
          })
        ).status,
        201,
      );
      await O("/channels/" + slow.id, "PATCH", { slowmode: 0 });
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: slow.id,
            text: "Disabled slowmode",
          })
        ).status,
        201,
      );
      await O("/channels/" + slow.id, "DELETE");
      const audit = (await O(base + "/audit")).data;
      assert.ok(
        audit.some((entry) => entry.action === "Category permissions updated"),
      );
      assert.ok(
        audit.some((entry) => entry.action === "Private channel created"),
      );
      await stop();
      const saved = JSON.parse(await readFile(dir + "/state.json", "utf8"));
      assert.equal(
        saved.cooldowns[slow.id],
        undefined,
        "channel deletion clears cooldown state",
      );
      // A real 2.1-shaped state file migrates without changing channel access or messages.
      for (const old of saved.servers) {
        for (const c of old.channels) {
          const category = old.categories.find((x) => x.id === c.categoryId);
          if (c.permissionSynced) c.overwrites = category?.overwrites || [];
          delete c.categoryId;
          delete c.permissionSynced;
          delete c.slowmode;
        }
        delete old.categories;
      }
      delete saved.cooldowns;
      await writeFile(dir + "/state.json", JSON.stringify(saved));
      await start();
      assert.equal((await getChannel(second.id)).category, "Public Lounge");
      assert.equal((await U("/messages?channel=" + third.id)).status, 200);
      assert.equal(
        (
          await U("/messages", "POST", {
            channel: third.id,
            text: "Migrated restriction",
          })
        ).status,
        403,
      );
      assert.equal(
        (await U("/messages?channel=" + inheritedSecret.id)).status,
        403,
      );
      assert.equal((await U("/messages?channel=" + secret.id)).status, 403);
      assert.equal(
        (await U("/messages?channel=" + first.id)).data[0].text,
        "Independent",
      );
    } finally {
      await stop();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
