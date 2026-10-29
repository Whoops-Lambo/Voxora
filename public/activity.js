export function hasPersonalMention(text, username) {
  if (!username) return false;
  const visible = String(text || "").replace(/```[\s\S]*?```|`[^`\n]*`/g, " ");
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    "(^|[^a-z0-9_.@\\\\])@" + escaped + "(?![a-z0-9_.])",
    "i",
  ).test(visible);
}
export function mentionsUser(message, user) {
  return (
    hasPersonalMention(message.text, user.username) ||
    message.reply?.authorId === user.id
  );
}
export function notificationPolicy(
  settings,
  serverId,
  channelId,
  now = Date.now(),
) {
  const server = settings?.servers?.[serverId] || {};
  const channel = settings?.channels?.[channelId] || {};
  const muted = (value) => value === -1 || value > now;
  return {
    mode:
      channel.mode && channel.mode !== "inherit"
        ? channel.mode
        : server.mode || (serverId ? "mentions" : "all"),
    muted: muted(server.mutedUntil) || muted(channel.mutedUntil),
  };
}
export function shouldNotify(
  message,
  user,
  policy,
  { dm = false, blocked = [], dnd = false, viewing = false } = {},
) {
  return (
    message.authorId !== user.id &&
    !blocked.includes(message.authorId) &&
    !dnd &&
    !viewing &&
    !policy.muted &&
    (policy.mode === "all" ||
      (policy.mode === "mentions" && (dm || mentionsUser(message, user))))
  );
}
