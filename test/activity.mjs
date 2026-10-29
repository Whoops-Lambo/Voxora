import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  hasPersonalMention,
  notificationPolicy,
  shouldNotify,
} from "../public/activity.js";

test("mentions, reply alerts, mute expiration and notification modes have exact boundaries", () => {
  for (const [text, expected] of [
    ["Hi @ann", true],
    ["@ANN!", true],
    ["@anna", false],
    ["@ann.x", false],
    ["name@ann", false],
    ["\\@ann", false],
    ["`@ann`", false],
    ["```js\n@ann\n```", false],
  ])
    assert.equal(hasPersonalMention(text, "ann"), expected, text);
  assert.equal(hasPersonalMention("@a.b!", "a.b"), true);
  assert.equal(hasPersonalMention("@axb", "a.b"), false);
  const settings = {
    servers: { s: { mode: "mentions", mutedUntil: 500 } },
    channels: { c: { mode: "all", mutedUntil: 0 } },
  };
  assert.deepEqual(notificationPolicy(settings, "s", "c", 400), {
    mode: "all",
    muted: true,
  });
  assert.deepEqual(notificationPolicy(settings, "s", "c", 600), {
    mode: "all",
    muted: false,
  });
  const me = { id: "me", username: "ann" },
    message = { id: "m", authorId: "other", text: "Hello @ann" };
  const policy = { mode: "mentions", muted: false };
  assert.equal(shouldNotify(message, me, policy), true);
  for (const flags of [
    { dnd: true },
    { viewing: true },
    { blocked: ["other"] },
  ])
    assert.equal(shouldNotify(message, me, policy, flags), false);
  assert.equal(shouldNotify({ ...message, authorId: "me" }, me, policy), false);
  assert.equal(shouldNotify(message, me, { ...policy, muted: true }), false);
  assert.equal(
    shouldNotify(message, me, { ...policy, mode: "nothing" }),
    false,
  );
  assert.equal(
    shouldNotify(
      { ...message, text: "No mention", reply: { authorId: "me" } },
      me,
      policy,
    ),
    true,
  );
  assert.equal(
    shouldNotify({ ...message, text: "A DM" }, me, policy, { dm: true }),
    true,
  );
});

test(
  "read positions, private inboxes, settings and stale-request protection persist across restart",
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp("/tmp/voxora-activity-");
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
        const ended = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await ended;
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
      };
    }
    try {
      await start();
      assert.equal((await call(null, "/activity")).status, 401);
      const users = [];
      for (const username of [
        "activity_owner",
        "activity_member",
        "activity_outsider",
      ]) {
        const r = await call(null, "/auth/register", "POST", {
          username,
          password: "Fixture-password-325",
        });
        assert.equal(r.status, 200);
        users.push({ id: r.data.me.id, cookie: r.cookie });
      }
      const [owner, member, outsider] = users;
      const O = (route, method, data) =>
          call(owner.cookie, route, method, data),
        U = (route, method, data) => call(member.cookie, route, method, data),
        X = (route, method, data) => call(outsider.cookie, route, method, data);
      const server = (await O("/servers", "POST", { name: "Unread Lab" })).data;
      const channel = server.channels.find((c) => c.type === "text").id;
      const send = async (who, text, extra = {}) => {
        const r = await who("/messages", "POST", { channel, text, ...extra });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        return r.data;
      };
      await send(O, "History before joining @activity_member");
      await U("/invites/join", "POST", { code: server.invite });
      let overview = (await U("/activity")).data;
      assert.equal(
        overview.channels[channel].unread,
        0,
        "joining starts at the current history",
      );
      const ordinary = await send(O, "Ordinary message");
      const direct = await send(O, "Hello @ACTIVITY_MEMBER!");
      const mine = await send(U, "Question");
      const reply = await send(O, "A reply", { replyTo: mine.id });
      await send(O, "@activity_member_more");
      await send(O, "`@activity_member`");
      await send(O, "\\@activity_member");
      overview = (await U("/activity")).data;
      assert.equal(overview.channels[channel].unread, 6);
      assert.equal(overview.channels[channel].mentions, 2);
      assert.equal(overview.channels[channel].firstUnreadId, ordinary.id);
      assert.deepEqual(
        (await U("/inbox")).data.items.map((m) => m.id),
        [reply.id, direct.id],
      );
      assert.equal((await U("/inbox?type=unread")).data.items[0].unread, 6);
      assert.equal((await X("/activity")).data.channels[channel], undefined);
      assert.equal((await X("/inbox")).data.items.length, 0);
      assert.equal(
        (
          await X("/read-state", "POST", {
            channel,
            messageId: ordinary.id,
            version: 0,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await U("/notification-settings", "PATCH", {
            serverId: "missing",
            mode: "all",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await U("/read-state", "POST", {
            channel,
            messageId: direct.id,
            version: overview.channels[channel].version,
            userId: owner.id,
          })
        ).status,
        400,
      );
      const acknowledged = await U("/read-state", "POST", {
        channel,
        messageId: direct.id,
        version: overview.channels[channel].version,
      });
      assert.equal(acknowledged.status, 200);
      assert.equal(acknowledged.data.activity.channels[channel].unread, 4);
      assert.equal(acknowledged.data.activity.channels[channel].mentions, 1);
      assert.equal(
        (await O("/activity")).data.channels[channel].unread,
        1,
        "read positions belong only to the current user",
      );
      let c = acknowledged.data.activity.channels[channel];
      const version = c.version;
      const marked = await U("/read-state", "POST", {
        channel,
        messageId: direct.id,
        version,
        unread: true,
      });
      assert.equal(marked.status, 200);
      assert.equal(marked.data.activity.channels[channel].manualUnread, true);
      assert.equal(
        (
          await U("/read-state", "POST", {
            channel,
            messageId: reply.id,
            version,
          })
        ).status,
        409,
        "a stale device cannot clear an explicit unread marker",
      );
      overview = (await U("/activity")).data;
      const later = await send(O, "Arrived after mark-all snapshot");
      const all = await U("/read-state", "POST", {
        serverId: server.id,
        through: overview.through,
        revision: overview.revision,
      });
      assert.equal(all.status, 200);
      assert.equal(
        all.data.activity.channels[channel].unread,
        1,
        "mark-all never consumes messages beyond the requested watermark",
      );
      assert.equal(all.data.activity.channels[channel].firstUnreadId, later.id);
      const simultaneous = await Promise.all([
        U("/read-state", "POST", {
          channel,
          messageId: later.id,
          version: all.data.activity.channels[channel].version,
        }),
        U("/read-state", "POST", {
          channel,
          messageId: later.id,
          version: all.data.activity.channels[channel].version,
          unread: true,
        }),
      ]);
      assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 409]);
      assert.equal(
        (
          await U("/read-state", "POST", {
            all: true,
            through: Number.MAX_SAFE_INTEGER,
            revision: (await U("/activity")).data.revision,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await U("/read-state", "POST", {
            channel,
            messageId: "deleted",
            version: (await U("/activity")).data.channels[channel].version,
          })
        ).status,
        404,
      );
      await U("/notification-settings", "PATCH", {
        serverId: server.id,
        mode: "nothing",
        muteFor: -1,
      });
      await U("/notification-settings", "PATCH", {
        channel,
        mode: "all",
        muteFor: 0,
      });
      c = (await U("/activity")).data.channels[channel];
      assert.equal(c.mode, "all");
      assert.equal(
        c.muted,
        true,
        "channel overrides do not bypass a muted server",
      );
      await U("/notification-settings", "PATCH", {
        serverId: server.id,
        muteFor: 0,
      });
      assert.equal((await U("/activity")).data.channels[channel].muted, false);
      assert.equal(
        (await O("/activity")).data.channels[channel].mode,
        "mentions",
      );
      assert.equal(
        (
          await U("/notification-settings", "PATCH", {
            channel,
            mode: "administrator",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await U("/notification-settings", "PATCH", {
            channel,
            mode: "nothing",
            muteFor: 13,
          })
        ).status,
        400,
      );
      assert.equal(
        (await U("/activity")).data.channels[channel].mode,
        "all",
        "invalid settings never partially apply",
      );
      await U("/profile", "PATCH", { status: "dnd" });
      assert.equal((await U("/activity")).data.doNotDisturb, true);
      const dm = (await O("/conversations", "POST", { userId: member.id }))
        .data;
      const dmMessage = await send(O, "Private DM", { channel: dm.id });
      assert.ok(
        (await U("/inbox")).data.items.some((m) => m.id === dmMessage.id),
      );
      assert.equal((await X("/activity")).data.channels[dm.id], undefined);
      assert.equal(
        (await X("/messages?channel=" + dm.id + "&around=" + dmMessage.id))
          .status,
        403,
      );
      await U("/blocks/" + owner.id, "POST", {});
      assert.equal((await U("/activity")).data.channels[dm.id], undefined);
      assert.equal(
        (await U("/inbox")).data.items.length,
        0,
        "blocked users never populate mentions or DM alerts",
      );
      await U("/blocks/" + owner.id, "DELETE");

      const beforeRestart = (await U("/activity")).data;
      await stop();
      await start();
      const restored = (await U("/activity")).data;
      assert.deepEqual(restored, beforeRestart);
      assert.ok(
        (await U("/state")).data.users.every(
          (u) =>
            !("readState" in u) &&
            !("notificationSettings" in u) &&
            !("readBaseline" in u),
        ),
      );
      // Page far beyond the latest 200 messages without losing the exact target.
      await stop();
      const persisted = JSON.parse(await readFile(dir + "/state.json", "utf8"));
      const firstHistory = persisted.messageSequence + 1;
      for (let i = 0; i < 215; i++)
        persisted.messages.push({
          id: "history-" + i,
          sequence: ++persisted.messageSequence,
          channel,
          authorId: owner.id,
          text: "History " + i,
          time: Date.now() + i,
          files: [],
          reactions: [],
        });
      await writeFile(dir + "/state.json", JSON.stringify(persisted));
      await start();
      assert.equal(
        (await U("/messages?channel=" + channel)).data.some(
          (m) => m.id === direct.id,
        ),
        false,
      );
      assert.ok(
        (
          await U("/messages?channel=" + channel + "&around=" + direct.id)
        ).data.some((m) => m.id === direct.id),
      );
      const after = (
        await U("/messages?channel=" + channel + "&after=history-0")
      ).data;
      assert.equal(after[0].sequence, firstHistory + 1);
      assert.equal(after.length, 200);
      assert.equal(
        (
          await U(
            "/messages?channel=" +
              channel +
              "&around=" +
              direct.id +
              "&after=history-0",
          )
        ).status,
        400,
      );
      // Revocation while a request is in flight uses the current channel permissions.
      const endpoint = new URL(origin + "/api/read-state");
      let pending;
      c = (await U("/activity")).data.channels[channel];
      const delayed = new Promise((resolve, reject) => {
        pending = http.request(
          endpoint,
          {
            method: "POST",
            headers: {
              Cookie: member.cookie,
              "Content-Type": "application/json",
            },
          },
          (r) => {
            r.resume();
            r.on("end", () => resolve(r.statusCode));
          },
        );
        pending.on("error", reject);
        pending.write('{"channel":');
      });
      await O("/channels/" + channel, "PATCH", {
        overwrites: [
          { type: "member", id: member.id, allow: [], deny: ["viewChannel"] },
        ],
      });
      pending.end(
        JSON.stringify(channel) +
          ',"messageId":' +
          JSON.stringify(later.id) +
          ',"version":' +
          c.version +
          "}",
      );
      assert.equal(await delayed, 403);
      assert.equal((await U("/activity")).data.channels[channel], undefined);
      assert.equal(
        (await U("/inbox?type=unread")).data.items.some(
          (m) => m.channel === channel,
        ),
        false,
      );
      assert.equal(
        (await U("/inbox")).data.items.some((m) => m.channel === channel),
        false,
      );
      await O("/channels/" + channel, "DELETE");
      assert.equal(
        (await U("/activity")).data.settings.channels[channel],
        undefined,
      );
      // Migrate an actual old state shape, assigning stable sequences and treating old history as read.
      await stop();
      const old = JSON.parse(await readFile(dir + "/state.json", "utf8"));
      delete old.messageSequence;
      for (const message of old.messages) delete message.sequence;
      for (const user of old.users)
        for (const key of [
          "readBaseline",
          "readState",
          "activityRevision",
          "notificationSettings",
        ])
          delete user[key];
      await writeFile(dir + "/state.json", JSON.stringify(old));
      await start();
      const migrated = (await U("/activity")).data;
      assert.ok(Object.values(migrated.channels).every((c) => c.unread === 0));
      assert.ok(migrated.through > 0);
      const newDM = await send(O, "After upgrade", { channel: dm.id });
      assert.equal((await U("/activity")).data.channels[dm.id].unread, 1);
      assert.ok(newDM.sequence > migrated.through);
    } finally {
      await stop();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
