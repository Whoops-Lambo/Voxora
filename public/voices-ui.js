export function createVoicesUI({node, button, input, field: rawField, modal, formDialog, confirmDialog, api: requestAPI, getState, getRoute, refreshState, toast, openProfile}) {
  const me = () => getState()?.me;
  const server = id => getState()?.servers.find(s => s.id === id);
  const dialog = () => document.getElementById('modal');
  const field = (label, control) => { control.setAttribute('aria-label', label); return rawField(label, control); };
  const area = (value = '', max = 2000) => { const t = node('textarea', 'voices-textarea'); t.value = value; t.maxLength = max; return t; };
  const select = (label, items, value) => { const s = node('select'); s.setAttribute('aria-label', label); for (const [id, name] of items) s.append(new Option(name, id)); s.value = value; return s; };
  const check = (value = false) => { const c = input('', '', 'checkbox'); c.checked = value; return c; };
  const actions = (...items) => node('div', 'voices-actions', items);
  const when = t => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const statuses = [['open', 'Open'], ['planned', 'Planned'], ['in-progress', 'In Progress'], ['completed', 'Completed'], ['declined', 'Declined']];
  const categories = [['idea', 'Idea'], ['feature', 'Feature'], ['bug', 'Bug'], ['community', 'Community']];
  let active, editor, timer;
  const api = async (...args) => { const account = me()?.id; const result = await requestAPI(...args); if (!account || account !== me()?.id) throw Error('Your account changed. Reopen Community Voices.'); return result; };
  function allowed(scope) {
    if (!me()) return false;
    const s = scope.serverId && server(scope.serverId); if (scope.serverId && !s) return false;
    if (scope.channelId && !s.channels.some(c => c.id === scope.channelId)) return false;
    if (scope.plus && !getState().premium?.active) return false;
    return true;
  }
  const live = v => active === v && v.account === me()?.id && v.root.isConnected && dialog().open && allowed(v.scope);
  function show(title, description, scope = {}) {
    editor = null;
    const body = node('div', 'voices-body'), heading = node('h1', '', title), head = node('header', 'voices-hero', [node('p', 'voices-eyebrow', 'VOXORA / COMMUNITY VOICES'), heading, node('p', '', description)]), root = node('section', 'voices-view', [head, body]);
    const v = { root, body, head, heading, scope, account: me().id, request: 0, dirty: false }; active = v;
    v.refresh = button('Refresh Community View', () => { v.dirty = false; return v.reload?.(); }); v.refresh.hidden = true; head.append(v.refresh);
    modal([root], 'voices-dialog'); return v;
  }
  async function load(v, path, draw) {
    v.refresh.hidden = false; const request = ++v.request;
    if (!v.body.childElementCount) v.body.append(node('p', 'muted', 'Loading…'));
    try { const data = await api(path); if (!live(v) || request !== v.request || v.dirty) return; const scroll = dialog().scrollTop; v.body.replaceChildren(); draw(data); dialog().scrollTop = scroll; }
    catch (e) { if (live(v) && request === v.request) v.body.replaceChildren(node('p', 'form-error', e.message), button('Retry Community View', () => v.reload())); }
  }
  function form(config, scope, validate) {
    const account = me().id;
    formDialog({...config, submit: async () => { if (account !== me()?.id || !allowed(scope)) throw Error('Your access changed. Reopen this form.'); return config.submit(); }});
    editor = { account, scope, element: document.getElementById('modal-content').firstElementChild, validate };
  }
  const card = (title, description, controls = []) => node('article', 'voices-card', [node('h3', '', title), node('p', 'voices-copy', description), actions(...controls)]);
  function home() {
    const v = show('Every community has a voice.', 'Find your people, shape what comes next, and make a profile that belongs here.');
    v.body.append(actions(button('Community Updates' + (getState().voices?.unread ? ' (' + getState().voices.unread + ')' : ''), updates, 'primary')));
    const grid = node('div', 'voices-grid');
    for (const s of [...getState().servers].sort((a, b) => Number(b.id === getRoute().server) - Number(a.id === getRoute().server))) grid.append(card(s.name, 'Community profiles, member interests and the suggestion roadmap.', [button('Community Directory', () => directory(s.id), 'primary'), button('Suggestion Board', () => board(s.id)), button('My Server Profile', () => profile(s.id, me().id))]));
    v.body.append(grid);
  }
  function profileCard(p, sid, full = false) {
    const root = node('article', 'voices-profile voices-pattern-' + p.style.pattern), banner = node('div', 'voices-profile-banner'), content = node('div', 'voices-profile-content');
    root.style.setProperty('--profile-accent', p.style.accent); banner.style.backgroundColor = p.style.bannerStart; banner.style.backgroundImage = 'linear-gradient(120deg,' + p.style.bannerStart + ',' + p.style.bannerEnd + ')';
    const avatar = node('div', 'voices-profile-avatar', p.name.slice(0, 2).toUpperCase()); avatar.style.backgroundColor = p.color;
    if (p.avatarUrl) { const image = node('img'); image.src = p.avatarUrl; image.alt = ''; avatar.replaceChildren(image); }
    content.append(avatar, node('h2', '', p.name), node('p', 'muted', '@' + p.username), node('small', 'voices-presence', ({online:'Online',idle:'Away',dnd:'Do not disturb',offline:'Offline'}[p.status] || 'Offline')));
    if (p.style.headline) content.append(node('p', 'voices-headline', p.style.headline));
    if (p.style.communityTitle) content.append(node('span', 'voices-community-title', p.style.communityTitle), node('small', 'voices-title-disclosure', 'Member-written title'));
    if (p.pronouns) content.append(node('p', 'muted', p.pronouns));
    content.append(node('p', 'voices-copy', full ? p.bio : p.bio.slice(0, 180)), node('p', 'voices-availability', (p.lookingForGroup ? 'Looking for a group · ' : '') + ({ ask: 'Ask about availability', open: 'Open to connect', busy: 'Busy right now' }[p.availability])));
    const tags = node('div', 'voices-tags'); for (const tag of p.interests) tags.append(node('span', '', tag)); content.append(tags);
    if (full) {
      const roles = node('div', 'voices-tags'); for (const role of p.roles) { const tag = node('span', '', role.name); if (role.color) tag.style.borderColor = role.color; roles.append(tag); } content.append(roles);
      if (p.timeZone) { try { content.append(node('p', 'muted', 'Local time · ' + new Intl.DateTimeFormat([], { timeZone: p.timeZone, hour: 'numeric', minute: '2-digit' }).format())); } catch {} }
      const links = node('div', 'voices-links'); for (const l of p.style.links) { const a = node('a', '', l.label); a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.append(a); } content.append(links);
    } else content.append(actions(button('View Server Profile', () => profile(sid, p.userId))));
    root.append(banner, content); return root;
  }
  async function directory(sid) {
    const s = server(sid); if (!s) return;
    const v = show(s.name + ' / Community Directory', 'Search server profiles and find people who share your interests. Availability is self-described, separate from online status.', { serverId: sid });
    v.filters = { q: '', role: '', interest: '', presence: 'all', lfg: '0', sort: 'name', offset: 0 };
    v.reload = () => load(v, '/servers/' + sid + '/voices/profiles?' + new URLSearchParams(v.filters), data => {
      v.body.append(actions(button('My Server Profile', () => profile(sid, me().id), 'primary'), button('Suggestion Board', () => board(sid)), button('All Communities', home)));
      const query = input(v.filters.q, 'Search names, bios and interests'), role = select('DIRECTORY ROLE', [['', 'All roles'], ...data.roles.map(r => [r.id, r.name])], v.filters.role), interest = select('DIRECTORY INTEREST', [['', 'All interests'], ...data.interests.map(t => [t, t])], v.filters.interest), presence = select('DIRECTORY PRESENCE', [['all', 'Any online status'], ['online', 'Online'], ['offline', 'Offline']], v.filters.presence), lfg = check(v.filters.lfg === '1'), sort = select('DIRECTORY SORT', [['name', 'Name'], ['available', 'Open to connect first']], v.filters.sort);
      query.setAttribute('aria-label', 'Search community profiles');
      const apply = () => { v.filters = { q: query.value, role: role.value, interest: interest.value, presence: presence.value, lfg: lfg.checked ? '1' : '0', sort: sort.value, offset: 0 }; v.dirty = false; return v.reload(); };
      query.oninput = () => v.dirty = true; query.onkeydown = e => { if (e.key === 'Enter') apply(); };
      for (const c of [role, interest, presence, lfg, sort]) c.onchange = apply;
      v.body.append(node('div', 'voices-filters', [query, role, interest, presence, sort, field('Looking for a group', lfg), button('Search Profiles', apply)]), node('p', 'muted', data.total + ' matching profile(s)'));
      const grid = node('div', 'voices-grid'); for (const p of data.items) grid.append(profileCard(p, sid)); v.body.append(grid);
      if (!data.items.length) v.body.append(node('p', 'voices-empty', 'No matching profiles. Try another interest or filter.'));
      pagination(v, data, () => v.reload());
    }); await v.reload();
  }
  function pagination(v, data, reload) {
    const controls = actions();
    if (v.filters.offset) controls.append(button('Previous Results', () => { v.filters.offset = Math.max(0, v.filters.offset - 30); return reload(); }));
    if (data.hasMore) controls.append(button('More Results', () => { v.filters.offset += 30; return reload(); })); v.body.append(controls);
  }
  async function profile(sid, userId) {
    const v = show('Server Profile', 'This profile is shared only within this community.', { serverId: sid });
    v.reload = () => load(v, '/servers/' + sid + '/voices/profiles/' + userId, p => {
      v.heading.textContent = p.name + ' / Server Profile'; v.body.append(profileCard(p, sid, true));
      v.body.append(actions(button('Community Directory', () => directory(sid)), button('Global Profile', () => openProfile(userId))));
      if (userId === me().id) {
        const style = button('Style Server Profile · Plus', () => styleEditor(sid, p), 'primary'); style.disabled = !getState().premium?.active;
        v.body.append(actions(button('Edit Server Profile', () => profileEditor(sid, p), 'primary'), style));
      }
      if (p.canReset) v.body.append(button(userId === me().id ? 'Reset My Server Profile' : 'Reset Member Server Profile', () => confirmDialog('Reset Server Profile', 'Clear this community profile and its style? The global account profile stays available.', async () => { await api('/servers/' + sid + '/voices/profiles/' + userId + '?revision=' + p.revision, 'DELETE'); await profile(sid, userId); }), 'danger'));
    }); await v.reload();
  }
  function profileEditor(sid, p) {
    const bio = area(p.bio, 1000), pronouns = input(p.pronouns), interests = input(p.interests.join(', '), 'gaming, music, development'), lfg = check(p.lookingForGroup), availability = select('AVAILABILITY', [['ask', 'Ask me'], ['open', 'Open to connect'], ['busy', 'Busy right now']], p.availability); pronouns.maxLength = 40;
    form({ title: 'Edit Server Profile', description: 'Choose a different introduction for this community. Interests and group availability are optional and searchable by other server members.', fields: [field('SERVER ABOUT ME', bio), field('SERVER PRONOUNS', pronouns), field('INTERESTS — COMMA SEPARATED', interests), field('Looking for a group', lfg), field('AVAILABILITY', availability)], submitLabel: 'Save Server Profile', submit: async () => { await api('/servers/' + sid + '/voices/profiles/me', 'PATCH', { revision: p.revision, bio: bio.value, pronouns: pronouns.value, interests: interests.value.split(',').map(s => s.trim()).filter(Boolean), lookingForGroup: lfg.checked, availability: availability.value }); await profile(sid, me().id); } }, { serverId: sid });
  }
  function styleEditor(sid, p) {
    const style = p.storedStyle || p.style, accent = input(style.accent, '', 'color'), start = input(style.bannerStart, '', 'color'), end = input(style.bannerEnd, '', 'color'), headline = input(style.headline), title = input(style.communityTitle), pattern = select('BANNER PATTERN', [['none', 'Smooth'], ['dots', 'Dots'], ['grid', 'Grid'], ['diagonal', 'Diagonal']], style.pattern), links = area(style.links.map(l => l.label + ' | ' + l.url).join('\n'), 8500);
    headline.maxLength = 100; title.maxLength = 40;
    const preview = node('div', 'voices-style-preview');
    const draw = () => { preview.replaceChildren(profileCard({ ...p, style: { ...style, accent: accent.value, bannerStart: start.value, bannerEnd: end.value, headline: headline.value, communityTitle: title.value, pattern: pattern.value, links: [] } }, sid, true)); };
    for (const c of [accent, start, end, headline, title, pattern]) c.addEventListener('input', draw); draw();
    form({ title: 'Style Server Profile · Plus', description: 'Six Plus options: accent, gradient banner, headline, profile links, banner pattern and a member-written community title. Titles do not grant staff status or verification.', fields: [field('PROFILE ACCENT', accent), field('BANNER START', start), field('BANNER END', end), field('SERVER HEADLINE', headline), field('COMMUNITY TITLE', title), field('BANNER PATTERN', pattern), field('PROFILE LINKS — ONE LABEL | URL PER LINE', links), preview], submitLabel: 'Save Server Profile Style', submit: async () => { const parsed = links.value.split('\n').filter(s => s.trim()).map(line => { const i = line.indexOf('|'); if (i < 1) throw Error('Use Label | https://example.com for each link.'); return { label: line.slice(0, i).trim(), url: line.slice(i + 1).trim() }; }); await api('/servers/' + sid + '/voices/profiles/me', 'PATCH', { revision: p.revision, style: { accent: accent.value, bannerStart: start.value, bannerEnd: end.value, headline: headline.value, communityTitle: title.value, pattern: pattern.value, links: parsed } }); await profile(sid, me().id); } }, { serverId: sid, plus: true });
  }
  async function board(sid, roadmap = false) {
    const s = server(sid); if (!s) return;
    const v = show(s.name + ' / ' + (roadmap ? 'Community Roadmap' : 'Suggestion Board'), 'Share ideas, discuss improvements and follow the community’s decisions.', { serverId: sid });
    v.filters = { q: '', status: 'all', category: 'all', channel: '', mine: '0', watched: '0', archived: '0', sort: 'top', offset: 0 };
    v.reload = () => load(v, '/servers/' + sid + '/voices/suggestions?' + new URLSearchParams(v.filters), data => {
      const creators = data.channels.filter(c => c.canCreate);
      v.body.append(actions(...(creators.length ? [button('New Suggestion', () => suggestionEditor(sid, data.channels), 'primary')] : []), button(roadmap ? 'Suggestion List' : 'Community Roadmap', () => board(sid, !roadmap)), button('Community Directory', () => directory(sid)), button('Community Updates', updates)));
      const query = input(v.filters.q, 'Search suggestions'), status = select('SUGGESTION STATUS', [['all', 'All statuses'], ...statuses], v.filters.status), category = select('SUGGESTION CATEGORY', [['all', 'All categories'], ...categories], v.filters.category), cid = select('SUGGESTION CHANNEL', [['', 'All accessible channels'], ...data.channels.map(c => [c.id, '#' + c.name])], v.filters.channel), sort = select('SUGGESTION SORT', [['top', 'Most votes'], ['recent', 'Newest'], ['updated', 'Recently updated']], v.filters.sort), mine = check(v.filters.mine === '1'), watched = check(v.filters.watched === '1'), archived = check(v.filters.archived === '1'); query.setAttribute('aria-label', 'Search suggestions');
      const apply = () => { v.filters = { q: query.value, status: status.value, category: category.value, channel: cid.value, sort: sort.value, mine: mine.checked ? '1' : '0', watched: watched.checked ? '1' : '0', archived: archived.checked ? '1' : '0', offset: 0 }; v.dirty = false; return v.reload(); };
      query.oninput = () => v.dirty = true; query.onkeydown = e => { if (e.key === 'Enter') apply(); };
      for (const c of [status, category, cid, sort, mine, watched, archived]) c.onchange = apply;
      v.body.append(node('div', 'voices-filters', [query, status, category, cid, sort, field('My suggestions', mine), field('Watching', watched), field('Include archived', archived), button('Search Suggestions', apply)]), node('p', 'muted', data.total + ' matching suggestion(s)' + (roadmap ? ' · Roadmap shows this page of results.' : '')));
      const list = node('div', roadmap ? 'voices-roadmap' : 'voices-suggestions');
      const row = t => { const c = card(t.title, t.description.slice(0, 200), [button('Open Suggestion', () => suggestion(sid, t.id), 'primary')]); c.prepend(node('p', 'voices-eyebrow', (t.pinned ? 'PINNED · ' : '') + t.status + ' · ' + t.votes + ' vote(s) · ' + t.commentCount + ' comment(s)')); if (t.response) c.append(node('p', 'voices-official', 'Official response: ' + t.response.slice(0, 200))); return c; };
      if (roadmap) for (const [key, label] of statuses) { const column = node('section', 'voices-roadmap-column', [node('h2', '', label)]); for (const t of data.items.filter(t => t.status === key)) column.append(row(t)); list.append(column); }
      else for (const t of data.items) list.append(row(t));
      v.body.append(list); if (!data.items.length) v.body.append(node('p', 'voices-empty', 'No matching suggestions. Start with an idea for your community.')); pagination(v, data, () => v.reload());
    }); await v.reload();
  }
  function suggestionEditor(sid, channels, t = null) {
    const title = input(t?.title || '', 'What could make this community better?'), description = area(t?.description || '', 4000), category = select('CATEGORY', categories, t?.category || 'idea'), cid = select('VISIBLE WITH CHANNEL', channels.filter(c => c.canCreate).map(c => [c.id, '#' + c.name]), t?.channelId || channels.find(c => c.id === getRoute().channel && c.canCreate)?.id || channels.find(c => c.canCreate)?.id), nonce = crypto.randomUUID(); title.maxLength = 120;
    form({ title: t ? 'Edit Suggestion' : 'New Suggestion', description: 'Suggestions follow their channel’s visibility and posting permissions. Server AutoMod also checks their text.', fields: [field('SUGGESTION TITLE', title), field('SUGGESTION DETAILS', description), field('CATEGORY', category), ...(t ? [] : [field('VISIBLE WITH CHANNEL', cid)])], submitLabel: 'Save Suggestion', submit: async () => { const result = await api('/servers/' + sid + '/voices/suggestions' + (t ? '/' + t.id : ''), t ? 'PATCH' : 'POST', { title: title.value, description: description.value, category: category.value, ...(t ? { revision: t.revision } : { channelId: cid.value, nonce }) }); await suggestion(sid, result.id); } }, { serverId: sid, ...(t ? { channelId: t.channelId } : {}) }, t ? async () => { const current = await api('/servers/' + sid + '/voices/suggestions/' + t.id); return current.canEdit && current.canParticipate; } : null);
  }
  async function suggestion(sid, id) {
    const v = show('Suggestion', 'Community discussion and roadmap progress.', { serverId: sid });
    v.reload = () => load(v, '/servers/' + sid + '/voices/suggestions/' + id, t => {
      v.scope.channelId = t.channelId; v.heading.textContent = t.title;
      v.body.append(node('p', 'voices-eyebrow', t.status + ' · ' + t.category + ' · ' + (t.archived ? 'Archived · ' : '') + (t.locked ? 'Locked · ' : '') + t.votes + ' vote(s)'), node('p', 'muted', 'By ' + t.author.name + ' · ' + when(t.createdAt)), node('p', 'voices-copy', t.description));
      const vote = button(t.voted ? 'Withdraw Vote' : 'Vote for Suggestion', async () => { await api('/servers/' + sid + '/voices/suggestions/' + id + '/vote', 'POST', { voted: !t.voted }); await suggestion(sid, id); }, t.voted ? 'secondary' : 'primary'); vote.disabled = t.voted ? !t.canVote : !t.canParticipate || ['completed', 'declined'].includes(t.status);
      v.body.append(actions(button('Back to Suggestions', () => board(sid)), vote, button(t.watching ? 'Unwatch Suggestion' : 'Watch Suggestion', async () => { await api('/servers/' + sid + '/voices/suggestions/' + id + '/watch', 'POST', { watching: !t.watching }); await suggestion(sid, id); }), ...(t.canEdit && t.canParticipate ? [button('Edit Suggestion', () => suggestionEditor(sid, [], t))] : []), ...(t.canManage ? [button('Manage Suggestion', () => moderationEditor(sid, t))] : [])));
      if (t.response) v.body.append(node('section', 'voices-official', [node('h2', '', 'Official Response'), node('p', 'voices-copy', t.response)]));
      v.body.append(node('h2', '', 'Discussion'));
      if (t.canParticipate) v.body.append(button('Add Comment', () => commentEditor(sid, t), 'primary'));
      for (const c of t.comments) {
        const controls = [];
        if (c.canEdit && t.canParticipate) controls.push(button('Edit Comment', () => commentEditor(sid, t, c)));
        if (c.canDelete) controls.push(button('Delete Comment', () => confirmDialog('Delete Comment', 'Remove this comment from the discussion?', async () => { await api('/servers/' + sid + '/voices/suggestions/' + id + '/comments/' + c.id + '?revision=' + c.revision, 'DELETE'); await suggestion(sid, id); }), 'danger'));
        v.body.append(card(c.author.name + ' · ' + when(c.createdAt) + (c.editedAt ? ' · edited' : ''), c.text, controls));
      }
      if (!t.comments.length) v.body.append(node('p', 'muted', 'No comments yet.'));
      const history = node('details', 'voices-history', [node('summary', '', 'Suggestion History')]); for (const e of [...t.history].reverse()) history.append(node('p', 'muted', e.action + ' · ' + e.actor.name + ' · ' + when(e.time))); v.body.append(history);
      if (t.canEdit) v.body.append(button('Delete Suggestion', () => confirmDialog('Delete Suggestion', 'Permanently remove this suggestion, votes and discussion?', async () => { await api('/servers/' + sid + '/voices/suggestions/' + id + '?revision=' + t.revision, 'DELETE'); await board(sid); }), 'danger'));
    }); await v.reload();
  }
  function commentEditor(sid, t, c = null) {
    const text = area(c?.text || '', 2000), nonce = crypto.randomUUID();
    form({ title: c ? 'Edit Comment' : 'Add Comment', fields: [field('COMMENT TEXT', text)], submitLabel: 'Save Comment', submit: async () => { await api('/servers/' + sid + '/voices/suggestions/' + t.id + '/comments' + (c ? '/' + c.id : ''), c ? 'PATCH' : 'POST', { text: text.value, ...(c ? { revision: c.revision } : { nonce }) }); await suggestion(sid, t.id); } }, { serverId: sid, channelId: t.channelId }, async () => (await api('/servers/' + sid + '/voices/suggestions/' + t.id)).canParticipate);
  }
  function moderationEditor(sid, t) {
    const status = select('ROADMAP STATUS', statuses, t.status), response = area(t.response, 2000), pinned = check(t.pinned), locked = check(t.locked), archived = check(t.archived);
    form({ title: 'Manage Suggestion', description: 'An official response is visible to everyone who can view this suggestion. Lock stops new discussion and votes; archiving hides it from the default board.', fields: [field('ROADMAP STATUS', status), field('OFFICIAL RESPONSE', response), field('Pin suggestion', pinned), field('Lock voting and discussion', locked), field('Archive suggestion', archived)], submitLabel: 'Save Suggestion Decision', submit: async () => { await api('/servers/' + sid + '/voices/suggestions/' + t.id + '/moderation', 'PATCH', { revision: t.revision, status: status.value, response: response.value, pinned: pinned.checked, locked: locked.checked, archived: archived.checked }); await suggestion(sid, t.id); } }, { serverId: sid, channelId: t.channelId }, async () => (await api('/servers/' + sid + '/voices/suggestions/' + t.id)).canManage);
  }
  async function updates() {
    const v = show('Community Updates', 'Private updates to suggestions you wrote or chose to watch. Votes do not generate alerts.');
    v.reload = () => load(v, '/me/community-updates', data => {
      v.body.append(actions(button('Mark Community Updates Read', async () => { await api('/me/community-updates', 'POST', { revision: data.revision }); await refreshState(); await updates(); }), button('All Communities', home)));
      for (const item of data.items) v.body.append(card((item.read ? '' : 'NEW · ') + item.title, item.action + ' · ' + item.status + ' · ' + when(item.time), [button('Open Suggestion', () => suggestion(item.serverId, item.suggestionId))]));
      if (!data.items.length) v.body.append(node('p', 'voices-empty', 'Watch a suggestion to follow its discussion and progress.'));
    }); await v.reload();
  }
  async function refresh() {
    if (editor?.element.isConnected && dialog().open) {
      const current = editor;
      if (current.account !== me()?.id || !allowed(current.scope)) { reset(); return; }
      if (current.validate) { try { if (!await current.validate() && editor === current) reset(); } catch { if (editor === current) reset(); } } return;
    }
    if (!active?.root.isConnected || !dialog().open) return;
    if (!live(active)) { reset(); return; }
    const v = active; clearTimeout(timer); if (v.dirty) return;
    timer = setTimeout(() => { if (live(v) && !v.dirty) v.reload?.(); }, 150);
  }
  function reset() { clearTimeout(timer); if (active?.root.isConnected || editor?.element.isConnected) { dialog().close(); document.getElementById('modal-content').replaceChildren(); } active = editor = null; }
  function renderHome(main) {
    main.prepend(node('section', 'hub-section voices-home', [node('p', 'voices-eyebrow', 'COMMUNITY VOICES'), node('h2', '', 'Your next good idea starts here.'), node('p', 'muted', (getState().voices?.unread || 0) + ' unread community update(s)'), actions(button('Open Community Voices', home, 'primary'), button('Community Updates', updates))]));
  }
  return { home, directory, profile, board, updates, refresh, reset, renderHome };
}
