import { randomUUID, randomBytes } from "node:crypto";
import { initializeCategories } from "./channels.js";
import { initializeOnboardingServer, sanitizeOnboarding, onboardingSummary } from './onboarding.js';
import {
  PERMISSION_IDS,
  CHANNEL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  serverPermissions,
  channelPermissions,
  roleRank,
  administrator,
  outranks,
  permissionOverwrites,
} from "./public/permissions.js";
export function initializeServer(s) {
  s.roles ||= [
    {
      id: "everyone",
      name: "@everyone",
      color: null,
      hoist: false,
      position: 0,
      permissions: [...DEFAULT_PERMISSIONS],
    },
  ];
  s.memberRoles ||= {};
  s.timeouts ||= {};
  s.bans ||= [];
  s.auditLog ||= [];
  s.warnings ||= [];
  s.description ||= "";
  s.discovery ||= { enabled: false, category: "Other", summary: "", tags: [] };
  s.botInstallations ||= [];
  s.invites ||= [
    {
      code: s.invite || randomBytes(6).toString("hex"),
      createdBy: s.ownerId,
      createdAt: Date.now(),
      expiresAt: 0,
      maxUses: 0,
      uses: 0,
    },
  ];
  for (const c of s.channels) c.overwrites ||= [];
  initializeCategories(s);
  initializeOnboardingServer(s);
  sanitizeOnboarding(s);
  return s;
}
export function serverView(s, me) {
  const permissions = serverPermissions(s, me.id);
  const { bans, auditLog, warnings, invites, invite, botInstallations, onboarding, onboardingMembers, ...visible } = s;
  const channels = s.channels
    .filter((c) => channelPermissions(s, me.id, c.id).includes("viewChannel"))
    .map((c) => ({
      ...c,
      overwrites: permissionOverwrites(s, c),
      permissions: channelPermissions(s, me.id, c.id),
    }));
  return {
    ...visible,
    onboarding: onboardingSummary(s, me),
    roleRanks: Object.fromEntries(s.members.filter(id => id !== s.ownerId).map(id => [id, roleRank(s, id)])),
    permissions,
    channels,
    categories: s.categories.filter(
      (c) =>
        permissions.includes("manageChannels") ||
        permissions.includes("manageRoles") ||
        channels.some((x) => x.categoryId === c.id),
    ),
    invite: permissions.includes("inviteMembers")
      ? invites.find(
          (i) =>
            (!i.expiresAt || i.expiresAt > Date.now()) &&
            (!i.maxUses || i.uses < i.maxUses),
        )?.code
      : undefined,
  };
}
export function managementService({
  state,
  save,
  refresh,
  fail,
  body,
  json,
  userById,
  removeChannel,
  revalidateVoice,
}) {
  const log = (s, me, action, target, reason = "", attribution = {}) => {
    s.auditLog.unshift({
      id: randomUUID(),
      time: Date.now(),
      actorId: me.id,
      actorName: me.displayName,
      action,
      target,
      reason,
      ...attribution,
    });
    s.auditLog = s.auditLog.slice(0, 500);
  };
  const requirePermission = (s, me, p) => {
    if (!state.servers.includes(s)) fail(404, "Server not found.");
    if (!serverPermissions(s, me.id).includes(p))
      fail(403, "You need the " + p + " permission.");
  };
  const reason = (d) => {
    if (
      d.reason !== undefined &&
      (typeof d.reason !== "string" || d.reason.length > 500)
    )
      fail(400, "Reason must be 500 characters or fewer.");
    return d.reason?.trim() || "";
  };
  const name = (value, max = 60) => {
    if (typeof value !== "string" || !value.trim() || value.length > max)
      fail(400, "Enter a valid name.");
    return value.trim();
  };
  const permissionList = (value, allowed = PERMISSION_IDS) => {
    if (
      !Array.isArray(value) ||
      value.length > allowed.length ||
      value.some((p) => !allowed.includes(p))
    )
      fail(400, "Invalid permissions.");
    return [...new Set(value)];
  };
  const grantCheck = (s, me, permissions) => {
    const own = serverPermissions(s, me.id);
    if (permissions.some((p) => !own.includes(p)))
      fail(403, "You cannot grant permissions you do not have.");
  };
  const editRole = (s, me, r) => {
    if (!r) fail(404, "Role not found.");
    if (me.id !== s.ownerId && r.position >= roleRank(s, me.id))
      fail(403, "You can only manage roles below your highest role.");
  };
  const reindex = (s) => s.roles.forEach((r, i) => (r.position = i));
  const commit = async (s) => {
    const removed = sanitizeOnboarding(s);
    if (removed) log(s, { id: null, displayName: 'Voxora' }, 'Unsafe optional roles withdrawn', String(removed) + ' self-granted role assignment(s)');
    await save();
    revalidateVoice(s);
    refresh();
  };
  function removeMember(s, id) {
    s.members = s.members.filter((x) => x !== id);
    delete s.memberRoles[id];
    delete s.timeouts[id];
    delete s.onboardingMembers?.[id];
    for (const c of [...s.channels, ...s.categories])
      c.overwrites = c.overwrites.filter(
        (o) => o.type !== "member" || o.id !== id,
      );
  }
  const moderationPermissions = {
    warn: "moderateMembers", warnings: "moderateMembers", clearwarns: "moderateMembers",
    timeout: "moderateMembers", untimeout: "moderateMembers",
    kick: "kickMembers", ban: "banMembers", unban: "banMembers",
  };
  function validateModeration(s, me, action, id, data = {}) {
    const permission = moderationPermissions[action];
    if (!permission) fail(400, "Unknown moderation action.");
    requirePermission(s, me, permission);
    const why = reason(data), target = userById(id);
    if (action === "unban") {
      if (!s.bans.some((b) => b.userId === id)) fail(404, "Ban not found.");
    } else {
      if (!target || !s.members.includes(id)) fail(404, "Member not found.");
      if (!outranks(s, me.id, id)) fail(403, "You can only moderate members below your highest role.");
      if (["timeout", "untimeout"].includes(action) && administrator(s, id))
        fail(403, "You cannot timeout this member.");
    }
    if (action === "warn" && !why) fail(400, "Provide a reason for the warning.");
    if (action === "timeout" && (!Number.isFinite(data.timeoutUntil) ||
      data.timeoutUntil <= Date.now() || data.timeoutUntil > Date.now() + 28 * 86400000))
      fail(400, "Choose a timeout of up to 28 days.");
    return { target, why };
  }
  function moderate(s, me, action, id, data = {}, attribution = {}) {
    const { target, why } = validateModeration(s, me, action, id, data);
    const label = target?.displayName || id;
    let result = { ok: true, action, userId: id, displayName: label };
    if (action === "warnings") {
      const warnings = s.warnings.filter((w) => w.userId === id);
      return { ...result, count: warnings.length, warnings: warnings.slice(-10) };
    }
    if (action === "warn") {
      if (s.warnings.length >= 5000) fail(400, "The server warning log is full. Clear older warnings first.");
      const warning = { id: randomUUID(), userId: id, moderatorId: me.id, reason: why, createdAt: Date.now(), ...attribution };
      s.warnings.push(warning);
      result.warningId = warning.id;
      result.count = s.warnings.filter((w) => w.userId === id).length;
      log(s, me, "Member warned", label, why, attribution);
    } else if (action === "clearwarns") {
      result.count = s.warnings.filter((w) => w.userId === id).length;
      s.warnings = s.warnings.filter((w) => w.userId !== id);
      log(s, me, "Warnings cleared", label, why, attribution);
    } else if (["timeout", "untimeout"].includes(action)) {
      if (action === "timeout") s.timeouts[id] = data.timeoutUntil;
      else delete s.timeouts[id];
      result.timeoutUntil = s.timeouts[id] || 0;
      log(s, me, action === "timeout" ? "Member timed out" : "Timeout removed", label, why, attribution);
    } else if (action === "kick" || action === "ban") {
      if (action === "ban") s.bans.push({ userId: id, reason: why, actorId: me.id, time: Date.now(), ...attribution });
      removeMember(s, id);
      log(s, me, action === "ban" ? "Member banned" : "Member kicked", label, why, attribution);
    } else if (action === "unban") {
      s.bans = s.bans.filter((b) => b.userId !== id);
      log(s, me, "Ban revoked", label, why, attribution);
    }
    return result;
  }
  async function handle(req, res, url, me) {
    const match = url.pathname.match(
      /^\/api\/servers\/([\w-]+)\/(roles|members|bans|audit|invites|transfer)(?:\/([\w-]+))?$/,
    );
    if (!match) return false;
    const [, sid, kind, id] = match;
    const method = req.method;
    // Read the complete payload before checking current permissions: a suspended
    // request must not retain privileges after its roles have been revoked.
    const data =
      ["POST", "PATCH"].includes(method) ||
      (kind === "members" && method === "DELETE")
        ? await body(req)
        : {};
    const s = state.servers.find(
      (s) => s.id === sid && s.members.includes(me.id),
    );
    if (!s) fail(404, "Server not found.");
    if (kind === "roles") {
      requirePermission(s, me, "manageRoles");
      if (!id && method === "POST") {
        if (me.id !== s.ownerId && roleRank(s, me.id) === 0)
          fail(
            403,
            "Your highest role must be above @everyone to create roles.",
          );
        if (s.roles.length >= 100)
          fail(400, "This server has reached 100 roles.");
        const d = data;
        const why = reason(d);
        if (d.hoist !== undefined && typeof d.hoist !== "boolean")
          fail(400, "Invalid role display setting.");
        const permissions = permissionList(d.permissions || []);
        grantCheck(s, me, permissions);
        if (d.color != null && !/^#[0-9a-f]{6}$/i.test(d.color))
          fail(400, "Invalid role color.");
        const r = {
          id: randomUUID(),
          name: name(d.name, 40),
          color: d.color || null,
          permissions,
          hoist: !!d.hoist,
          position: 0,
        };
        const index =
          me.id === s.ownerId
            ? s.roles.length
            : s.roles.findIndex((r) => r.position === roleRank(s, me.id));
        s.roles.splice(index, 0, r);
        reindex(s);
        log(s, me, "Role created", r.name, why);
        await commit(s);
        json(res, 201, r);
        return true;
      }
      if (id === "reorder" && method === "POST") {
        const d = data,
          ids = d.roleIds,
          why = reason(d);
        if (
          !Array.isArray(ids) ||
          ids.length !== s.roles.length - 1 ||
          new Set(ids).size !== ids.length ||
          ids.some(
            (id) => id === "everyone" || !s.roles.some((r) => r.id === id),
          )
        )
          fail(400, "Provide every custom role once, highest first.");
        const proposed = [
          s.roles.find((r) => r.id === "everyone"),
          ...ids
            .slice()
            .reverse()
            .map((id) => s.roles.find((r) => r.id === id)),
        ];
        if (me.id !== s.ownerId)
          for (const r of s.roles)
            if (
              (r.position >= roleRank(s, me.id) ||
                proposed.indexOf(r) >= roleRank(s, me.id)) &&
              proposed.indexOf(r) !== r.position
            )
              fail(403, "You cannot move roles to or above your highest role.");
        s.roles = proposed;
        reindex(s);
        log(s, me, "Role order updated", s.name, why);
        await commit(s);
        json(res, 200, { ok: true });
        return true;
      }
      const r = s.roles.find((r) => r.id === id);
      editRole(s, me, r);
      if (method === "PATCH") {
        const d = data;
        const patch = {};
        if (d.name !== undefined) {
          if (id === "everyone" && d.name !== "@everyone")
            fail(400, "The @everyone role cannot be renamed.");
          patch.name = name(d.name, 40);
        }
        if (d.color !== undefined) {
          if (d.color !== null && !/^#[0-9a-f]{6}$/i.test(d.color))
            fail(400, "Invalid role color.");
          patch.color = d.color;
        }
        if (d.hoist !== undefined) {
          if (typeof d.hoist !== "boolean" || (id === "everyone" && d.hoist))
            fail(400, "Invalid role display setting.");
          patch.hoist = d.hoist;
        }
        if (d.permissions !== undefined) {
          patch.permissions = permissionList(d.permissions);
          grantCheck(
            s,
            me,
            patch.permissions.filter((p) => !r.permissions.includes(p)),
          );
        }
        const why = reason(d);
        Object.assign(r, patch);
        log(s, me, "Role updated", r.name, why);
        await commit(s);
        json(res, 200, r);
        return true;
      }
      if (method === "DELETE") {
        if (id === "everyone")
          fail(400, "The @everyone role cannot be deleted.");
        s.roles = s.roles.filter((r) => r.id !== id);
        reindex(s);
        for (const user of Object.keys(s.memberRoles))
          s.memberRoles[user] = s.memberRoles[user].filter(
            (role) => role !== id,
          );
        for (const c of [...s.channels, ...s.categories])
          c.overwrites = c.overwrites.filter(
            (o) => o.type !== "role" || o.id !== id,
          );
        log(s, me, "Role deleted", r.name);
        await commit(s);
        json(res, 200, { ok: true });
        return true;
      }
    }
    if (kind === "members") {
      const target = userById(id);
      if (!target || !s.members.includes(id)) fail(404, "Member not found.");
      const d = data;
      const why = reason(d);
      if (method === "PATCH" && d.roles !== undefined) {
        requirePermission(s, me, "manageRoles");
        if (me.id !== s.ownerId && !outranks(s, me.id, id))
          fail(403, "You can only manage members below your highest role.");
        if (
          !Array.isArray(d.roles) ||
          new Set(d.roles).size !== d.roles.length ||
          d.roles.some(
            (id) => id === "everyone" || !s.roles.some((r) => r.id === id),
          )
        )
          fail(400, "Invalid role assignments.");
        const current = s.memberRoles[id] || [];
        const changed = [...new Set([...current, ...d.roles])].filter(
          (r) => current.includes(r) !== d.roles.includes(r),
        );
        const converted = (s.onboardingMembers?.[id]?.selfRoleIds || []).filter(rid => d.roles.includes(rid));
        for (const rid of new Set([...changed, ...converted])) {
          const role = s.roles.find((r) => r.id === rid);
          editRole(s, me, role);
          if (d.roles.includes(rid)) grantCheck(s, me, role.permissions);
        }
        s.memberRoles[id] = [...d.roles];
        if (s.onboardingMembers?.[id]) s.onboardingMembers[id].selfRoleIds = [];
        log(s, me, "Member roles updated", target.displayName, why);
        await commit(s);
        json(res, 200, { ok: true });
        return true;
      }
      if (method === "PATCH" && d.timeoutUntil !== undefined) {
        moderate(s, me, d.timeoutUntil === 0 ? "untimeout" : "timeout", id, d);
        await commit(s);
        json(res, 200, { ok: true });
        return true;
      }
      if (method === "DELETE") {
        moderate(s, me, "kick", id, d);
        await commit(s);
        json(res, 200, { ok: true });
        return true;
      }
    }
    if (kind === "bans") {
      requirePermission(s, me, "banMembers");
      if (!id && method === "GET") {
        json(
          res,
          200,
          s.bans.map((b) => ({
            ...b,
            user: userById(b.userId)
              ? {
                  id: b.userId,
                  displayName: userById(b.userId).displayName,
                  username: userById(b.userId).username,
                }
              : null,
          })),
        );
        return true;
      }
      if (id && method === "POST") {
        moderate(s, me, "ban", id, data);
        await commit(s);
        json(res, 200, { ok: true });
        return true;
      }
      if (id && method === "DELETE") {
        moderate(s, me, "unban", id);
        await commit(s);
        json(res, 200, { ok: true });
        return true;
      }
    }
    if (kind === "audit" && method === "GET") {
      requirePermission(s, me, "viewAuditLog");
      json(res, 200, s.auditLog);
      return true;
    }
    if (kind === "invites") {
      requirePermission(s, me, "inviteMembers");
      if (!id && method === "GET") {
        json(
          res,
          200,
          s.invites.filter(
            (i) =>
              serverPermissions(s, me.id).includes("manageServer") ||
              i.createdBy === me.id,
          ),
        );
        return true;
      }
      if (!id && method === "POST") {
        const d = data;
        const ttl = d.expiresIn ?? 86400,
          max = d.maxUses ?? 0;
        if (
          !Number.isInteger(ttl) ||
          ![0, 1800, 3600, 21600, 86400, 604800].includes(ttl) ||
          !Number.isInteger(max) ||
          max < 0 ||
          max > 1000
        )
          fail(400, "Invalid invite expiration or usage limit.");
        s.invites = s.invites.filter(
          (i) =>
            (!i.expiresAt || i.expiresAt > Date.now()) &&
            (!i.maxUses || i.uses < i.maxUses),
        );
        if (s.invites.length >= 100)
          fail(400, "Too many active invites. Revoke one first.");
        const invite = {
          code: randomBytes(6).toString("hex"),
          createdBy: me.id,
          createdAt: Date.now(),
          expiresAt: ttl ? Date.now() + ttl * 1000 : 0,
          maxUses: max,
          uses: 0,
        };
        s.invites.push(invite);
        log(s, me, "Invite created", invite.code);
        await commit(s);
        json(res, 201, invite);
        return true;
      }
      if (id && method === "DELETE") {
        const invite = s.invites.find((i) => i.code === id);
        if (!invite) fail(404, "Invite not found.");
        if (invite.createdBy !== me.id)
          requirePermission(s, me, "manageServer");
        s.invites = s.invites.filter((i) => i.code !== id);
        log(s, me, "Invite revoked", id);
        await commit(s);
        json(res, 200, { ok: true });
        return true;
      }
    }
    if (kind === "transfer" && method === "POST") {
      if (me.id !== s.ownerId)
        fail(403, "Only the owner can transfer ownership.");
      const d = data;
      if (
        !s.members.includes(d.userId) ||
        userById(d.userId)?.bot ||
        d.userId === me.id ||
        d.confirmation !== s.name
      )
        fail(400, "Select another member and type the server name to confirm.");
      s.ownerId = d.userId;
      log(s, me, "Ownership transferred", userById(d.userId).displayName);
      await commit(s);
      json(res, 200, { ok: true });
      return true;
    }
    fail(405, "Method not allowed.");
  }
  function validateOverwrites(s, c, me, value) {
    requirePermission(s, me, "manageRoles");
    if (!Array.isArray(value) || value.length > 200)
      fail(400, "Invalid channel overrides.");
    const seen = new Set();
    const next = [];
    for (const entry of value) {
      if (
        !entry ||
        !["role", "member"].includes(entry.type) ||
        typeof entry.id !== "string"
      )
        fail(400, "Invalid override target.");
      const key = entry.type + ":" + entry.id;
      if (seen.has(key)) fail(400, "Duplicate override target.");
      seen.add(key);
      if (
        (entry.type === "role" && !s.roles.some((r) => r.id === entry.id)) ||
        (entry.type === "member" && !s.members.includes(entry.id))
      )
        fail(400, "Override target does not exist.");
      const o = {
        id: entry.id,
        type: entry.type,
        allow: permissionList(entry.allow, CHANNEL_PERMISSIONS),
        deny: permissionList(entry.deny, CHANNEL_PERMISSIONS),
      };
      if (o.allow.some((p) => o.deny.includes(p)))
        fail(400, "A permission cannot be both allowed and denied.");
      next.push(o);
    }
    const previous = permissionOverwrites(s, c);
    for (const key of new Set(
      [...previous, ...next].map((o) => o.type + ":" + o.id),
    )) {
      const a = previous.find((o) => o.type + ":" + o.id === key),
        b = next.find((o) => o.type + ":" + o.id === key);
      const canonical = (o) =>
        o
          ? JSON.stringify([o.allow.slice().sort(), o.deny.slice().sort()])
          : "";
      if (canonical(a) === canonical(b)) continue;
      const target = b || a;
      if (target.type === "role")
        editRole(
          s,
          me,
          s.roles.find((r) => r.id === target.id),
        );
      else if (me.id !== s.ownerId && !outranks(s, me.id, target.id))
        fail(403, "You cannot override permissions for this member.");
      grantCheck(s, me, [
        ...(b?.allow || []),
        ...(a?.deny || []).filter((p) => !(b?.deny || []).includes(p)),
      ]);
    }
    return next;
  }
  function updateOverwrites(s, c, me, value) {
    c.overwrites = validateOverwrites(s, c, me, value);
    if (c.type) c.permissionSynced = false;
    log(
      s,
      me,
      c.type ? "Channel permissions updated" : "Category permissions updated",
      c.name,
    );
  }
  return {
    handle,
    log,
    requirePermission,
    updateOverwrites,
    validateOverwrites,
    commit,
    moderate,
    validateModeration,
    moderationPermissions,
  };
}
