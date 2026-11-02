export function visibleMentionText(text) {
  return String(text || '').replace(/```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>]+/g, value => ' '.repeat(value.length));
}
export function mentionTokens(text) {
  const visible = visibleMentionText(text), result = [];
  for (const match of visible.matchAll(/<@&?[a-f0-9-]{36}>|@\{[^}\n]{1,40}\}|@[a-z0-9_.]{1,24}(?![a-z0-9_.])/gi)) {
    if (/[a-z0-9_.@\\]/i.test(visible[match.index - 1] || '')) continue;
    const token = match[0];
    result.push({token, value:token.startsWith('@{')?token.slice(2,-1):token.startsWith('<@')?token.slice(token[2]==='&'?3:2,-1):token.slice(1), kind:token.startsWith('@{')||token.startsWith('<@&')?'role':token.startsWith('<@')?'userId':'name'});
  }
  return result;
}
