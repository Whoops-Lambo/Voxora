import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
  randomInt,
} from "node:crypto";
import { initializeActivityUser } from "./read-service.js";
import {
  channelPermissions,
  outranks,
  roleRank,
  serverPermissions,
} from "./public/permissions.js";
import { normalizePoll } from "./polls.js";
import { isSuspended } from "./platform.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const BUILTIN = "voxora-helper";
const utilityCommands = [
  { name: "help", description: "Show Voxora Helper commands.", usage: "/help" },
  {
    name: "ping",
    description: "Check that the helper is running.",
    usage: "/ping",
  },
  { name: "roll", description: "Roll up to 20 dice.", usage: "/roll 2d6" },
  {
    name: "server",
    description: "Show information about this server.",
    usage: "/server",
  },
  {
    name: "poll",
    description: "Create a poll with 2–10 choices.",
    usage: "/poll Question | Choice 1 | Choice 2",
  },
];
export function initializeBots(state) {
  state.botApplications ||= [];
  state.botInteractions ||= [];
  if (!state.botApplications.some((a) => a.id === BUILTIN)) {
    const user = {
      id: randomUUID(),
      username: "bot_" + randomBytes(8).toString("hex"),
      displayName: "Voxora Helper",
      bot: true,
      applicationId: BUILTIN,
      color: "#5865f2",
      bio: "Built-in commands, dice rolls, server information and polls.",
      status: "online",
      blocked: [],
      createdAt: Date.now(),
    };
    initializeActivityUser(user, state.messageSequence || 0);
    state.users.push(user);
    state.botApplications.push({
      id: BUILTIN,
      ownerId: null,
      userId: user.id,
      name: user.displayName,
      description: user.bio,
      builtin: true,
      tokenHash: null,
      tokenVersion: 0,
      commands: utilityCommands,
      createdAt: Date.now(),
    });
  }
  for (const s of state.servers) s.botInstallations ||= [];
}
export function botService({
  state,
  body,
  fail,
  json,
  save,
  refresh,
  rate,
  serverFor,
  canRead,
  canChannel,
  userById,
  publicUser,
  createMessage,
  messageView,
  channelEvent,
  management,
  threadTools,
  removeMessageThreads,
  expressions,
}) {
  const clients = new Set();
  const appById = (id) => state.botApplications.find((a) => a.id === id);
  const installations = (a) =>
    state.servers.filter(
      (s) =>
        s.members.includes(a.userId) &&
        s.botInstallations.some((i) => i.applicationId === a.id),
    );
  const member = (a) => userById(a.userId);
  const validClient = (c) => {
    const a = appById(c.appId);
    return (
      a &&
      !a.disabled &&
      !isSuspended(userById(a.ownerId)) &&
      a.tokenHash &&
      a.tokenHash === c.tokenHash
    );
  };
  function allowed(a, channel, permission = "viewChannel") {
    const s = serverFor(channel),
      user = member(a);
    const i = s?.botInstallations?.find((i) => i.applicationId === a.id);
    return !!(
      !a.disabled &&
      !isSuspended(userById(a.ownerId)) &&
      s &&
      user &&
      i?.enabled &&
      s.members.includes(user.id) &&
      s.channels.some((c) => c.id === channel && c.type === "text") &&
      (i.channelIds === null || i.channelIds.includes(channel)) &&
      canRead(user, channel) &&
      canChannel(user, channel, permission)
    );
  }
  function assertChannel(a, channel, permission = "viewChannel") {
    if (!allowed(a, channel, permission))
      fail(
        403,
        "This bot cannot access or perform this action in the channel.",
      );
  }
  function appView(a, owner = false) {
    const value = {
      id: a.id,
      name: a.name,
      description: a.description,
      userId: a.userId,
      builtin: !!a.builtin,
      commands: a.commands,
      createdAt: a.createdAt,
      disabled: !!a.disabled,
      disabledReason: a.disabledReason || "",
    };
    return owner
      ? {
          ...value,
          hasToken: !!a.tokenHash,
          tokenVersion: a.tokenVersion,
          installedServers: installations(a).length,
        }
      : value;
  }
  function gatewayState(a) {
    return {
      application: appView(a),
      user: publicUser(member(a)),
      servers: installations(a).map((s) => ({
        id: s.id,
        name: s.name,
        emojis: expressions.list(s.id).map(({ id, name, code }) => ({ id, name, code })),
        channels: s.channels
          .filter((c) => allowed(a, c.id))
          .map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            topic: c.topic,
            permissions: channelPermissions(s, a.userId, c.id),
          })),
      })),
    };
  }
  function authenticate(req) {
    const match = req.headers.authorization?.match(/^Bot (vxb_[a-f0-9]{64})$/);
    if (!match) fail(401, "Use Authorization: Bot <token>.");
    const hash = digest(match[1]);
    const a = state.botApplications.find(
      (a) =>
        a.tokenHash &&
        timingSafeEqual(
          Buffer.from(a.tokenHash, "hex"),
          Buffer.from(hash, "hex"),
        ),
    );
    if (!a || a.builtin) fail(401, "Invalid or revoked bot token.");
    if (a.disabled || isSuspended(userById(a.ownerId)))
      fail(403, "This application or its owner is suspended.");
    return a;
  }
  const emit = (c, data) => {
    if (!c.res.writableEnded)
      c.res.write("data: " + JSON.stringify(data) + "\n\n");
  };
  function refreshGateways() {
    for (const c of clients) {
      if (!validClient(c)) {
        clients.delete(c);
        c.res.end();
      } else
        emit(c, { type: "STATE_UPDATE", ...gatewayState(appById(c.appId)) });
    }
  }
  function publish(channel, event) {
    const type = {
      message: "MESSAGE_CREATE",
      "message-update": "MESSAGE_UPDATE",
      "message-delete": "MESSAGE_DELETE",
      "thread-message": "THREAD_MESSAGE_CREATE",
      "thread-message-update": "THREAD_MESSAGE_UPDATE",
      "thread-message-delete": "THREAD_MESSAGE_DELETE",
      "thread-state": "THREAD_UPDATE",
      "thread-deleted": "THREAD_DELETE",
    }[event.type];
    if (!type) return;
    for (const c of clients)
      if (validClient(c) && allowed(appById(c.appId), channel))
        emit(c, { ...event, type });
  }
  function online(id) {
    const a = state.botApplications.find((a) => a.userId === id);
    if (a?.disabled || isSuspended(userById(a?.ownerId))) return false;
    return (
      !!a &&
      (a.builtin
        ? installations(a).some((s) =>
            s.botInstallations.some(
              (i) => i.applicationId === a.id && i.enabled,
            ),
          )
        : [...clients].some((c) => c.appId === a.id && validClient(c)))
    );
  }
  function editable(s, me, a) {
    management.requirePermission(s, me, "manageServer");
    if (
      s.members.includes(a.userId) &&
      s.ownerId !== me.id &&
      roleRank(s, a.userId) > 0 &&
      !outranks(s, me.id, a.userId)
    )
      fail(403, "You can only manage bots below your highest role.");
  }
  function channelScope(s, me, ids) {
    if (ids === null) return null;
    if (
      !Array.isArray(ids) ||
      ids.length > 500 ||
      new Set(ids).size !== ids.length ||
      ids.some(
        (id) =>
          !s.channels.some((c) => c.id === id && c.type === "text") ||
          !canRead(me, id),
      )
    )
      fail(
        400,
        "Choose text channels that you can view, or allow all visible channels.",
      );
    return [...ids];
  }
  function installationView(s, i, me) {
    const a = appById(i.applicationId);
    return {
      ...i,
      channelIds: i.channelIds?.filter((id) => canRead(me, id)) ?? null,
      hiddenChannels:
        i.channelIds?.filter((id) => !canRead(me, id)).length || 0,
      application: appView(a),
      online: online(a.userId),
    };
  }
  function removeInstallation(s, a) {
    s.botInstallations = s.botInstallations.filter(
      (i) => i.applicationId !== a.id,
    );
    s.members = s.members.filter((id) => id !== a.userId);
    delete s.memberRoles[a.userId];
    delete s.timeouts[a.userId];
    for (const c of [...s.channels, ...s.categories])
      c.overwrites = c.overwrites.filter(
        (o) => o.type !== "member" || o.id !== a.userId,
      );
    for (const interaction of state.botInteractions.filter(
      (x) => x.applicationId === a.id && x.serverId === s.id && !x.responseId,
    ))
      interaction.cancelled = true;
  }
  function name(value, max = 60) {
    if (typeof value !== "string" || !value.trim() || value.length > max)
      fail(400, "Enter a valid name.");
    return value.trim();
  }
  function description(value) {
    if (typeof value !== "string" || value.length > 500)
      fail(400, "Descriptions must be 500 characters or fewer.");
    return value.trim();
  }
  function generateToken(a) {
    const token = "vxb_" + randomBytes(32).toString("hex");
    a.tokenHash = digest(token);
    a.tokenVersion++;
    return token;
  }
  function available(me, channel) {
    const s = serverFor(channel);
    if (!s || !canRead(me, channel) || !canChannel(me, channel, "sendMessages"))
      return [];
    return (s.botInstallations || []).flatMap((i) => {
      const a = appById(i.applicationId);
      return a && allowed(a, channel, "sendMessages")
        ? a.commands.map((c) => ({
            ...c,
            applicationId: a.id,
            botName: a.name,
            botUserId: a.userId,
          }))
        : [];
    });
  }
  function interactionAllowed(a, interaction) {
    const s = state.servers.find((s) => s.id === interaction.serverId);
    const installation = s?.botInstallations.find(
      (i) => i.id === interaction.installationId,
    );
    const actor = userById(interaction.userId);
    return (
      !!installation &&
      installation.applicationId === a.id &&
      !interaction.cancelled &&
      actor &&
      !isSuspended(actor) &&
      state.messages.some((m) => m.id === interaction.messageId) &&
      canRead(actor, interaction.channel) &&
      canChannel(actor, interaction.channel, "sendMessages") &&
      allowed(a, interaction.channel, "sendMessages")
    );
  }
  function interactionView(i) {
    return {
      id: i.id,
      applicationId: i.applicationId,
      serverId: i.serverId,
      channel: i.channel,
      messageId: i.messageId,
      command: i.name,
      arguments: i.arguments,
      user: publicUser(userById(i.userId)),
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    };
  }
  function builtinResponse(s, me, command, args) {
    if (command === "help")
      return {
        text:
          "**Voxora Helper**\n" +
          utilityCommands
            .map((c) => "`" + c.usage + "` — " + c.description)
            .join("\n"),
      };
    if (command === "ping") return { text: "Pong! Voxora Helper is online." };
    if (command === "server")
      return {
        text:
          "**" +
          s.name +
          "**\n" +
          s.members.length +
          " members · " +
          s.channels.filter((c) => canRead(me, c.id)).length +
          " visible channels\n" +
          (s.description || "Your place to hang out."),
      };
    if (command === "roll") {
      const match = (args || "1d6").trim().match(/^(\d{1,2})d(\d{1,4})$/i);
      if (
        !match ||
        +match[1] < 1 ||
        +match[1] > 20 ||
        +match[2] < 2 ||
        +match[2] > 1000
      )
        fail(400, "Use /roll NdM, with 1–20 dice and 2–1000 sides.");
      const values = Array.from({ length: +match[1] }, () =>
        randomInt(1, +match[2] + 1),
      );
      return {
        text:
          "Rolled **" +
          match[1] +
          "d" +
          match[2] +
          "**: " +
          values.join(", ") +
          " · Total **" +
          values.reduce((a, b) => a + b, 0) +
          "**",
      };
    }
    const parts = args.split("|").map((p) => p.trim());
    const poll = {
      question: parts[0],
      answers: parts.slice(1),
      durationHours: 24,
    };
    normalizePoll(poll, me.id, fail);
    return { poll };
  }
  async function handleHuman(req, res, url, me) {
    const route = url.pathname,
      method = req.method;
    const appMatch = route.match(
      /^\/api\/applications(?:\/([\w-]+)(?:\/(token|revoke))?)?$/,
    );
    const installMatch = route.match(
      /^\/api\/servers\/([\w-]+)\/bots(?:\/([\w-]+))?$/,
    );
    if (route === "/api/bot-catalog" && method === "GET") {
      json(
        res,
        200,
        state.botApplications.filter((a) => a.builtin).map((a) => appView(a)),
      );
      return true;
    }
    if (route === "/api/commands") {
      if (method === "GET") {
        json(res, 200, available(me, url.searchParams.get("channel")));
        return true;
      }
      if (method !== "POST") fail(405, "Method not allowed.");
      const d = await body(req);
      const choices = available(me, d.channel).filter(
        (c) =>
          c.name === d.name &&
          (!d.applicationId || c.applicationId === d.applicationId),
      );
      if (!choices.length)
        fail(
          403,
          "This command is unavailable. Check the bot installation and channel permissions.",
        );
      if (choices.length > 1)
        fail(
          409,
          "Choose which bot should handle this command from the command picker.",
        );
      if (
        typeof (d.arguments ?? "") !== "string" ||
        (d.arguments || "").length > 1000
      )
        fail(400, "Command arguments must be 1000 characters or fewer.");
      const command = choices[0],
        a = appById(command.applicationId),
        s = serverFor(d.channel),
        args = (d.arguments || "").trim();
      const response = a.builtin
        ? builtinResponse(s, me, command.name, args)
        : null;
      state.botInteractions = state.botInteractions.filter(
        (i) => i.createdAt > Date.now() - 86400000,
      );
      if (
        !a.builtin &&
        state.botInteractions.filter(
          (i) =>
            i.applicationId === a.id &&
            !i.responseId &&
            !i.cancelled &&
            i.expiresAt > Date.now(),
        ).length >= 100
      )
        fail(429, "This bot has too many pending commands. Try again later.");
      const interaction = {
        id: randomUUID(),
        applicationId: a.id,
        installationId: s.botInstallations.find((i) => i.applicationId === a.id)
          .id,
        serverId: s.id,
        channel: d.channel,
        userId: me.id,
        name: command.name,
        arguments: args,
        createdAt: Date.now(),
        expiresAt: Date.now() + 900000,
        responseId: null,
      };
      const invocation = await createMessage(
        me,
        {
          channel: d.channel,
          text: "/" + command.name + (args ? " " + args : ""),
        },
        {
          command: {
            applicationId: a.id,
            name: command.name,
            botName: a.name,
            interactionId: a.builtin ? null : interaction.id,
          },
          beforeSave: a.builtin
            ? null
            : (m) => {
                interaction.messageId = m.id;
                state.botInteractions.push(interaction);
              },
        },
      );
      if (a.builtin) {
        assertChannel(a, d.channel, "sendMessages");
        if (!canRead(me, d.channel))
          fail(403, "You no longer have access to this channel.");
        const reply = await createMessage(
          member(a),
          { channel: d.channel, replyTo: invocation.id, ...response },
          { pollCreatorId: me.id },
        );
        json(res, 201, { invocation, response: reply });
      } else {
        if (interactionAllowed(a, interaction))
          for (const c of clients)
            if (c.appId === a.id && validClient(c))
              emit(c, {
                type: "INTERACTION_CREATE",
                interaction: interactionView(interaction),
              });
        json(res, 202, { invocation, interactionId: interaction.id });
      }
      return true;
    }
    if (appMatch) {
      const [, id, action] = appMatch;
      if (!id && method === "GET") {
        json(
          res,
          200,
          state.botApplications
            .filter((a) => a.ownerId === me.id)
            .map((a) => appView(a, true)),
        );
        return true;
      }
      const d = ["POST", "PATCH"].includes(method) ? await body(req) : {};
      if (!id && method === "POST") {
        if (
          state.botApplications.filter((a) => a.ownerId === me.id).length >= 20
        )
          fail(400, "You can create up to 20 applications.");
        const appName = name(d.name),
          bio = description(d.description || "");
        const a = {
          id: randomUUID(),
          ownerId: me.id,
          userId: randomUUID(),
          name: appName,
          description: bio,
          builtin: false,
          commands: [],
          tokenVersion: 0,
          createdAt: Date.now(),
        };
        const token = generateToken(a);
        const bot = {
          id: a.userId,
          applicationId: a.id,
          bot: true,
          username: "bot_" + randomBytes(8).toString("hex"),
          displayName: a.name,
          bio,
          color: "#5865f2",
          status: "online",
          blocked: [],
          createdAt: a.createdAt,
        };
        initializeActivityUser(bot, state.messageSequence);
        state.users.push(bot);
        state.botApplications.push(a);
        await save();
        json(res, 201, { application: appView(a, true), token });
        return true;
      }
      const a = appById(id);
      if (!a) fail(404, "Application not found.");
      if (method === "GET" && !action) {
        json(res, 200, appView(a, a.ownerId === me.id));
        return true;
      }
      if (a.builtin || a.ownerId !== me.id)
        fail(403, "Only the application owner can manage it.");
      if (method === "POST" && ["token", "revoke"].includes(action)) {
        const token = action === "token" ? generateToken(a) : null;
        if (!token) {
          a.tokenHash = null;
          a.tokenVersion++;
        }
        await save();
        refresh();
        json(res, 200, {
          application: appView(a, true),
          ...(token ? { token } : {}),
        });
        return true;
      }
      if (method === "PATCH" && !action) {
        const patch = {
          name: d.name === undefined ? a.name : name(d.name),
          description:
            d.description === undefined
              ? a.description
              : description(d.description),
        };
        Object.assign(a, patch);
        Object.assign(member(a), { displayName: a.name, bio: a.description });
        await save();
        refresh();
        json(res, 200, appView(a, true));
        return true;
      }
      if (method === "DELETE" && !action) {
        for (const s of installations(a)) {
          removeInstallation(s, a);
          management.log(s, me, "Bot application deleted", a.name);
        }
        state.botApplications = state.botApplications.filter((x) => x !== a);
        // Retain the public bot identity so historical messages remain attributed.
        await save();
        refresh();
        json(res, 200, { ok: true });
        return true;
      }
      fail(405, "Method not allowed.");
    }
    if (installMatch) {
      const [, sid, id] = installMatch;
      const d = ["POST", "PATCH"].includes(method) ? await body(req) : {};
      const s = state.servers.find(
        (s) => s.id === sid && s.members.includes(me.id),
      );
      if (!s) fail(404, "Server not found.");
      management.requirePermission(s, me, "manageServer");
      if (!id && method === "GET") {
        json(
          res,
          200,
          s.botInstallations
            .filter(
              (i) =>
                appById(i.applicationId) &&
                s.members.includes(appById(i.applicationId).userId),
            )
            .map((i) => installationView(s, i, me)),
        );
        return true;
      }
      if (!id && method === "POST") {
        const a = appById(d.applicationId);
        if (!a) fail(404, "Application not found.");
        if (a.disabled || isSuspended(userById(a.ownerId)))
          fail(403, "This application is disabled.");
        if (s.members.includes(a.userId))
          fail(
            409,
            "This bot is already a member. Configure its installation or remove it first.",
          );
        if (s.bans.some((b) => b.userId === a.userId))
          fail(403, "This bot is banned. Revoke the ban before installing it.");
        const channelIds = channelScope(
          s,
          me,
          d.channelIds === undefined ? null : d.channelIds,
        );
        const i = {
          id: randomUUID(),
          applicationId: a.id,
          installedBy: me.id,
          createdAt: Date.now(),
          enabled: true,
          channelIds,
        };
        s.botInstallations = s.botInstallations.filter(
          (x) => x.applicationId !== a.id,
        );
        s.botInstallations.push(i);
        s.members.push(a.userId);
        management.log(s, me, "Bot installed", a.name);
        await save();
        refresh();
        json(res, 201, installationView(s, i, me));
        return true;
      }
      const a = appById(id),
        i = s.botInstallations.find((i) => i.applicationId === id);
      if (!a || !i || !s.members.includes(a.userId))
        fail(404, "Bot installation not found.");
      editable(s, me, a);
      if (method === "PATCH") {
        if (d.enabled !== undefined && typeof d.enabled !== "boolean")
          fail(400, "Invalid bot state.");
        const ids =
          d.channelIds === undefined
            ? i.channelIds
            : channelScope(s, me, d.channelIds);
        i.channelIds = ids;
        if (d.enabled !== undefined) i.enabled = d.enabled;
        management.log(s, me, "Bot installation updated", a.name);
        await save();
        refresh();
        json(res, 200, installationView(s, i, me));
        return true;
      }
      if (method === "DELETE") {
        removeInstallation(s, a);
        management.log(s, me, "Bot removed", a.name);
        await save();
        refresh();
        json(res, 200, { ok: true });
        return true;
      }
      fail(405, "Method not allowed.");
    }
    return false;
  }
  async function handleBot(req, res, url) {
    if (!url.pathname.startsWith("/api/bot/")) return false;
    const method = req.method;
    const d = ["POST", "PATCH", "PUT"].includes(method) ? await body(req) : {};
    const a = authenticate(req),
      bot = member(a),
      route = url.pathname;
    rate("bot:" + a.id, 300, 60000);
    if (/^\/api\/bot\/(threads|thread-messages)(?:\/|$)/.test(route))
      return threadTools(req, res, url, bot, { bot: true, data: d, authorize: (channel, permission) => assertChannel(a, channel, permission), post: () => rate("bot-post:" + a.id, 60, 60000) });
    const emojiAsset = route.match(/^\/api\/bot\/emojis\/([\w-]+)$/);
    if (emojiAsset && method === "GET") {
      const e = expressions.byId(emojiAsset[1]);
      if (!e || !installations(a).some((s) => s.id === e.serverId && s.channels.some((c) => allowed(a, c.id)))) fail(404, "Emoji not found.");
      await expressions.serve(e, res); return true;
    }
    if (route === "/api/bot/me" && method === "GET") {
      json(res, 200, gatewayState(a));
      return true;
    }
    if (route === "/api/bot/events" && method === "GET") {
      if ([...clients].filter((c) => c.appId === a.id).length >= 4)
        fail(429, "A bot can have up to four gateway connections.");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const c = { appId: a.id, tokenHash: a.tokenHash, res };
      clients.add(c);
      emit(c, { type: "READY", ...gatewayState(a) });
      refresh();
      const heartbeat = setInterval(() => {
        if (!validClient(c)) {
          clients.delete(c);
          res.end();
        } else res.write(": heartbeat\n\n");
      }, 15000);
      heartbeat.unref();
      res.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(c);
        refresh();
      });
      return true;
    }
    if (route === "/api/bot/commands" && method === "PUT") {
      if (
        !Array.isArray(d.commands) ||
        d.commands.length > 25 ||
        d.commands.some(
          (c) =>
            !c ||
            typeof c.name !== "string" ||
            !/^[a-z][a-z0-9_-]{0,31}$/.test(c.name) ||
            typeof c.description !== "string" ||
            !c.description.trim() ||
            c.description.length > 100 ||
            (c.usage !== undefined &&
              (typeof c.usage !== "string" || c.usage.length > 100)),
        ) ||
        new Set(d.commands.map((c) => c.name)).size !== d.commands.length
      )
        fail(
          400,
          "Register up to 25 unique commands with names, descriptions and optional usage hints.",
        );
      a.commands = d.commands.map((c) => ({
        name: c.name,
        description: c.description.trim(),
        usage: c.usage || "/" + c.name,
      }));
      await save();
      refresh();
      json(res, 200, a.commands);
      return true;
    }
    if (route === "/api/bot/interactions" && method === "GET") {
      json(
        res,
        200,
        state.botInteractions
          .filter(
            (i) =>
              i.applicationId === a.id &&
              !i.responseId &&
              i.expiresAt > Date.now() &&
              interactionAllowed(a, i),
          )
          .map(interactionView),
      );
      return true;
    }
    const tools = route.match(/^\/api\/bot\/interactions\/([\w-]+)\/(context|moderation)$/);
    if (tools) {
      const i = state.botInteractions.find((i) => i.id === tools[1] && i.applicationId === a.id);
      if (!i || !interactionAllowed(a, i)) fail(404, "Interaction not found or no longer accessible.");
      if (i.expiresAt <= Date.now()) fail(410, "This command has expired.");
      const s = serverFor(i.channel), actor = userById(i.userId);
      if (tools[2] === "context" && method === "GET") {
        const canSeeBans = [actor, bot].every((u) => serverPermissions(s, u.id).includes("banMembers"));
        json(res, 200, {
          server: { id: s.id, name: s.name, memberCount: s.members.length, createdAt: s.createdAt || null },
          channel: { id: i.channel, name: s.channels.find((c) => c.id === i.channel).name },
          user: { ...publicUser(actor), permissions: channelPermissions(s, actor.id, i.channel) },
          botPermissions: channelPermissions(s, bot.id, i.channel),
          members: s.members.map(userById).filter(Boolean).map(publicUser),
          bannedMembers: canSeeBans ? s.bans.map((b) => userById(b.userId)).filter(Boolean).map(publicUser) : [],
        });
        return true;
      }
      if (tools[2] !== "moderation" || method !== "POST") fail(405, "Method not allowed.");
      const permission = d.action === "purge" ? "manageMessages" : management.moderationPermissions[d.action];
      if (typeof permission !== "string") fail(400, "Unknown moderation action.");
      for (const u of [actor, bot]) {
        if (!canChannel(u, i.channel, permission))
          fail(403, "Both the command user and the bot need " + permission + ".");
      }
      if (d.reason !== undefined && (typeof d.reason !== "string" || d.reason.length > 500)) fail(400, "Reason must be 500 characters or fewer.");
      const request = { action: d.action, targetId: d.targetId || null, reason: d.reason?.trim() || "", durationSeconds: d.durationSeconds ?? null, count: d.count ?? null };
      if (i.moderationResult) {
        if (JSON.stringify(i.moderationRequest) !== JSON.stringify(request)) fail(409, "This interaction already performed a different moderation action.");
        json(res, 200, i.moderationResult);
        return true;
      }
      if (i.responseId) fail(409, "This command already has a response.");
      let result;
      const attribution = { requestedById: actor.id, requestedByName: actor.displayName };
      let removed = [];
      if (d.action === "purge") {
        if (!Number.isInteger(d.count) || d.count < 1 || d.count > 50) fail(400, "Choose 1–50 messages to remove.");
        removed = state.messages.filter((m) => m.channel === i.channel && m.id !== i.messageId && !m.pinned).slice(-d.count);
        const ids = new Set(removed.map((m) => m.id));
        removeMessageThreads(ids);
        state.messages = state.messages.filter((m) => !ids.has(m.id));
        result = { ok: true, action: "purge", count: removed.length };
        management.log(s, bot, "Messages purged", s.channels.find((c) => c.id === i.channel).name, request.reason, attribution);
      } else {
        const data = { reason: request.reason };
        if (d.action === "timeout") {
          if (!Number.isInteger(d.durationSeconds) || d.durationSeconds < 1 || d.durationSeconds > 28 * 86400) fail(400, "Choose a timeout from 1 second to 28 days.");
          data.timeoutUntil = Date.now() + d.durationSeconds * 1000;
        }
        management.validateModeration(s, actor, d.action, d.targetId, data);
        result = management.moderate(s, bot, d.action, d.targetId, data, attribution);
      }
      // Reserve the receipt before saving; concurrent/recovered commands cannot repeat an action.
      i.moderationRequest = request;
      i.moderationResult = result;
      await management.commit(s);
      for (const m of removed) channelEvent(i.channel, { type: "message-delete", channel: i.channel, id: m.id });
      json(res, 200, result);
      return true;
    }
    const response = route.match(
      /^\/api\/bot\/interactions\/([\w-]+)\/respond$/,
    );
    if (response && method === "POST") {
      const i = state.botInteractions.find(
        (i) => i.id === response[1] && i.applicationId === a.id,
      );
      if (!i || !interactionAllowed(a, i))
        fail(404, "Interaction not found or no longer accessible.");
      if (i.responseId) fail(409, "This command already has a response.");
      if (i.expiresAt <= Date.now()) fail(410, "This command has expired.");
      const result = await createMessage(
        bot,
        {
          channel: i.channel,
          text: d.text,
          poll: d.poll,
          replyTo: i.messageId,
        },
        {
          pollCreatorId: i.userId,
          beforeSave: (m) => {
            i.responseId = m.id;
            const invocation = state.messages.find((x) => x.id === i.messageId);
            if (invocation?.command)
              invocation.command.completedAt = Date.now();
          },
        },
      );
      const invocation = state.messages.find((x) => x.id === i.messageId);
      if (invocation)
        channelEvent(i.channel, {
          type: "message-update",
          message: messageView(invocation),
        });
      json(res, 201, result);
      return true;
    }
    const messages = route.match(/^\/api\/bot\/channels\/([\w-]+)\/messages$/);
    if (messages) {
      assertChannel(
        a,
        messages[1],
        method === "POST" ? "sendMessages" : "viewChannel",
      );
      if (method === "GET") {
        let list = state.messages.filter((m) => m.channel === messages[1]);
        const after = url.searchParams.get("after");
        if (after) {
          const index = list.findIndex((m) => m.id === after);
          if (index < 0) fail(404, "Message not found.");
          list = list.slice(index + 1, index + 201);
        } else list = list.slice(-200);
        json(res, 200, list.map(messageView));
        return true;
      }
      if (method === "POST") {
        rate("bot-post:" + a.id, 60, 60000);
        json(
          res,
          201,
          await createMessage(bot, {
            channel: messages[1],
            text: d.text,
            replyTo: d.replyTo,
            poll: d.poll,
          }),
        );
        return true;
      }
      fail(405, "Method not allowed.");
    }
    const message = route.match(
      /^\/api\/bot\/messages\/([\w-]+)(?:\/(reactions|poll-close))?$/,
    );
    if (message) {
      const m = state.messages.find((m) => m.id === message[1]);
      if (!m || !allowed(a, m.channel)) fail(404, "Message not found.");
      if (message[2] === "reactions" && method === "POST") {
        assertChannel(a, m.channel, "addReactions");
        d.emoji = expressions.validateReaction(d.emoji, m.channel);
        m.reactions ||= [];
        let r = m.reactions.find((r) => r.emoji === d.emoji);
        if (r) {
          r.userIds = r.userIds.includes(bot.id)
            ? r.userIds.filter((id) => id !== bot.id)
            : [...r.userIds, bot.id];
          m.reactions = m.reactions.filter((r) => r.userIds.length);
        } else {
          if (m.reactions.length >= 20) fail(400, "Too many reactions.");
          m.reactions.push({ emoji: d.emoji, userIds: [bot.id] });
        }
      } else if (message[2] === "poll-close" && method === "POST") {
        if (!m.poll) fail(404, "Poll not found.");
        if (
          !(m.authorId === bot.id && allowed(a, m.channel, "sendMessages")) &&
          !allowed(a, m.channel, "manageMessages")
        )
          fail(403, "You cannot end this poll.");
        m.poll.closed = true;
      } else if (!message[2] && method === "PATCH") {
        assertChannel(a, m.channel, "sendMessages");
        if (m.authorId !== bot.id || m.poll)
          fail(403, "Bots can edit only their own non-poll messages.");
        if (
          typeof d.text !== "string" ||
          !d.text.trim() ||
          d.text.length > 2000
        )
          fail(400, "Enter a message of 2000 characters or fewer.");
        expressions.validateText(d.text, m.channel);
        m.text = d.text.trim();
        m.editedAt = Date.now();
      } else if (!message[2] && method === "DELETE") {
        if (m.authorId !== bot.id && !allowed(a, m.channel, "manageMessages"))
          fail(403, "You cannot delete this message.");
        removeMessageThreads(new Set([m.id]));
        state.messages = state.messages.filter((x) => x !== m);
        await save();
        channelEvent(m.channel, {
          type: "message-delete",
          channel: m.channel,
          id: m.id,
        });
        json(res, 200, { ok: true });
        return true;
      } else fail(405, "Method not allowed.");
      await save();
      channelEvent(m.channel, {
        type: "message-update",
        message: messageView(m),
      });
      json(res, 200, messageView(m));
      return true;
    }
    fail(404, "Unknown bot API route.");
  }
  function commandView(command) {
    if (!command) return undefined;
    const i = state.botInteractions.find((i) => i.id === command.interactionId);
    return {
      ...command,
      status:
        !command.interactionId || command.completedAt || i?.responseId
          ? "completed"
          : i?.cancelled
            ? "cancelled"
            : !i || i.expiresAt <= Date.now()
              ? "expired"
              : "pending",
    };
  }
  function close() {
    for (const c of clients) c.res.end();
    clients.clear();
  }
  async function sweep() {
    const ended = state.botInteractions.filter(
      (i) =>
        !i.responseId &&
        !i.expiryNotified &&
        (i.cancelled || i.expiresAt <= Date.now()),
    );
    if (!ended.length) return;
    for (const i of ended) i.expiryNotified = true;
    await save();
    for (const i of ended) {
      const m = state.messages.find((m) => m.id === i.messageId);
      if (m)
        channelEvent(i.channel, {
          type: "message-update",
          message: messageView(m),
        });
    }
  }
  return {
    handleHuman,
    handleBot,
    publish,
    refresh: refreshGateways,
    online,
    commandView,
    close,
    sweep,
  };
}
