import { randomUUID, createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { administrator, serverPermissions, channelPermissions, memberRoles, outranks } from './public/permissions.js';
import { hasPersonalMention } from './public/activity.js';
import { isSuspended } from './platform.js';

export const RULE_KINDS = ['keywords', 'domains', 'mentions', 'spam', 'duplicates'];
export const REPORT_REASONS = ['Harassment', 'Spam', 'Harmful content', 'Privacy violation', 'Other'];
const OPEN = new Set(['open', 'reviewing']);
const normalized = text => String(text).normalize('NFKC').replace(/\p{Cf}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const fingerprint = text => createHash('sha256').update(normalized(text)).digest('hex');
const evidenceText = (text, poll) => [text, ...(poll ? [poll.question, ...poll.answers.map(a => typeof a === 'string' ? a : a.text)] : [])].filter(Boolean).join('\n').slice(0, 4000);
export function initializeModerationServer(s) {
  s.moderation ||= { autoMod: { enabled: false, rules: [] }, cases: [], recent: [], reportRate: [], droppedEvents: 0 };
}
export function moderationService({ state, body, json, fail, save, management, canRead, canChannel, serverFor, userById, notify, removeMessage }) {
  const patterns = new Map();
  const text = (value, max, required = false) => { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `Use ${required ? 'nonempty ' : ''}text of up to ${max} characters.`); return value.trim(); };
  const permission = (s, me, name) => !isSuspended(me) && !me.bot && serverPermissions(s, me.id).includes(name);
  const reviewer = (s, me, c) => permission(s, me, 'manageReports') && canRead(me, c.channel);
  function prune(s) {
    const m = s.moderation; m.recent = m.recent.filter(e => e.time > Date.now() - 300000).slice(-5000); m.reportRate = m.reportRate.filter(e => e.time > Date.now() - 600000).slice(-5000);
    m.cases = m.cases.filter(c => s.channels.some(ch => ch.id === c.channel));
  }
  function ruleData(s, me, d, old) {
    const rule = old ? structuredClone(old) : { id: randomUUID(), name: '', kind: 'keywords', enabled: true, action: 'block', terms: [], domains: [], limit: 5, windowSeconds: 10, exemptRoleIds: [], exemptChannelIds: [] };
    if (Object.keys(d).some(k => !['name', 'kind', 'enabled', 'action', 'terms', 'domains', 'limit', 'windowSeconds', 'exemptRoleIds', 'exemptChannelIds'].includes(k))) fail(400, 'Unknown AutoMod setting.');
    if (d.name !== undefined) rule.name = text(d.name, 80, true);
    if (d.kind !== undefined) { if (!RULE_KINDS.includes(d.kind) || old && old.kind !== d.kind) fail(400, 'Choose a supported rule type; create a new rule to change its type.'); rule.kind = d.kind; }
    if (d.enabled !== undefined) { if (typeof d.enabled !== 'boolean') fail(400, 'Invalid rule state.'); rule.enabled = d.enabled; }
    if (d.action !== undefined) { if (!['block', 'flag'].includes(d.action)) fail(400, 'Choose Block or Flag.'); rule.action = d.action; }
    if (d.terms !== undefined) {
      if (!Array.isArray(d.terms) || d.terms.length > 50) fail(400, 'Add up to 50 literal words or phrases.');
      rule.terms = [...new Set(d.terms.map(term => { const value = normalized(text(term, 80, true)); if (!value || value.length > 160) fail(400, 'Use visible words or phrases.'); return value; }))];
    }
    if (d.domains !== undefined) {
      if (!Array.isArray(d.domains) || d.domains.length > 25) fail(400, 'Add up to 25 domains.');
      rule.domains = [...new Set(d.domains.map(value => {
        const name = domainToASCII(text(value, 253, true).replace(/\.$/, '').toLowerCase());
        if (!name.includes('.') || name.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) fail(400, 'Use domain names without URLs, paths, or wildcards.'); return name;
      }))];
    }
    if (d.limit !== undefined) { if (!Number.isInteger(d.limit) || d.limit < 1 || d.limit > 20) fail(400, 'Choose a limit from 1 to 20.'); rule.limit = d.limit; }
    if (d.windowSeconds !== undefined) { if (!Number.isInteger(d.windowSeconds) || d.windowSeconds < 5 || d.windowSeconds > 300) fail(400, 'Choose a window from 5 to 300 seconds.'); rule.windowSeconds = d.windowSeconds; }
    for (const key of ['exemptRoleIds', 'exemptChannelIds']) if (d[key] !== undefined) {
      const limit = key === 'exemptRoleIds' ? 25 : 100;
      if (!Array.isArray(d[key]) || d[key].length > limit || new Set(d[key]).size !== d[key].length || d[key].some(id => key === 'exemptRoleIds' ? id === 'everyone' || !s.roles.some(r => r.id === id) : !s.channels.some(c => c.id === id) || !canRead(me, id))) fail(403, 'Choose existing custom roles and channels you can view.');
      rule[key] = key === 'exemptChannelIds' ? [...new Set([...d[key], ...(old?.[key] || []).filter(id => s.channels.some(c => c.id === id) && !canRead(me, id))])] : d[key];
      if (rule[key].length > limit) fail(400, 'This rule already has the maximum number of exemptions.');
    }
    if (!rule.name || rule.kind === 'keywords' && !rule.terms.length || rule.kind === 'domains' && !rule.domains.length) fail(400, 'Give the rule a name and its required words or domains.');
    return rule;
  }
  function source(id, threadId) {
    const m = threadId ? state.threadMessages.find(m => m.id === id && m.threadId === threadId) : state.messages.find(m => m.id === id);
    if (!m) return null;
    if (threadId) { const t = state.threads.find(t => t.id === threadId && t.channelId === m.channel); if (!t || !state.messages.some(p => p.id === t.parentId)) return null; }
    return m;
  }
  function inspect(me, channel, value, options = {}) {
    const s = serverFor(channel); if (!s || !options.preview && (!s.moderation.autoMod.enabled || me.bot || administrator(s, me.id))) return null;
    if (!options.preview) prune(s); const content = evidenceText(value, options.poll), clean = normalized(content), hash = fingerprint(content || JSON.stringify(options.files || [])), roles = memberRoles(s, me.id).map(r => r.id);
    const recent = s.moderation.recent.filter(e => e.userId === me.id && e.channel === channel);
    const matches = s.moderation.autoMod.rules.filter(rule => {
      if (!rule.enabled || rule.exemptChannelIds.includes(channel) || rule.exemptRoleIds.some(id => roles.includes(id))) return false;
      if (rule.kind === 'keywords') {
        const key = JSON.stringify(rule.terms); let compiled = patterns.get(rule.id);
        if (compiled?.key !== key) { compiled = { key, expressions: rule.terms.map(term => new RegExp('(?<![\\p{L}\\p{N}_])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'u')) }; patterns.set(rule.id, compiled); }
        return compiled.expressions.some(expression => expression.test(clean));
      }
      if (rule.kind === 'domains') return [...content.matchAll(/https?:\/\/[^\s<>]+/gi)].some(match => { try { const host = new URL(match[0]).hostname.replace(/\.$/, '').toLowerCase(); return rule.domains.some(domain => host === domain || host.endsWith('.' + domain)); } catch { return false; } });
      if (rule.kind === 'mentions') return state.users.filter(u => u.id !== me.id && s.members.includes(u.id) && hasPersonalMention(content, u.username)).length > rule.limit;
      if (options.operation === 'edit') return false;
      const window = recent.filter(e => e.time > Date.now() - rule.windowSeconds * 1000);
      return (rule.kind === 'duplicates' ? window.filter(e => e.hash === hash) : window).length >= rule.limit;
    });
    return { server: s, channel, content, hash, matches, blocked: matches.some(rule => rule.action === 'block'), operation: options.operation || 'create', threadId: options.threadId || null, messageId: options.messageId || null };
  }
  function snapshot(me, content, files = []) { return { authorId: me.id, authorName: me.displayName, text: content, files: files.map(id => state.files.find(f => f.id === id)).filter(Boolean).map(f => f.name).slice(0, 5) }; }
  function newCase(s, value) {
    prune(s);
    while (s.moderation.cases.length >= 500) { const index = s.moderation.cases.findIndex(c => !OPEN.has(c.status)); if (index < 0) return null; s.moderation.cases.splice(index, 1); }
    const id = randomUUID(), c = { id, number: id.slice(0, 8).toUpperCase(), status: 'open', version: 1, createdAt: Date.now(), updatedAt: Date.now(), assigneeId: null, history: [], reporters: [], attempts: 1, ...value };
    s.moderation.cases.push(c); return c;
  }
  function incident(me, decision, message) {
    if (!decision.matches.length) return;
    const s = decision.server, action = decision.blocked ? 'block' : 'flag', signature = decision.matches.map(r => r.id).sort().join(',');
    let c = s.moderation.cases.find(c => c.kind === 'automod' && OPEN.has(c.status) && c.channel === message.channel && c.threadId === (message.threadId || decision.threadId) && c.snapshot.authorId === me.id && c.action === action && c.operation === decision.operation && c.signature === signature && c.lastTriggeredAt > Date.now() - 60000);
    const data = { kind: 'automod', channel: message.channel, threadId: message.threadId || decision.threadId, messageId: message.id || decision.messageId, snapshot: snapshot(me, decision.content, message.files), action, operation: decision.operation, rules: decision.matches.map(r => ({ id: r.id, name: r.name })), signature, lastTriggeredAt: Date.now() };
    // Keep the original evidence and action target stable while repeated traffic is counted.
    // Only staff changes advance the workflow version, so a spam flood cannot prevent triage.
    if (c) { c.attempts++; c.lastTriggeredAt = Date.now(); c.updatedAt = Date.now(); }
    else { c = newCase(s, data); if (c) management.log(s, { id: null, displayName: 'AutoMod' }, action === 'block' ? 'AutoMod blocked a message' : 'AutoMod flagged a message', 'Case ' + c.number); }
    if (!c) s.moderation.droppedEvents++;
  }
  async function reject(me, decision, message) {
    incident(me, decision, message); await save(); notify(decision.server, { channel: message.channel, reporters: [] }); fail(422, 'This message was blocked by this server’s AutoMod rules. Edit it and try again.', { code: 'automod_blocked' });
  }
  function accept(me, message, decision) {
    if (!decision) return;
    if (decision.operation !== 'edit') decision.server.moderation.recent.push({ userId: me.id, channel: message.channel, hash: decision.hash, time: Date.now() });
    incident(me, decision, message);
  }
  function actions(s, me, c) {
    const result = [], m = source(c.messageId, c.threadId);
    if (m && canChannel(me, c.channel, 'manageMessages')) result.push('remove-message');
    if (s.members.includes(c.snapshot.authorId) && outranks(s, me.id, c.snapshot.authorId)) {
      for (const [name, p] of [['timeout', 'moderateMembers'], ['kick', 'kickMembers'], ['ban', 'banMembers']]) if (permission(s, me, p) && (name !== 'timeout' || !administrator(s, c.snapshot.authorId))) result.push(name);
    }
    return result;
  }
  function caseView(s, me, c) {
    const m = source(c.messageId, c.threadId);
    return { id: c.id, number: c.number, kind: c.kind, status: c.status, version: c.version, createdAt: c.createdAt, updatedAt: c.updatedAt, channel: c.channel, channelName: s.channels.find(ch => ch.id === c.channel)?.name || '', threadId: c.threadId, messageId: c.messageId, snapshot: c.snapshot, attempts: c.attempts, action: c.action || null, operation: c.operation || null, rules: c.rules || [], reporters: c.reporters.map(r => ({ ...r, name: userById(r.userId)?.displayName || r.name })), assigneeId: c.assigneeId, assigneeName: c.assigneeId ? userById(c.assigneeId)?.displayName || 'Former staff member' : null, history: c.history, canOpen: !!m, availableActions: OPEN.has(c.status) ? actions(s, me, c) : [] };
  }
  function history(c, me, kind, content) { c.history.push({ actorId: me.id, actorName: me.displayName, kind, text: content, time: Date.now() }); c.history = c.history.slice(-20); c.updatedAt = Date.now(); c.version++; }
  const receipt = (c, r) => ({ id: c.id, number: c.number, status: c.status, reason: r.reason, details: r.details, reportedAt: r.time });
  async function handle(req, res, url, me) {
    const match = url.pathname.match(/^\/api\/servers\/([\w-]+)\/(automod|reports|moderation)(?:\/(rules|test|cases|stats|mine)(?:\/([\w-]+)(?:\/(action))?)?)?$/);
    if (!match) return false;
    const d = ['POST', 'PATCH'].includes(req.method) ? await body(req) : {}, method = req.method;
    const s = state.servers.find(s => s.id === match[1] && s.members.includes(me.id)); if (!s || me.bot || isSuspended(me)) fail(404, 'Server not found.');
    const [, , kind, part, id, operation] = match; const store = s.moderation;
    if (kind === 'automod') {
      management.requirePermission(s, me, 'manageAutoMod');
      if (!part && method === 'GET') { json(res, 200, { enabled: store.autoMod.enabled, rules: store.autoMod.rules.map(r => ({ ...r, exemptChannelIds: r.exemptChannelIds.filter(id => canRead(me, id)) })), channels: s.channels.filter(c => canRead(me, c.id)).map(({ id, name }) => ({ id, name })), roles: s.roles.filter(r => r.id !== 'everyone').map(({ id, name }) => ({ id, name })) }); return true; }
      if (!part && method === 'PATCH') { if (typeof d.enabled !== 'boolean') fail(400, 'Choose whether AutoMod is enabled.'); store.autoMod.enabled = d.enabled; if (!d.enabled) store.recent = []; management.log(s, me, d.enabled ? 'AutoMod enabled' : 'AutoMod disabled', s.name); await management.commit(s); json(res, 200, { ok: true }); return true; }
      if (part === 'test' && method === 'POST') {
        if (!s.channels.some(c => c.id === d.channel && c.type === 'text') || !canRead(me, d.channel)) fail(403, 'Choose a text channel you can view.');
        const value = text(d.text, 2000), subject = d.userId ? userById(d.userId) : me; if (!subject || !s.members.includes(subject.id)) fail(404, 'Member not found.');
        const decision = inspect(subject, d.channel, value, { preview: true }); json(res, 200, { enabled: store.autoMod.enabled, blocked: !!decision?.blocked, matches: decision?.matches.map(({ id, name, action }) => ({ id, name, action })) || [] }); return true;
      }
      if (part === 'rules') {
        const old = id && store.autoMod.rules.find(r => r.id === id); if (id && !old) fail(404, 'Rule not found.');
        if (!id && method === 'POST' || id && method === 'PATCH') {
          if (!id && store.autoMod.rules.length >= 25) fail(400, 'A server can have up to 25 AutoMod rules.');
          const rule = ruleData(s, me, d, old); if (old) store.autoMod.rules = store.autoMod.rules.map(r => r === old ? rule : r); else store.autoMod.rules.push(rule);
          patterns.delete(rule.id); management.log(s, me, old ? 'AutoMod rule updated' : 'AutoMod rule created', rule.name); await management.commit(s); json(res, old ? 200 : 201, { ...rule, exemptChannelIds: rule.exemptChannelIds.filter(id => canRead(me, id)) }); return true;
        }
        if (id && method === 'DELETE') { store.autoMod.rules = store.autoMod.rules.filter(r => r !== old); patterns.delete(id); management.log(s, me, 'AutoMod rule removed', old.name); await management.commit(s); json(res, 200, { ok: true }); return true; }
      }
      fail(405, 'Method not allowed.');
    }
    if (kind === 'reports') {
      if (part === 'mine' && method === 'GET') {
        const items = store.cases.filter(c => canRead(me, c.channel) && c.reporters.some(r => r.userId === me.id)).sort((a,b) => b.createdAt-a.createdAt).map(c => ({ ...receipt(c, c.reporters.find(r => r.userId === me.id)), sourceAvailable: !!source(c.messageId, c.threadId) }));
        json(res, 200, { items }); return true;
      }
      if (part || method !== 'POST') fail(405, 'Method not allowed.');
      const m = source(d.messageId, d.threadId || null); if (!m || serverFor(m.channel)?.id !== s.id || !canRead(me, m.channel)) fail(404, 'Message not found or no longer accessible.');
      if (m.authorId === me.id) fail(400, 'Report another member’s message.');
      if (!REPORT_REASONS.includes(d.reason)) fail(400, 'Choose a report reason.'); const details = text(d.details || '', 1000);
      const existing = store.cases.find(c => c.kind === 'report' && c.messageId === m.id && c.threadId === (m.threadId || null) && c.reporters.some(r => r.userId === me.id));
      if (existing) { json(res, 200, receipt(existing, existing.reporters.find(r => r.userId === me.id))); return true; }
      prune(s); if (store.reportRate.filter(r => r.userId === me.id).length >= 5) fail(429, 'You can submit up to five reports every ten minutes in this server.');
      let c = store.cases.find(c => c.kind === 'report' && OPEN.has(c.status) && c.messageId === m.id && c.threadId === (m.threadId || null) && c.reporters.length < 20);
      if (!c) c = newCase(s, { kind: 'report', channel: m.channel, threadId: m.threadId || null, messageId: m.id, snapshot: snapshot(userById(m.authorId) || { id: null, displayName: m.author || 'Announcement' }, evidenceText(m.text, m.poll), m.files) });
      if (!c) fail(429, 'The moderation queue is full. Contact server staff.');
      const report = { userId: me.id, name: me.displayName, reason: d.reason, details, time: Date.now() }; c.reporters.push(report); c.updatedAt = Date.now(); store.reportRate.push({ userId: me.id, time: report.time });
      await save(); notify(s,c); json(res, 201, receipt(c, report)); return true;
    }
    management.requirePermission(s, me, 'manageReports');
    const visible = store.cases.filter(c => reviewer(s, me, c));
    if (part === 'stats' && method === 'GET') {
      const day = 86400000, first = Math.floor(Date.now()/day)*day-6*day, channels = s.channels.filter(c => canRead(me, c.id));
      const messages = [...state.messages, ...state.threadMessages].filter(m => m.time >= first && channels.some(c => c.id === m.channel));
      const cases = visible.filter(c => c.createdAt >= first), daily = Array.from({length:7},(_,i)=>{ const start=first+i*day; return { day:start, messages:messages.filter(m=>m.time>=start&&m.time<start+day).length, cases:cases.filter(c=>c.createdAt>=start&&c.createdAt<start+day).length }; });
      json(res, 200, { open: visible.filter(c=>OPEN.has(c.status)).length, mine: visible.filter(c=>OPEN.has(c.status)&&c.assigneeId===me.id).length, blocked: cases.filter(c=>c.action==='block').reduce((n,c)=>n+c.attempts,0), flagged: cases.filter(c=>c.action==='flag').reduce((n,c)=>n+c.attempts,0), reports: cases.reduce((n,c)=>n+c.reporters.length,0), messages: messages.length, activeMembers: new Set(messages.filter(m=>m.authorId&&!userById(m.authorId)?.bot).map(m=>m.authorId)).size, daily, droppedEvents: s.ownerId === me.id ? store.droppedEvents : null }); return true;
    }
    if (part !== 'cases') fail(405, 'Method not allowed.');
    if (!id && method === 'GET') {
      const status = url.searchParams.get('status') || 'open', type = url.searchParams.get('kind') || '', channel = url.searchParams.get('channel'), q = (url.searchParams.get('q') || '').toLowerCase().slice(0,100), offset = Number(url.searchParams.get('offset')||0);
      if (!['open','reviewing','resolved','dismissed','all'].includes(status) || type && !['automod','report'].includes(type) || !Number.isSafeInteger(offset) || offset < 0) fail(400,'Invalid queue filter.');
      const list = visible.filter(c=>(status==='all'||status==='open'&&OPEN.has(c.status)||c.status===status)&&(!type||c.kind===type)&&(!channel||c.channel===channel)&&(c.snapshot.text+' '+c.snapshot.authorName+' '+c.number+' '+c.history.map(h=>h.text).join(' ')).toLowerCase().includes(q)).sort((a,b)=>b.updatedAt-a.updatedAt);
      json(res,200,{items:list.slice(offset,offset+20).map(c=>caseView(s,me,c)),total:list.length,hasMore:offset+20<list.length,channels:s.channels.filter(c=>canRead(me,c.id)).map(({id,name})=>({id,name}))});return true;
    }
    const c = store.cases.find(c=>c.id===id); if (!c || !reviewer(s,me,c)) fail(404,'Case not found.');
    if (method==='GET'&&!operation) {json(res,200,caseView(s,me,c));return true;}
    if (!Number.isSafeInteger(d.version)||d.version!==c.version) fail(409,'This case changed. Refresh it before saving.');
    if (operation==='action'&&method==='POST') {
      if (!OPEN.has(c.status)) fail(409,'Reopen the case before taking another action.');
      if (!actions(s,me,c).includes(d.action)) fail(403,'Your current permissions or role hierarchy do not allow this action.');
      const reason = text(d.reason,500,true); let afterSave;
      if (d.action==='remove-message') afterSave = removeMessage(source(c.messageId,c.threadId));
      else {
        const data={reason}; if(d.action==='timeout'){ if(!Number.isInteger(d.durationSeconds)||d.durationSeconds<60||d.durationSeconds>28*86400)fail(400,'Choose a timeout from one minute to 28 days.');data.timeoutUntil=Date.now()+d.durationSeconds*1000; }
        management.moderate(s,me,d.action,c.snapshot.authorId,data);
      }
      c.status='resolved';history(c,me,'action',d.action+': '+reason);management.log(s,me,'Moderation case action','Case '+c.number);
      await management.commit(s);afterSave?.();notify(s,c);json(res,200,caseView(s,me,c));return true;
    }
    if(method!=='PATCH'||operation)fail(405,'Method not allowed.');
    if(Object.keys(d).some(k=>!['version','claim','note','status','resolution'].includes(k)))fail(400,'Unknown case update.');
    const next={};let note;
    if(d.note!==undefined)note=text(d.note,1000,true);
    if(d.status!==undefined){if(!['open','reviewing','resolved','dismissed'].includes(d.status))fail(400,'Invalid case status.');next.status=d.status;if(!OPEN.has(d.status))next.resolution=text(d.resolution,500,true);}
    if(d.claim!==undefined){if(typeof d.claim!=='boolean'||!OPEN.has(c.status))fail(400,'Only open cases can be claimed.');const assigned=userById(c.assigneeId);if(c.assigneeId&&c.assigneeId!==me.id&&assigned&&reviewer(s,assigned,c)&&!administrator(s,me.id))fail(409,'Another moderator has claimed this case.');next.assigneeId=d.claim?me.id:null;}
    if(next.assigneeId!==undefined){c.assigneeId=next.assigneeId;if(d.claim&&c.status==='open')c.status='reviewing';history(c,me,'assignment',d.claim?'Claimed the case':'Released the case');}
    if(next.status){c.status=next.status;history(c,me,'status',next.status+(next.resolution?': '+next.resolution:''));management.log(s,me,'Moderation case '+next.status,'Case '+c.number);}
    if(note)history(c,me,'note',note);
    await save();notify(s,c);json(res,200,caseView(s,me,c));return true;
  }
  return { inspect, reject, accept, handle, notify: decision => { if(decision?.matches.length)notify(decision.server,{ channel: decision.channel, reporters: [] }); } };
}
