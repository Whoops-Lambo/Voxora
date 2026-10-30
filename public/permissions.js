export const PERMISSIONS = [
  {
    id: "viewChannel",
    name: "View Channels",
    group: "General",
    description: "See channels and read their messages.",
  },
  {
    id: "manageServer",
    name: "Manage Server",
    group: "General",
    description: "Edit server settings, manage bot installations, and configure Discovery listings.",
  },
  {
    id: "manageExpressions", name: "Manage Emoji", group: "General",
    description: "Upload, rename, and delete custom server emoji.",
  },
  {
    id: "createThreads", name: "Create Threads", group: "Text",
    description: "Start discussions attached to messages in this channel.",
  },
  {
    id: "manageThreads", name: "Manage Threads", group: "Text",
    description: "Rename, archive, lock, and delete other members' threads.",
  },
  {
    id: "manageEvents",
    name: "Manage Events",
    group: "General",
    description: "Schedule, edit, start, cancel, and complete server events.",
  },
  {
    id: "manageChannels",
    name: "Manage Channels",
    group: "General",
    description: "Create, edit, and delete channels.",
  },
  {
    id: "manageRoles",
    name: "Manage Roles",
    group: "General",
    description:
      "Manage roles below your highest role and channel permission overrides.",
  },
  {
    id: "inviteMembers",
    name: "Create Invite",
    group: "Membership",
    description: "Create invite links for this server.",
  },
  {
    id: "kickMembers",
    name: "Kick Members",
    group: "Membership",
    description: "Remove members below your highest role.",
  },
  {
    id: "banMembers",
    name: "Ban Members",
    group: "Membership",
    description: "Ban lower-ranked members and revoke bans.",
  },
  {
    id: "moderateMembers",
    name: "Timeout Members",
    group: "Membership",
    description: "Temporarily prevent lower-ranked members from participating.",
  },
  {
    id: "viewAuditLog",
    name: "View Audit Log",
    group: "Membership",
    description: "Review management actions and their reasons.",
  },
  {
    id: "sendMessages",
    name: "Send Messages",
    group: "Text",
    description: "Send messages and edit your own messages.",
  },
  {
    id: "attachFiles",
    name: "Attach Files",
    group: "Text",
    description: "Upload images and files in text channels.",
  },
  {
    id: "addReactions",
    name: "Add Reactions",
    group: "Text",
    description: "Add emoji reactions to messages.",
  },
  {
    id: "manageMessages",
    name: "Manage Messages",
    group: "Text",
    description: "Delete other members’ messages and pin messages.",
  },
  {
    id: "connect",
    name: "Connect",
    group: "Voice",
    description: "Join voice channels.",
  },
  {
    id: "speak",
    name: "Speak",
    group: "Voice",
    description: "Transmit microphone audio in voice channels.",
  },
  {
    id: "video",
    name: "Video",
    group: "Voice",
    description: "Use camera video and screen sharing.",
  },
  {
    id: "administrator",
    name: "Administrator",
    group: "Advanced",
    description:
      "All permissions, bypassing channel overrides. Role hierarchy still applies.",
  },
];
export const PERMISSION_IDS = PERMISSIONS.map((p) => p.id);
export const CHANNEL_PERMISSIONS = [
  "createThreads", "manageThreads",
  "viewChannel",
  "sendMessages",
  "attachFiles",
  "addReactions",
  "manageMessages",
  "connect",
  "speak",
  "video",
];
export const DEFAULT_PERMISSIONS = [
  "createThreads",
  "viewChannel",
  "sendMessages",
  "attachFiles",
  "addReactions",
  "connect",
  "speak",
  "video",
  "inviteMembers",
];
export function memberRoles(server, id) {
  const assigned = server?.memberRoles?.[id] || [];
  return (server?.roles || []).filter(
    (r) => r.id === "everyone" || assigned.includes(r.id),
  );
}
export function highestRole(server, id) {
  return memberRoles(server, id).sort((a, b) => b.position - a.position)[0];
}
export function roleRank(server, id) {
  if (id === server.ownerId) return Infinity;
  if (Number.isFinite(server.roleRanks?.[id])) return server.roleRanks[id];
  const optional = server.onboardingMembers?.[id]?.selfRoleIds || [];
  return Math.max(0, ...memberRoles(server, id).filter(r => !optional.includes(r.id)).map(r => r.position));
}
export function screeningPending(server, id) {
  if (server?.onboarding?.viewerId === id) return !!server.onboarding.pendingRules;
  return !!(server?.onboarding?.requireRules && server.onboarding.rules.length && server.onboardingMembers?.[id]?.pendingRules && !administrator(server, id));
}
export function administrator(server, id) {
  return (
    server.ownerId === id ||
    memberRoles(server, id).some((r) => r.permissions.includes("administrator"))
  );
}
export function timedOut(server, id) {
  return (
    (server?.timeouts?.[id] || 0) > Date.now() && !administrator(server, id)
  );
}
export function serverPermissions(server, id) {
  if (!server?.members.includes(id)) return [];
  if (administrator(server, id)) return [...PERMISSION_IDS];
  if (timedOut(server, id) || screeningPending(server, id)) return ["viewChannel"];
  return [...new Set(memberRoles(server, id).flatMap((r) => r.permissions))];
}
export function permissionOverwrites(server, channel) {
  return (
    (channel.permissionSynced &&
      server.categories?.find((c) => c.id === channel.categoryId)
        ?.overwrites) ||
    channel.overwrites ||
    []
  );
}
export function channelPermissions(server, id, channelId) {
  if (!server?.members.includes(id)) return [];
  const channel = server.channels.find((c) => c.id === channelId);
  if (!channel) return [];
  if (administrator(server, id)) return [...PERMISSION_IDS];
  const set = new Set(serverPermissions(server, id));
  const overrides = permissionOverwrites(server, channel);
  const apply = (deny, allow) => {
    for (const p of deny) set.delete(p);
    for (const p of allow) set.add(p);
  };
  const everyone = overrides.find(
    (o) => o.type === "role" && o.id === "everyone",
  );
  if (everyone) apply(everyone.deny, everyone.allow);
  const ids = new Set(
    memberRoles(server, id)
      .filter((r) => r.id !== "everyone")
      .map((r) => r.id),
  );
  const matching = overrides.filter((o) => o.type === "role" && ids.has(o.id));
  apply(
    matching.flatMap((o) => o.deny),
    matching.flatMap((o) => o.allow),
  );
  const member = overrides.find((o) => o.type === "member" && o.id === id);
  if (member) apply(member.deny, member.allow);
  if (timedOut(server, id) || screeningPending(server, id))
    return set.has("viewChannel") ? ["viewChannel"] : [];
  return [...set];
}
export function outranks(server, actor, target) {
  return (
    actor !== target &&
    target !== server.ownerId &&
    (actor === server.ownerId ||
      roleRank(server, actor) > roleRank(server, target))
  );
}
