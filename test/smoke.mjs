import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
const entry = fileURLToPath(new URL("../server.js", import.meta.url));

test(
  "accounts, private servers and DMs, message actions, files and durable state",
  { timeout: 45000 },
  async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "voxora-test-"));
    let child, origin;
    async function start() {
      child = spawn(process.execPath, [entry], {
        cwd: temporary,
        env: {
          ...process.env,
          PORT: "0",
          VOXORA_HOST: "127.0.0.1",
          VOXORA_DATA_DIR: path.join(temporary, "profile"),
        },
        stdio: ["ignore", "pipe", "inherit"],
      });
      origin = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => reject(Error("Server exited " + code)));
        createInterface({ input: child.stdout }).on("line", (line) => {
          const match = line.match(/Voxora running on port (\d+)/);
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
    async function call(
      route,
      { cookie, method = "GET", body, raw, headers = {} } = {},
    ) {
      const response = await fetch(origin + "/api" + route, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      const type = response.headers.get("content-type") || "";
      return {
        status: response.status,
        data: type.includes("application/json")
          ? await response.json()
          : await response.text(),
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    }
    try {
      await mkdir(path.join(temporary, "profile"), { recursive: true });
      await writeFile(
        path.join(temporary, "profile/messages.json"),
        JSON.stringify(
          Array.from({ length: 210 }, (_, id) => ({
            id,
            channel: "general",
            author: "Legacy User",
            text: "Migrated message " + id,
            time: 1700000000000 + id,
          })),
        ),
      );
      await start();
      assert.match(await (await fetch(origin)).text(), /Voxora/);
      for (const asset of ["app.js", "style.css", "icons.js", "voice.js"])
        assert.equal((await fetch(origin + "/" + asset)).status, 200);
      assert.equal((await call("/state")).status, 401);
      const a = await call("/auth/register", {
        method: "POST",
        body: {
          username: "alice",
          password: "correct-horse-123",
          displayName: "Alice",
        },
      });
      assert.equal(a.status, 200);
      const alice = a.cookie;
      const aid = a.data.me.id;
      const recent = (
        await call("/messages?channel=general", { cookie: alice })
      ).data;
      assert.equal(recent.length, 200);
      const older = (
        await call("/messages?channel=general&before=" + recent[0].id, {
          cookie: alice,
        })
      ).data;
      assert.equal(older.length, 10);
      assert.equal(older[0].text, "Migrated message 0");
      assert.ok(!older.some((m) => recent.some((r) => r.id === m.id)));
      const b = await call("/auth/register", {
        method: "POST",
        body: {
          username: "bobby",
          password: "correct-horse-456",
          displayName: "Bob",
        },
      });
      assert.equal(b.status, 200);
      const bob = b.cookie,
        bid = b.data.me.id;
      const c = await call("/auth/register", {
        method: "POST",
        body: { username: "charlie", password: "correct-horse-789" },
      });
      const charlie = c.cookie;
      assert.equal(
        (
          await call("/auth/login", {
            method: "POST",
            body: { username: "alice", password: "wrong-password" },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await call("/auth/register", {
            method: "POST",
            body: { username: "alice", password: "correct-horse-123" },
          })
        ).status,
        409,
      );
      const stream = await fetch(
        origin + "/api/events?client=test-alice-client",
        { headers: { Cookie: alice } },
      );
      const reader = stream.body.getReader();
      await reader.read();
      try {
        const created = await call("/servers", {
          cookie: alice,
          method: "POST",
          body: { name: "Private workshop" },
        });
        assert.equal(created.status, 201);
        const server = created.data,
          channel = server.channels[0].id;
        assert.equal(
          (await call("/messages?channel=" + channel, { cookie: bob })).status,
          403,
        );
        const joined = await call("/invites/join", {
          cookie: bob,
          method: "POST",
          body: { code: server.invite },
        });
        assert.equal(joined.status, 200);
        const channelCreated = await call(
          "/servers/" + server.id + "/channels",
          {
            cookie: alice,
            method: "POST",
            body: { name: "Project Chat", topic: "Build together" },
          },
        );
        assert.equal(channelCreated.status, 201);
        assert.equal(
          (
            await call("/channels/" + channelCreated.data.id, {
              cookie: bob,
              method: "DELETE",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/channels/" + channelCreated.data.id, {
              cookie: alice,
              method: "PATCH",
              body: { topic: "" },
            })
          ).status,
          200,
        );
        const upload = await call("/files?channel=" + channel, {
          cookie: alice,
          method: "POST",
          raw: Buffer.from("test attachment"),
          headers: { "Content-Type": "text/plain", "X-File-Name": "notes.txt" },
        });
        assert.equal(upload.status, 201);
        const sent = await call("/messages", {
          cookie: alice,
          method: "POST",
          body: { channel, text: "**Hello** @bobby", files: [upload.data.id] },
        });
        assert.equal(sent.status, 201);
        const message = sent.data;
        assert.equal(message.authorId, aid);
        assert.equal(message.attachments[0].name, "notes.txt");
        assert.equal(
          (await call("/files/" + upload.data.id, { cookie: charlie })).status,
          404,
        );
        assert.equal(
          (await call("/files/" + upload.data.id, { cookie: bob })).data,
          "test attachment",
        );
        assert.equal(
          (
            await call("/messages/" + message.id, {
              cookie: bob,
              method: "PATCH",
              body: { text: "hijack" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/messages/" + message.id, {
              cookie: alice,
              method: "PATCH",
              body: { text: "Edited project update" },
            })
          ).status,
          200,
        );
        const reaction = await call("/messages/" + message.id + "/reactions", {
          cookie: bob,
          method: "POST",
          body: { emoji: "🔥" },
        });
        assert.deepEqual(reaction.data.reactions, [
          { emoji: "🔥", userIds: [bid] },
        ]);
        assert.equal(
          (
            await call("/messages/" + message.id + "/pin", {
              cookie: alice,
              method: "POST",
              body: {},
            })
          ).data.pinned,
          true,
        );
        const reply = await call("/messages", {
          cookie: bob,
          method: "POST",
          body: { channel, text: "Reply from Bob", replyTo: message.id },
        });
        assert.equal(reply.data.reply.id, message.id);
        assert.equal(
          (await call("/search?q=project&server=" + server.id, { cookie: bob }))
            .data.length,
          1,
        );
        assert.equal(
          (
            await call("/search?q=project&server=" + server.id, {
              cookie: charlie,
            })
          ).data.length,
          0,
        );
        const request = await call("/friends/request", {
          cookie: alice,
          method: "POST",
          body: { username: "bobby" },
        });
        assert.equal(request.status, 201);
        assert.equal(
          (
            await call("/friends/" + request.data.id, {
              cookie: alice,
              method: "PATCH",
              body: {},
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/friends/" + request.data.id, {
              cookie: bob,
              method: "PATCH",
              body: {},
            })
          ).status,
          200,
        );
        const dm = await call("/conversations", {
          cookie: alice,
          method: "POST",
          body: { userId: bid },
        });
        assert.equal(dm.status, 200);
        const dmMessage = await call("/messages", {
          cookie: alice,
          method: "POST",
          body: { channel: dm.data.id, text: "Private hello" },
        });
        assert.equal(dmMessage.status, 201);
        assert.equal(
          (await call("/messages?channel=" + dm.data.id, { cookie: charlie }))
            .status,
          403,
        );
        assert.equal(
          (
            await call("/blocks/" + aid, {
              cookie: bob,
              method: "POST",
              body: {},
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await call("/messages", {
              cookie: alice,
              method: "POST",
              body: { channel: dm.data.id, text: "blocked" },
            })
          ).status,
          403,
        );
        assert.equal(
          (await call("/blocks/" + aid, { cookie: bob, method: "DELETE" }))
            .status,
          200,
        );
        const voiceChannel = server.channels.find((c) => c.type === "voice").id;
        assert.equal(
          (
            await call("/voice/join", {
              cookie: alice,
              method: "POST",
              body: { channel: voiceChannel, clientId: "test-alice-client" },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await call("/voice/join", {
              cookie: charlie,
              method: "POST",
              body: { channel: voiceChannel, clientId: "not-connected" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/voice/leave", {
              cookie: alice,
              method: "POST",
              body: { clientId: "test-alice-client" },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await call("/messages", {
              cookie: alice,
              method: "POST",
              body: null,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call("/messages", {
              cookie: alice,
              method: "POST",
              body: { channel, text: "x" },
              headers: { Origin: "https://evil.example" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/messages/" + reply.data.id, {
              cookie: bob,
              method: "DELETE",
            })
          ).status,
          200,
        );
        await reader.cancel();
        await stop();
        await start();
        const restored = await call("/messages?channel=" + channel, {
          cookie: alice,
        });
        assert.equal(restored.status, 200);
        assert.equal(restored.data[0].text, "Edited project update");
        assert.equal(restored.data[0].pinned, true);
        assert.equal(restored.data[0].reactions[0].emoji, "🔥");
        const disk = JSON.parse(
          await readFile(path.join(temporary, "profile/state.json"), "utf8"),
        );
        assert.ok(!JSON.stringify(disk).includes("correct-horse"));
        assert.ok(disk.users[0].password.length === 128);
        assert.ok(
          !JSON.stringify(
            (await call("/state", { cookie: alice })).data,
          ).includes("password"),
        );
        assert.equal(
          (
            await call("/auth/logout", {
              cookie: alice,
              method: "POST",
              body: {},
            })
          ).status,
          200,
        );
        assert.equal((await call("/state", { cookie: alice })).status, 401);
      } finally {
        await reader.cancel().catch(() => {});
      }
    } finally {
      await stop();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
