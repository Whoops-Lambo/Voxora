import { randomUUID } from "node:crypto";

export const STAFF_PERMISSIONS = [
  {
    id: "manageUsers",
    name: "Manage Accounts",
    description: "Suspend and restore regular user accounts.",
  },
  {
    id: "manageServers",
    name: "Manage Servers",
    description: "Review server metadata and remove servers.",
  },
  {
    id: "manageApplications",
    name: "Manage Bot Applications",
    description: "Disable and restore bot applications across the platform.",
  },
  {
    id: "viewAudit",
    name: "View Platform Audit Log",
    description: "Review platform staff actions.",
  },
];
export const isSuspended = (user) =>
  user?.suspendedUntil === -1 || user?.suspendedUntil > Date.now();
export function initializePlatform(state) {
  state.platform ||= { ownerId: null, roles: [], audit: [] };
  if (!state.platform.ownerId)
    state.platform.ownerId =
      state.users
        .filter((u) => !u.bot)
        .sort((a, b) => a.createdAt - b.createdAt)[0]?.id || null;
  for (const u of state.users) u.staffRoleIds ||= [];
}
export function platformService({
  state,
  body,
  fail,
  json,
  save,
  refresh,
  userById,
  removeChannel,
  revokeUser,
}) {
  const owner = (user) => !!user && state.platform.ownerId === user.id;
  const rolesFor = (user) =>
    state.platform.roles.filter((r) => user?.staffRoleIds?.includes(r.id));
  const permissions = (user) =>
    !user || user.bot || isSuspended(user)
      ? []
      : owner(user)
        ? STAFF_PERMISSIONS.map((p) => p.id)
        : [...new Set(rolesFor(user).flatMap((r) => r.permissions))];
  function badges(user) {
    if (user.bot) return [];
    return owner(user)
      ? [{ id: "platform-owner", name: "Voxora Owner", color: "#eb459e" }]
      : rolesFor(user).map(({ id, name, color }) => ({ id, name, color }));
  }
  const self = (user) => ({
    owner: owner(user),
    permissions: permissions(user),
    badges: badges(user),
  });
  function requirePermission(me, permission) {
    if (!permissions(me).includes(permission))
      fail(403, "You do not have this platform staff permission.");
  }
  const ownerOnly = (me) => {
    if (!owner(me) || isSuspended(me))
      fail(403, "Only the platform owner can manage staff roles.");
  };
  function log(me, action, target, reason = "") {
    state.platform.audit.unshift({
      id: randomUUID(),
      actorId: me.id,
      actorName: me.displayName,
      action,
      target,
      reason,
      time: Date.now(),
    });
    state.platform.audit = state.platform.audit.slice(0, 500);
  }
  function claimFirstAccount(user) {
    user.staffRoleIds ||= [];
    if (!state.platform.ownerId && !user.bot) {
      state.platform.ownerId = user.id;
      log(user, "Platform owner initialized", user.username);
    }
  }
  function reason(d) {
    if (
      typeof d.reason !== "string" ||
      !d.reason.trim() ||
      d.reason.length > 500
    )
      fail(400, "Give a reason of 500 characters or fewer.");
    return d.reason.trim();
  }
  function userView(u) {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      createdAt: u.createdAt,
      bot: !!u.bot,
      owner: owner(u),
      suspended: isSuspended(u),
      suspendedUntil: u.suspendedUntil || 0,
      suspensionReason: u.suspensionReason || "",
      staffRoles: badges(u),
      staffRoleIds: u.staffRoleIds || [],
    };
  }
  function page(list, url, search) {
    const q = (url.searchParams.get("q") || "")
      .trim()
      .toLowerCase()
      .slice(0, 100);
    const offset = Number(url.searchParams.get("offset") || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) fail(400, "Invalid page.");
    const filtered = list.filter((v) => search(v).toLowerCase().includes(q));
    return {
      items: filtered.slice(offset, offset + 50),
      total: filtered.length,
      offset,
      hasMore: offset + 50 < filtered.length,
    };
  }
  async function handle(req, res, url, me) {
    const match = url.pathname.match(
      /^\/api\/platform\/(me|overview|users|servers|applications|staff-roles|audit)(?:\/([\w-]+))?$/,
    );
    if (!match) return false;
    const [, kind, id] = match,
      method = req.method;
    const d =
      ["PATCH", "POST"].includes(method) ||
      (kind === "servers" && method === "DELETE")
        ? await body(req)
        : {};
    if (kind === "me" && method === "GET") {
      json(res, 200, self(me));
      return true;
    }
    if (kind === "overview" && method === "GET") {
      if (!permissions(me).length)
        fail(403, "Platform staff access is required.");
      json(res, 200, {
        ...self(me),
        stats: {
          users: state.users.filter((u) => !u.bot).length,
          servers: state.servers.length,
          applications: state.botApplications.filter((a) => !a.builtin).length,
          suspended: state.users.filter(isSuspended).length,
        },
        permissionDefinitions: STAFF_PERMISSIONS,
      });
      return true;
    }
    if (kind === "audit" && method === "GET") {
      requirePermission(me, "viewAudit");
      json(
        res,
        200,
        page(
          state.platform.audit,
          url,
          (v) => v.actorName + " " + v.action + " " + v.target + " " + v.reason,
        ),
      );
      return true;
    }
    if (kind === "staff-roles") {
      ownerOnly(me);
      if (method === "GET") {
        json(res, 200, {
          roles: state.platform.roles,
          permissions: STAFF_PERMISSIONS,
        });
        return true;
      }
      const role = id ? state.platform.roles.find((r) => r.id === id) : null;
      if (id && !role) fail(404, "Staff role not found.");
      if ((!id && method === "POST") || (id && method === "PATCH")) {
        if (!id && state.platform.roles.length >= 20)
          fail(400, "You can create up to 20 staff roles.");
        const name = d.name === undefined && role ? role.name : d.name;
        const color =
          d.color === undefined ? role?.color || "#5865f2" : d.color;
        const list =
          d.permissions === undefined ? role?.permissions || [] : d.permissions;
        if (
          typeof name !== "string" ||
          !name.trim() ||
          name.length > 40 ||
          !/^#[0-9a-f]{6}$/i.test(color)
        )
          fail(400, "Enter a role name and a valid color.");
        if (
          !Array.isArray(list) ||
          new Set(list).size !== list.length ||
          list.some((p) => !STAFF_PERMISSIONS.some((v) => v.id === p))
        )
          fail(400, "Invalid staff permissions.");
        const next = {
          id: role?.id || randomUUID(),
          name: name.trim(),
          color,
          permissions: [...list],
        };
        if (role) Object.assign(role, next);
        else state.platform.roles.push(next);
        log(me, role ? "Staff role updated" : "Staff role created", next.name);
        await save();
        refresh();
        json(res, role ? 200 : 201, next);
        return true;
      }
      if (id && method === "DELETE") {
        state.platform.roles = state.platform.roles.filter((r) => r !== role);
        for (const u of state.users)
          u.staffRoleIds = (u.staffRoleIds || []).filter((r) => r !== id);
        log(me, "Staff role deleted", role.name);
        await save();
        refresh();
        json(res, 200, { ok: true });
        return true;
      }
    }
    if (kind === "users") {
      if (!id && method === "GET") {
        if (!owner(me)) requirePermission(me, "manageUsers");
        json(
          res,
          200,
          page(
            state.users.filter((u) => !u.bot).map(userView),
            url,
            (u) => u.username + " " + u.displayName,
          ),
        );
        return true;
      }
      const u = userById(id);
      if (!u || u.bot) fail(404, "Human account not found.");
      if (method === "PATCH" && d.staffRoleIds !== undefined) {
        ownerOnly(me);
        if (Object.keys(d).some((k) => k !== "staffRoleIds"))
          fail(400, "Save staff assignments separately.");
        if (owner(u))
          fail(400, "The platform owner already has every staff permission.");
        if (
          !Array.isArray(d.staffRoleIds) ||
          new Set(d.staffRoleIds).size !== d.staffRoleIds.length ||
          d.staffRoleIds.some(
            (id) => !state.platform.roles.some((r) => r.id === id),
          )
        )
          fail(400, "Invalid staff roles.");
        u.staffRoleIds = [...d.staffRoleIds];
        log(me, "Staff roles assigned", u.username);
        await save();
        refresh();
        json(res, 200, userView(u));
        return true;
      }
      if (method === "PATCH" && d.suspendFor !== undefined) {
        requirePermission(me, "manageUsers");
        if (owner(u) || u.id === me.id || (!owner(me) && rolesFor(u).length))
          fail(403, "You cannot moderate this account.");
        if (![0, 3600, 86400, 604800, -1].includes(d.suspendFor))
          fail(400, "Choose a valid suspension duration.");
        const why = reason(d);
        u.suspendedUntil =
          d.suspendFor > 0 ? Date.now() + d.suspendFor * 1000 : d.suspendFor;
        u.suspensionReason = d.suspendFor ? why : "";
        if (d.suspendFor) {
          state.sessions = state.sessions.filter((s) => s.userId !== u.id);
          revokeUser(u.id);
        }
        log(
          me,
          d.suspendFor ? "Account suspended" : "Account restored",
          u.username,
          why,
        );
        await save();
        refresh();
        json(res, 200, userView(u));
        return true;
      }
    }
    if (kind === "servers") {
      requirePermission(me, "manageServers");
      if (!id && method === "GET") {
        json(
          res,
          200,
          page(
            state.servers.map((s) => ({
              id: s.id,
              name: s.name,
              owner: userById(s.ownerId)?.username || "Unclaimed",
              memberCount: s.members.length,
              channelCount: s.channels.length,
            })),
            url,
            (s) => s.name + " " + s.owner,
          ),
        );
        return true;
      }
      const s = state.servers.find((s) => s.id === id);
      if (!s) fail(404, "Server not found.");
      if (method === "DELETE") {
        if (d.confirmation !== s.name)
          fail(400, "Type the server name to confirm.");
        const why = reason(d);
        log(me, "Server removed by platform staff", s.name, why);
        for (const c of s.channels) await removeChannel(c.id);
        state.servers = state.servers.filter((v) => v !== s);
        await save();
        refresh();
        json(res, 200, { ok: true });
        return true;
      }
    }
    if (kind === "applications") {
      requirePermission(me, "manageApplications");
      if (!id && method === "GET") {
        json(
          res,
          200,
          page(
            state.botApplications.map((a) => ({
              id: a.id,
              name: a.name,
              owner: userById(a.ownerId)?.username || "Voxora",
              builtin: !!a.builtin,
              disabled: !!a.disabled,
              reason: a.disabledReason || "",
              installedServers: state.servers.filter((s) =>
                s.members.includes(a.userId),
              ).length,
            })),
            url,
            (a) => a.name + " " + a.owner,
          ),
        );
        return true;
      }
      const a = state.botApplications.find((a) => a.id === id);
      if (!a) fail(404, "Application not found.");
      if (method === "PATCH") {
        if (a.builtin && !owner(me))
          fail(
            403,
            "Only the platform owner can disable a built-in application.",
          );
        if (typeof d.disabled !== "boolean")
          fail(400, "Choose whether the application is disabled.");
        const why = reason(d);
        a.disabled = d.disabled;
        a.disabledReason = d.disabled ? why : "";
        log(
          me,
          d.disabled ? "Bot application disabled" : "Bot application restored",
          a.name,
          why,
        );
        await save();
        refresh();
        json(res, 200, { ok: true });
        return true;
      }
    }
    fail(405, "Method not allowed.");
  }
  return { self, badges, permissions, handle, claimFirstAccount };
}
