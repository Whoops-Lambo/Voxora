import { randomUUID } from "node:crypto";
import {
  permissionOverwrites,
  serverPermissions,
} from "./public/permissions.js";

export function initializeCategories(s) {
  s.categories ||= [];
  for (const category of s.categories) category.overwrites ||= [];
  for (const c of s.channels) {
    if (c.categoryId === undefined) {
      let category = s.categories.find((x) => x.name === c.category);
      if (!category && c.category) {
        category = { id: randomUUID(), name: c.category, overwrites: [] };
        s.categories.push(category);
      }
      c.categoryId = category?.id || null;
    }
    const parent = s.categories.find((x) => x.id === c.categoryId);
    c.categoryId = parent?.id || null;
    c.category = parent?.name || "";
    c.permissionSynced = !!parent && c.permissionSynced === true;
    c.slowmode ||= 0;
  }
}

export function channelService({
  state,
  management,
  body,
  json,
  fail,
  removeChannel,
}) {
  const name = (value, max = 40) => {
    if (typeof value !== "string" || !value.trim() || value.length > max)
      fail(400, "Enter a valid name.");
    return value.trim();
  };
  function reorder(items, item, beforeId) {
    if (beforeId !== null && !items.some((x) => x.id === beforeId))
      fail(
        400,
        "The requested position no longer exists. Refresh and try again.",
      );
    if (beforeId === item.id) return items;
    const next = items.filter((x) => x !== item);
    next.splice(
      beforeId === null
        ? next.length
        : next.findIndex((x) => x.id === beforeId),
      0,
      item,
    );
    return next;
  }
  function categoryName(s, value, id) {
    const result = name(value);
    if (
      s.categories.some(
        (c) => c.id !== id && c.name.toLowerCase() === result.toLowerCase(),
      )
    )
      fail(400, "A category with that name already exists.");
    return result;
  }
  function parent(s, d, fallback = null) {
    if (d.categoryId !== undefined) {
      if (d.categoryId === null) return null;
      const c = s.categories.find((c) => c.id === d.categoryId);
      if (!c) fail(400, "Category not found.");
      return c;
    }
    // Preserve compatibility with older clients that send category names.
    if (d.category !== undefined) {
      if (d.category === "") return null;
      return { name: name(d.category), legacy: true };
    }
    return fallback;
  }
  function resolveParent(s, category) {
    if (!category?.legacy) return category;
    let c = s.categories.find(
      (c) => c.name.toLowerCase() === category.name.toLowerCase(),
    );
    if (!c) {
      if (s.categories.length >= 50)
        fail(400, "A server can have up to 50 categories.");
      c = { id: randomUUID(), name: category.name, overwrites: [] };
      s.categories.push(c);
    }
    return c;
  }
  function slowmode(value, type) {
    if (
      type !== "text" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 21600
    )
      fail(
        400,
        "Slowmode must be a whole number from 0 to 21600 seconds, on a text channel.",
      );
    return value;
  }
  async function handle(req, res, url, me) {
    const serverMatch = url.pathname.match(
      /^\/api\/servers\/([\w-]+)\/(channels|categories)(?:\/([\w-]+))?$/,
    );
    const channelMatch = url.pathname.match(/^\/api\/channels\/([\w-]+)$/);
    if (!serverMatch && !channelMatch) return false;
    const method = req.method;
    const d = ["POST", "PATCH"].includes(method) ? await body(req) : {};
    const s = serverMatch
      ? state.servers.find((s) => s.id === serverMatch[1])
      : state.servers.find((s) =>
          s.channels.some((c) => c.id === channelMatch[1]),
        );
    if (!s || !s.members.includes(me.id))
      fail(404, "Server or channel not found.");
    if (serverMatch?.[2] === "categories") {
      const id = serverMatch[3];
      if (!id && method === "POST") {
        management.requirePermission(s, me, "manageChannels");
        if (s.categories.length >= 50)
          fail(400, "A server can have up to 50 categories.");
        const c = {
          id: randomUUID(),
          name: categoryName(s, d.name),
          overwrites: [],
        };
        s.categories.push(c);
        management.log(s, me, "Category created", c.name);
        await management.commit(s);
        json(res, 201, c);
        return true;
      }
      const c = s.categories.find((c) => c.id === id);
      if (!c) fail(404, "Category not found.");
      if (method === "PATCH") {
        if (d.overwrites !== undefined) {
          if (Object.keys(d).some((key) => key !== "overwrites"))
            fail(
              400,
              "Save permission changes separately from category details.",
            );
          management.updateOverwrites(s, c, me, d.overwrites);
        } else {
          management.requirePermission(s, me, "manageChannels");
          const nextName =
            d.name === undefined ? c.name : categoryName(s, d.name, c.id);
          const nextOrder =
            d.beforeId === undefined
              ? s.categories
              : reorder(s.categories, c, d.beforeId);
          c.name = nextName;
          s.categories = nextOrder;
          for (const channel of s.channels.filter((x) => x.categoryId === c.id))
            channel.category = c.name;
          management.log(s, me, "Category updated", c.name);
        }
        await management.commit(s);
        json(res, 200, c);
        return true;
      }
      if (method === "DELETE") {
        management.requirePermission(s, me, "manageChannels");
        for (const channel of s.channels.filter((x) => x.categoryId === c.id)) {
          channel.overwrites = structuredClone(
            permissionOverwrites(s, channel),
          );
          channel.categoryId = null;
          channel.category = "";
          channel.permissionSynced = false;
        }
        s.categories = s.categories.filter((x) => x !== c);
        management.log(s, me, "Category deleted", c.name);
        await management.commit(s);
        json(res, 200, { ok: true });
        return true;
      }
      fail(405, "Method not allowed.");
    }
    if (serverMatch) {
      if (serverMatch[3] || method !== "POST") fail(405, "Method not allowed.");
      management.requirePermission(s, me, "manageChannels");
      if (s.channels.length >= 500)
        fail(400, "A server can have up to 500 channels.");
      const announcement = d.type === "announcement" || d.announcement === true;
      const type = d.type === "announcement" ? "text" : d.type ?? "text";
      if (!["text", "voice"].includes(type)) fail(400, "Invalid channel type.");
      if (d.announcement !== undefined && typeof d.announcement !== "boolean") fail(400, "Invalid announcement setting.");
      if (announcement && type !== "text") fail(400, "Announcement channels must be text channels.");
      if (d.private !== undefined && typeof d.private !== "boolean")
        fail(400, "Invalid private channel setting.");
      if (d.private) {
        management.requirePermission(s, me, "manageRoles");
        if (!serverPermissions(s, me.id).includes("viewChannel"))
          fail(403, "You need View Channels to create a private channel.");
      }
      const c = {
        id: randomUUID(),
        name: name(d.name, 50)
          .replace(type === "text" ? /\s+/g : /$^/g, "-")
          .toLowerCase(),
        type,
        announcement,
        topic: d.topic === undefined ? "" : nameOrEmpty(d.topic, 250),
        slowmode: d.slowmode === undefined ? 0 : slowmode(d.slowmode, type),
        overwrites: d.private
          ? [
              {
                type: "role",
                id: "everyone",
                allow: [],
                deny: ["viewChannel"],
              },
              { type: "member", id: me.id, allow: ["viewChannel"], deny: [] },
            ]
          : [],
      };
      const category = resolveParent(
        s,
        parent(
          s,
          d,
          s.categories.find(
            (x) =>
              x.name ===
              (type === "voice" ? "VOICE CHANNELS" : "TEXT CHANNELS"),
          ) || null,
        ),
      );
      c.categoryId = category?.id || null;
      c.category = category?.name || "";
      c.permissionSynced = !!category && !d.private;
      s.channels.push(c);
      management.log(
        s,
        me,
        d.private ? "Private channel created" : "Channel created",
        c.name,
      );
      await management.commit(s);
      json(res, 201, c);
      return true;
    }
    const c = s.channels.find((c) => c.id === channelMatch[1]);
    if (method === "PATCH") {
      if (d.overwrites !== undefined || d.syncPermissions !== undefined) {
        if (Object.keys(d).length !== 1)
          fail(400, "Save permission changes separately from channel details.");
        if (d.syncPermissions !== undefined) {
          if (d.syncPermissions !== true)
            fail(400, "Invalid permission sync setting.");
          const category = s.categories.find((x) => x.id === c.categoryId);
          if (!category)
            fail(
              400,
              "Move the channel into a category before syncing permissions.",
            );
          c.overwrites = management.validateOverwrites(
            s,
            c,
            me,
            category.overwrites,
          );
          c.permissionSynced = true;
          management.log(s, me, "Channel permissions synced", c.name);
        } else management.updateOverwrites(s, c, me, d.overwrites);
      } else {
        management.requirePermission(s, me, "manageChannels");
        const patch = {};
        if (d.announcement !== undefined) {
          if (typeof d.announcement !== "boolean" || c.type !== "text") fail(400, "Only text channels can become announcement channels.");
          patch.announcement = d.announcement;
        }
        if (d.name !== undefined) patch.name = name(d.name, 50);
        if (d.topic !== undefined) patch.topic = nameOrEmpty(d.topic, 250);
        if (d.slowmode !== undefined)
          patch.slowmode = slowmode(d.slowmode, c.type);
        let category = parent(
          s,
          d,
          s.categories.find((x) => x.id === c.categoryId) || null,
        );
        // Check every value before changing the layout.
        const nextOrder =
          d.beforeId === undefined
            ? s.channels
            : reorder(s.channels, c, d.beforeId);
        category = resolveParent(s, category);
        if ((category?.id || null) !== c.categoryId) {
          patch.overwrites = structuredClone(permissionOverwrites(s, c));
          patch.permissionSynced = false;
          patch.categoryId = category?.id || null;
          patch.category = category?.name || "";
        }
        Object.assign(c, patch);
        s.channels = nextOrder;
        management.log(s, me, "Channel updated", c.name);
      }
      await management.commit(s);
      json(res, 200, c);
      return true;
    }
    if (method === "DELETE") {
      management.requirePermission(s, me, "manageChannels");
      management.log(s, me, "Channel deleted", c.name);
      await removeChannel(c.id);
      s.channels = s.channels.filter((x) => x !== c);
      await management.commit(s);
      json(res, 200, { ok: true });
      return true;
    }
    fail(405, "Method not allowed.");
  }
  function nameOrEmpty(value, max) {
    if (typeof value !== "string" || value.length > max)
      fail(400, "Topic is too long.");
    return value.trim();
  }
  return { handle };
}
