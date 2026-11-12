export const PERMISSIONS = [
  {id:'createSuggestions',name:'Create Suggestions',group:'Text',description:'Post, discuss and vote on community suggestions in this channel.'},
  {id:'manageSuggestions',name:'Manage Suggestions',group:'Text',description:'Manage roadmap statuses, official responses, pins, locks and other members’ suggestions in this channel.'},
  {id:'sendVoiceMessages',name:'Send Voice Messages',group:'Text',description:'Record and send microphone messages. Attach Files is also required.'},
  {id:'manageStickers',name:'Manage Stickers',group:'General',description:'Upload, rename and remove server stickers.'},
  {id:'manageSoundboard',name:'Manage Soundboard',group:'General',description:'Upload, rename and remove server sound clips.'},
  {id:'manageServerTag',name:'Manage Server Tag',group:'General',description:'Configure the server tag unlocked at boost level 2.'},
  {id:'useCustomEmoji',name:'Use Custom Emoji',group:'Text',description:'Use this server’s custom emoji in messages and reactions.'},
  {id:'useStickers',name:'Send Stickers',group:'Text',description:'Send server stickers in this channel.'},
  {id:'useExternalEmoji',name:'Use External Emoji',group:'Text',description:'With Voxora Plus, use custom emoji from other servers you belong to.'},
  {id:'useExternalSoundboard',name:'Use External Soundboard',group:'Voice',description:'With Voxora Plus, play sounds from other servers you belong to.'},
  {id:'useExternalStickers',name:'Use External Stickers',group:'Text',description:'With Voxora Plus, share stickers from other servers you belong to.'},
  {id:'createPolls',name:'Create Polls',group:'Text',description:'Create message polls in this channel.'},
  {id:'useCommands',name:'Use App Commands',group:'Text',description:'Run installed bot and application commands.'},
  {id:'sendLinks',name:'Send Links',group:'Text',description:'Include HTTP and HTTPS links in posts and replies.'},
  {id:'publishRules',name:'Publish Rules',group:'Text',description:'Post in read-only rules channels.'},
  {id:'postMedia',name:'Post Media',group:'Text',description:'Publish attachments and stickers in media channels.'},
  {id:'useSoundboard',name:'Use Soundboard',group:'Voice',description:'Play server sounds to the voice channel, subject to cooldowns.'},
  {id:'useVoiceActivity',name:'Use Voice Activity',group:'Voice',description:'Transmit without holding the push-to-talk key.'},
  {id:'stream',name:'Share Screen',group:'Voice',description:'Share your screen in voice channels.'},
  {id:'muteMembers',name:'Mute Voice Members',group:'Voice',description:'Server-mute lower-ranked voice members.'},
  {id:'deafenMembers',name:'Deafen Voice Members',group:'Voice',description:'Server-deafen lower-ranked voice members.'},
  {id:'moveMembers',name:'Move Voice Members',group:'Voice',description:'Move or disconnect lower-ranked members from voice channels.'},
  {id:'manageStage',name:'Manage Stage',group:'Voice',description:'Moderate the speaker queue and approve Stage speakers.'},
  {id:'requestToSpeak',name:'Request to Speak',group:'Voice',description:'Raise your hand in a Stage channel.'},
  {id:'bypassVoiceLimit',name:'Bypass Voice User Limit',group:'Voice',description:'Join voice channels even when their configured limit is reached.'},
  {id:'createTickets',name:'Create Support Tickets',group:'Membership',description:'Open private requests with the community support team.'},
  {id:'manageTickets',name:'Manage Support Tickets',group:'Membership',description:'Read all server support tickets, including private staff notes, claim work and manage the queue.'},
  {id:'manageKnowledgeBase',name:'Manage Knowledge Base',group:'General',description:'Write, publish and restore knowledge articles in channels you can view.'},
  {id:'manageSafety',name:'Manage Server Safety',group:'Membership',description:'Temporarily pause new members or member chat with an audited lockdown.'},
  {id:'manageProjects',name:'Manage Projects',group:'Text',description:'Manage other members’ project tasks and archives in this channel.'},
  {id:'manageGiveaways',name:'Manage Giveaways',group:'Text',description:'Create, end and cancel free-entry community giveaways.'},
  {id:'viewInsights',name:'View Community Insights',group:'General',description:'View activity totals for the channels you can access.'},
  {id:'mentionEveryone',name:'Mention Everyone & Roles',group:'Text',description:'Ping @everyone, @here, and roles that are not publicly mentionable.'},
  { id: 'changeNickname', name: 'Change Nickname', group: 'Membership', description: 'Choose your own display name in this server.' },
  { id: 'manageNicknames', name: 'Manage Nicknames', group: 'Membership', description: 'Change or reset nicknames of members below your highest role.' },
  { id: 'manageAutoMod', name: 'Manage AutoMod', group: 'Membership', description: 'Configure automatic content and spam rules for the server.' },
  { id: 'manageReports', name: 'Review Reports', group: 'Membership', description: 'Review and manage moderation cases in channels you can view. Moderation actions need their own permissions.' },
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
    description: "Use camera video. Screen sharing has a separate permission.",
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
  'createSuggestions','manageSuggestions',
  "sendVoiceMessages",
  'useExternalEmoji','useExternalSoundboard','useCustomEmoji','useStickers','useExternalStickers','createPolls','useCommands','sendLinks','publishRules','postMedia',
  'useSoundboard','useVoiceActivity','stream','muteMembers','deafenMembers','moveMembers','manageStage','requestToSpeak','bypassVoiceLimit',
  "manageProjects", "manageGiveaways",
  "mentionEveryone",
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
  'createSuggestions',
  "sendVoiceMessages",
  'useExternalEmoji','useExternalSoundboard','useCustomEmoji','useStickers','useExternalStickers','createPolls','useCommands','sendLinks','postMedia','useSoundboard','useVoiceActivity','stream','requestToSpeak',
  'createTickets',
  "changeNickname",
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
  return Math.max(0, ...memberRoles(server, id).filter(r => !r.managedBoost && !optional.includes(r.id)).map(r => r.position));
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
  if(channel.rules&&!set.has('publishRules')&&!set.has('manageMessages'))for(const p of ['sendMessages','attachFiles','createThreads','useStickers','createPolls','useCommands'])set.delete(p);
  if(channel.media&&!set.has('postMedia'))for(const p of ['sendMessages','attachFiles','useStickers','createPolls'])set.delete(p);
  if(activeLockdown(server)?.pauseChat&&!set.has('manageMessages')&&!set.has('manageServer'))
    for(const p of ['sendMessages','attachFiles','addReactions','createThreads'])set.delete(p);
  return [...set];
}
export function activeLockdown(server,now=Date.now()){
  const value=server?.lockdown;
  return value?.enabled&&(value.endsAt===null||value.endsAt>now)?{enabled:true,revision:value.revision,pauseChat:value.pauseChat,pauseInvites:value.pauseInvites,reason:value.reason,endsAt:value.endsAt,startedAt:value.startedAt}:null;
}
export function outranks(server, actor, target) {
  return (
    actor !== target &&
    target !== server.ownerId &&
    (actor === server.ownerId ||
      roleRank(server, actor) > roleRank(server, target))
  );
}
