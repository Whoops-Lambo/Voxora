import { serverPermissions, channelPermissions, roleRank, screeningPending, timedOut } from './public/permissions.js';
import { isSuspended } from './platform.js';

const SAFE_PERMISSIONS = new Set(['viewChannel', 'sendMessages', 'attachFiles', 'addReactions', 'createThreads', 'connect', 'speak', 'video']);
export function initializeOnboardingServer(s) {
  s.onboarding ||= { enabled: false, title: '', description: '', channels: [], rules: [], requireRules: false, rulesVersion: 1, roleIds: [] };
  s.onboardingMembers ||= {};
}
export function onboardingJoined(s, user) {
  initializeOnboardingServer(s);
  if (user.bot) return;
  const pendingRules = s.onboarding.requireRules && s.onboarding.rules.length > 0 && s.ownerId !== user.id;
  s.onboardingMembers[user.id] = { joinedAt: Date.now(), pendingRules, needsGuide: s.onboarding.enabled || pendingRules, acceptedVersion: 0, acceptedAt: null, completedAt: null, selfRoleIds: [] };
}
export function safeRole(s, role) {
  return !!role && role.id !== 'everyone' && role.permissions.every(p => SAFE_PERMISSIONS.has(p)) &&
    [...s.channels, ...s.categories].every(c => (c.overwrites || []).every(o => o.type !== 'role' || o.id !== role.id || o.allow.every(p => SAFE_PERMISSIONS.has(p))));
}
export function sanitizeOnboarding(s) {
  initializeOnboardingServer(s); let removed = 0;
  const roles = new Set(s.onboarding.roleIds.filter(id => safeRole(s, s.roles.find(r => r.id === id))));
  s.onboarding.roleIds = [...roles];
  for (const [id, record] of Object.entries(s.onboardingMembers)) {
    if (!s.members.includes(id)) { delete s.onboardingMembers[id]; continue; }
    const withdrawn = (record.selfRoleIds || []).filter(role => !roles.has(role));
    if (withdrawn.length) {
      const before = s.memberRoles[id] || []; s.memberRoles[id] = before.filter(role => !withdrawn.includes(role)); removed += before.length - s.memberRoles[id].length;
    }
    record.selfRoleIds = (record.selfRoleIds || []).filter(role => roles.has(role) && s.memberRoles[id]?.includes(role));
    if (!s.onboarding.requireRules) record.pendingRules = false;
  }
  return removed;
}
export function onboardingSummary(s, user) {
  const c = s.onboarding, member = s.onboardingMembers?.[user.id];
  return { viewerId: user.id, enabled: !!c?.enabled, hasGuide: !!(c?.enabled || c?.rules.length || c?.roleIds.length), pendingRules: screeningPending(s, user.id), needsGuide: !!member?.needsGuide, completed: !!member?.completedAt };
}
export function onboardingService({ state, body, json, fail, save, refresh, management, revalidateVoice }) {
  const text = (value, length) => { if (typeof value !== 'string' || value.length > length) fail(400, `Use text of up to ${length} characters.`); return value.trim(); };
  function record(s, id) { return s.onboardingMembers[id] ||= { pendingRules: false, needsGuide: false, acceptedVersion: 0, acceptedAt: null, completedAt: null, selfRoleIds: [] }; }
  function roleView(s, user) {
    const self = record(s, user.id).selfRoleIds;
    return s.onboarding.roleIds.map(id => s.roles.find(r => r.id === id)).filter(r => safeRole(s, r)).map(r => ({ id: r.id, name: r.name, color: r.color, selected: !!s.memberRoles[user.id]?.includes(r.id), locked: !!s.memberRoles[user.id]?.includes(r.id) && !self.includes(r.id) }));
  }
  function view(s, user) {
    const c = s.onboarding, own = record(s, user.id);
    return { serverId: s.id, serverName: s.name, title: c.title || `Welcome to ${s.name}`, description: c.description, rules: c.rules, rulesVersion: c.rulesVersion, requireRules: c.requireRules, pendingRules: screeningPending(s, user.id), acceptedAt: own.acceptedAt, completedAt: own.completedAt,
      channels: c.channels.map(id => s.channels.find(ch => ch.id === id)).filter(ch => ch && channelPermissions(s, user.id, ch.id).includes('viewChannel')).map(ch => ({ id: ch.id, name: ch.name, topic: ch.topic || '', type: ch.type })), roles: roleView(s, user), canChooseRoles: !timedOut(s, user.id) };
  }
  async function handle(req, res, url, me) {
    const match = url.pathname.match(/^\/api\/servers\/([\w-]+)\/onboarding(?:\/(settings|complete|dismiss))?$/); if (!match) return false;
    const d = ['PATCH', 'POST'].includes(req.method) ? await body(req) : {};
    const s = state.servers.find(s => s.id === match[1] && s.members.includes(me.id));
    if (!s || me.bot || isSuspended(me)) fail(404, 'Server guide not found.');
    initializeOnboardingServer(s); const action = match[2], method = req.method;
    if (action === 'settings') {
      const permissions = serverPermissions(s, me.id), canManageGuide = permissions.includes('manageServer'), canManageRoles = permissions.includes('manageRoles');
      if (!canManageGuide && !canManageRoles) fail(403, 'You need Manage Server or Manage Roles to configure onboarding.');
      const candidates = s.roles.filter(r => safeRole(s, r) && (me.id === s.ownerId || r.position < roleRank(s, me.id)) && r.permissions.every(p => permissions.includes(p))).map(({ id, name, color }) => ({ id, name, color }));
      if (method === 'GET') { json(res, 200, { ...s.onboarding, channelIds: s.onboarding.channels.filter(id => channelPermissions(s, me.id, id).includes('viewChannel')), canManageGuide, canManageRoles, candidateRoles: candidates, channels: s.channels.filter(ch => channelPermissions(s, me.id, ch.id).includes('viewChannel')).map(({ id, name, type }) => ({ id, name, type })) }); return true; }
      if (method !== 'PATCH') fail(405, 'Method not allowed.');
      const next = structuredClone(s.onboarding);
      if (Object.keys(d).some(k => !['enabled', 'title', 'description', 'channels', 'rules', 'requireRules', 'roleIds'].includes(k))) fail(400, 'Unknown onboarding setting.');
      if (Object.keys(d).some(k => k !== 'roleIds') && !canManageGuide) fail(403, 'You need Manage Server to change welcome screens and rules.');
      if (d.roleIds !== undefined) {
        if (!canManageRoles) fail(403, 'You need Manage Roles to publish optional roles.');
        if (!Array.isArray(d.roleIds) || d.roleIds.length > 12 || new Set(d.roleIds).size !== d.roleIds.length || d.roleIds.some(id => !candidates.some(r => r.id === id))) fail(403, 'Choose up to 12 safe roles below your highest staff role. Staff permissions and management overrides cannot be self-selected.');
        next.roleIds = d.roleIds;
      }
      for (const name of ['enabled', 'requireRules']) if (d[name] !== undefined) { if (typeof d[name] !== 'boolean') fail(400, 'Invalid guide setting.'); next[name] = d[name]; }
      if (d.title !== undefined) next.title = text(d.title, 80);
      if (d.description !== undefined) next.description = text(d.description, 1000);
      if (d.rules !== undefined) {
        if (!Array.isArray(d.rules) || d.rules.length > 10) fail(400, 'Add up to 10 server rules.');
        next.rules = d.rules.map(r => { const value = text(r, 400); if (!value) fail(400, 'Rules cannot be empty.'); return value; });
      }
      if (next.requireRules && !next.rules.length) fail(400, 'Add at least one rule before requiring acceptance.');
      if (d.channels !== undefined) {
        if (!Array.isArray(d.channels) || d.channels.length > 5 || new Set(d.channels).size !== d.channels.length || d.channels.some(id => !s.channels.some(ch => ch.id === id) || !channelPermissions(s, me.id, id).includes('viewChannel'))) fail(403, 'Choose up to five channels you can view.');
        next.channels = d.channels;
      }
      if (JSON.stringify(next.rules) !== JSON.stringify(s.onboarding.rules) || next.requireRules !== s.onboarding.requireRules) next.rulesVersion++;
      s.onboarding = next; management.log(s, me, 'Server onboarding updated', s.name); await management.commit(s); json(res, 200, { ok: true }); return true;
    }
    if (!action && method === 'GET') { json(res, 200, view(s, me)); return true; }
    if (method !== 'POST' || !['complete', 'dismiss'].includes(action)) fail(405, 'Method not allowed.');
    const own = record(s, me.id);
    if (action === 'dismiss') {
      if (screeningPending(s, me.id)) fail(403, 'Accept the server rules before completing onboarding.');
      own.needsGuide = false; await save(); refresh(); json(res, 200, { ok: true }); return true;
    }
    if (screeningPending(s, me.id) && (d.acceptRules !== true || d.rulesVersion !== s.onboarding.rulesVersion)) fail(409, 'Read and accept the current rules. The guide may have changed; reopen it and try again.');
    let selected;
    if (d.roleIds !== undefined) {
      if (timedOut(s, me.id)) fail(403, 'You cannot change optional roles during a timeout.');
      const options = roleView(s, me);
      if (!Array.isArray(d.roleIds) || d.roleIds.length > 12 || new Set(d.roleIds).size !== d.roleIds.length || d.roleIds.some(id => !options.some(r => r.id === id))) fail(403, 'Choose only roles currently offered by this server.');
      selected = d.roleIds;
    }
    // Validate the entire form before changing rules acceptance or role assignments.
    if (selected) {
      const current = s.memberRoles[me.id] || [], manual = current.filter(id => !own.selfRoleIds.includes(id));
      const self = selected.filter(id => !manual.includes(id)); s.memberRoles[me.id] = [...new Set([...manual, ...self])]; own.selfRoleIds = self;
    }
    if (d.acceptRules === true && d.rulesVersion === s.onboarding.rulesVersion) { own.pendingRules = false; own.acceptedAt = Date.now(); own.acceptedVersion = s.onboarding.rulesVersion; }
    own.needsGuide = false; own.completedAt = Date.now(); await save(); revalidateVoice(s); refresh(); json(res, 200, view(s, me)); return true;
  }
  return { handle };
}
