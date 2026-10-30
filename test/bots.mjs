import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fixture, until } from "./support/server.mjs";
import { VoxoraBot } from "../sdk/voxora.mjs";

test(
  "bot applications, revocable tokens, channel scopes, gateways, SDK commands and removals enforce isolation",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let stream, sdk, connecting;
    try {
      const owner = await f.register("bot_owner"),
        member = await f.register("bot_member"),
        developer = await f.register("bot_developer");
      const O = (p, m, d) => f.call(owner, p, m, d),
        U = (p, m, d) => f.call(member, p, m, d),
        D = (p, m, d) => f.call(developer, p, m, d);
      const s = (await O("/servers", "POST", { name: "Bot Lab" })).data,
        channel = s.channels.find((c) => c.type === "text").id;
      await U("/invites/join", "POST", { code: s.invite });
      const app = await D("/applications", "POST", {
        name: "Example Bot",
        description: "Testing real bot support",
      });
      assert.equal(app.status, 201);
      assert.match(app.data.token, /^vxb_[a-f0-9]{64}$/);
      const application = app.data.application,
        bot = { token: app.data.token };
      assert.equal(
        JSON.stringify((await D("/applications")).data).includes(bot.token),
        false,
      );
      assert.equal(
        JSON.stringify((await D("/applications")).data).includes("tokenHash"),
        false,
      );
      assert.equal(
        (await U("/applications/" + application.id + "/token", "POST", {}))
          .status,
        403,
      );
      assert.equal((await f.call(bot, "/state")).status, 401);
      assert.equal((await f.call(owner, "/bot/me")).status, 401);
      assert.equal(
        (
          await U("/servers/" + s.id + "/bots", "POST", {
            applicationId: application.id,
          })
        ).status,
        403,
      );
      const installed = await O("/servers/" + s.id + "/bots", "POST", {
        applicationId: application.id,
        channelIds: [channel],
      });
      assert.equal(installed.status, 201);
      assert.equal(
        (
          await O("/servers/" + s.id + "/bots", "POST", {
            applicationId: application.id,
          })
        ).status,
        409,
      );
      const extra = (
        await O("/servers/" + s.id + "/channels", "POST", {
          name: "not-in-scope",
        })
      ).data;
      assert.equal(
        (await f.call(bot, "/bot/channels/" + extra.id + "/messages")).status,
        403,
      );
      const state = (await f.call(bot, "/bot/me")).data;
      assert.deepEqual(
        state.servers[0].channels.map((c) => c.id),
        [channel],
      );
      assert.ok(
        !(await U("/state")).data.servers.find((v) => v.id === s.id)
          .botInstallations,
      );
      const botUser = (await O("/state")).data.users.find(
        (u) => u.id === application.userId,
      );
      assert.equal(botUser.bot, true);
      assert.equal(
        (
          await O("/auth/login", "POST", {
            username: botUser.username,
            password: "Fixture-password-987",
          })
        ).status,
        401,
      );
      assert.equal(
        (await O("/conversations", "POST", { userId: botUser.id })).status,
        400,
      );
      assert.equal(
        (await O("/friends/request", "POST", { username: botUser.username }))
          .status,
        400,
      );
      assert.equal(
        (
          await O("/servers/" + s.id + "/transfer", "POST", {
            userId: botUser.id,
            confirmation: s.name,
          })
        ).status,
        400,
      );
      stream = await f.gateway(bot.token);
      await until(() => stream.events.find((e) => e.type === "READY"));
      const sent = await f.call(
        bot,
        "/bot/channels/" + channel + "/messages",
        "POST",
        { text: "A bot message", authorId: member.id },
      );
      assert.equal(sent.status, 201);
      assert.equal(sent.data.authorId, botUser.id);
      assert.equal(sent.data.bot, true);
      await until(() =>
        stream.events.some(
          (e) => e.type === "MESSAGE_CREATE" && e.message.id === sent.data.id,
        ),
      );
      assert.equal(
        (
          await f.call(bot, "/bot/messages/" + sent.data.id, "PATCH", {
            text: "Edited by bot",
          })
        ).status,
        200,
      );
      await until(() =>
        stream.events.some(
          (e) =>
            e.type === "MESSAGE_UPDATE" && e.message.text === "Edited by bot",
        ),
      );
      const human = (
        await U("/messages", "POST", { channel, text: "Human text" })
      ).data;
      assert.equal(
        (
          await f.call(bot, "/bot/messages/" + human.id, "PATCH", {
            text: "Forged",
          })
        ).status,
        403,
      );
      assert.equal(
        (await f.call(bot, "/bot/messages/" + human.id, "DELETE")).status,
        403,
      );
      assert.equal(
        (
          await f.call(
            bot,
            "/bot/messages/" + human.id + "/reactions",
            "POST",
            { emoji: "✅" },
          )
        ).status,
        200,
      );
      const moderator = (
        await O("/servers/" + s.id + "/roles", "POST", {
          name: "Bot Moderator",
          permissions: ["manageMessages"],
        })
      ).data;
      await O("/servers/" + s.id + "/members/" + botUser.id, "PATCH", {
        roles: [moderator.id],
      });
      assert.equal(
        (await f.call(bot, "/bot/messages/" + human.id, "DELETE")).status,
        200,
      );
      const hidden = (
        await O("/messages", "POST", {
          channel: extra.id,
          text: "Never delivered outside scope",
        })
      ).data;
      assert.equal(
        stream.events.some((e) => e.message?.id === hidden.id),
        false,
      );
      await O("/servers/" + s.id + "/bots/" + application.id, "PATCH", {
        channelIds: null,
      });
      await O("/channels/" + extra.id, "PATCH", {
        overwrites: [
          { type: "member", id: botUser.id, allow: [], deny: ["viewChannel"] },
        ],
      });
      assert.equal(
        (await f.call(bot, "/bot/channels/" + extra.id + "/messages")).status,
        403,
        "channel overrides remain authoritative",
      );
      assert.equal(
        (
          await f.call(bot, "/bot/commands", "PUT", {
            commands: [{ description: "Missing name" }],
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await f.call(bot, "/bot/commands", "PUT", {
            commands: [{ name: "echo", description: "Repeat your input" }],
          })
        ).status,
        200,
      );
      const invoked = await U("/commands", "POST", {
        channel,
        name: "echo",
        arguments: "Hello SDK",
        applicationId: application.id,
      });
      assert.equal(invoked.status, 202);
      await until(() =>
        stream.events.find(
          (e) =>
            e.type === "INTERACTION_CREATE" &&
            e.interaction.id === invoked.data.interactionId,
        ),
      );
      assert.equal((await f.call(bot, "/bot/interactions")).data.length, 1);
      const reply = await f.call(
        bot,
        "/bot/interactions/" + invoked.data.interactionId + "/respond",
        "POST",
        { text: "A custom command response" },
      );
      assert.equal(reply.status, 201);
      assert.equal(
        (
          await f.call(
            bot,
            "/bot/interactions/" + invoked.data.interactionId + "/respond",
            "POST",
            { text: "Duplicate" },
          )
        ).status,
        409,
      );
      assert.equal((await f.call(bot, "/bot/interactions")).data.length, 0);
      assert.equal(
        (await U("/messages?channel=" + channel)).data.find(
          (m) => m.id === invoked.data.invocation.id,
        ).command.status,
        "completed",
      );
      // A request started with an old token must not survive rotation while its body is incomplete.
      let pending;
      const delayed = new Promise((resolve, reject) => {
        pending = http.request(
          f.origin + "/api/bot/channels/" + channel + "/messages",
          {
            method: "POST",
            headers: {
              Authorization: "Bot " + bot.token,
              "Content-Type": "application/json",
            },
          },
          (r) => {
            r.resume();
            r.on("end", () => resolve(r.statusCode));
          },
        );
        pending.on("error", reject);
        pending.write('{"text":"Late');
      });
      const rotated = await D(
        "/applications/" + application.id + "/token",
        "POST",
        {},
      );
      assert.equal(rotated.status, 200);
      pending.end(' request"}');
      assert.equal(await delayed, 401);
      await until(() => stream.closed());
      await stream.close();
      stream = null;
      assert.equal((await f.call(bot, "/bot/me")).status, 401);
      bot.token = rotated.data.token;
      sdk = new VoxoraBot({ url: f.origin, token: bot.token });
      assert.equal(JSON.stringify(sdk).includes(bot.token), false);
      await sdk.registerCommands([
        { name: "echo", description: "SDK command" },
      ]);
      let ready = false;
      const errors = [];
      sdk.on("ready", () => {
        ready = true;
      });
      sdk.on("error", (e) => errors.push(e.status));
      sdk.on("interaction", (i) => i.respond("SDK received: " + i.arguments));
      connecting = sdk.connect();
      await until(() => ready);
      const viaSDK = await U("/commands", "POST", {
        channel,
        name: "echo",
        arguments: "Live command",
        applicationId: application.id,
      });
      await until(async () =>
        (await U("/messages?channel=" + channel)).data.some(
          (m) =>
            m.replyTo === viaSDK.data.invocation.id &&
            m.text === "SDK received: Live command",
        ),
      );
      assert.deepEqual(errors, []);
      await O("/servers/" + s.id + "/bots/" + application.id, "PATCH", {
        enabled: false,
      });
      assert.equal((await sdk.getState()).servers[0].channels.length, 0);
      assert.equal(
        (
          await f.call(bot, "/bot/channels/" + channel + "/messages", "POST", {
            text: "Paused",
          })
        ).status,
        403,
      );
      await O("/servers/" + s.id + "/bots/" + application.id, "DELETE");
      assert.equal((await sdk.getState()).servers.length, 0);
      sdk.close();
      await connecting;
      sdk = null;
      await f.stop();
      const saved = JSON.parse(await readFile(f.dir + "/state.json", "utf8"));
      assert.equal(JSON.stringify(saved).includes(bot.token), false);
      assert.equal(JSON.stringify(saved).includes(app.data.token), false);
      await f.start();
      assert.equal((await f.call(bot, "/bot/me")).status, 200);
      await D("/applications/" + application.id + "/revoke", "POST", {});
      assert.equal((await f.call(bot, "/bot/me")).status, 401);
      await D("/applications/" + application.id, "DELETE");
      assert.equal((await D("/applications")).data.length, 0);
    } finally {
      sdk?.close();
      if (connecting) await connecting.catch(() => {});
      await stream?.close();
      await f.cleanup();
    }
  },
);
