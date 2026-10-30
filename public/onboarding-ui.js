export function createOnboardingUI({ node, button, input, field, modal, api, getState, getRoute, navigate, refreshState, toast }) {
  let current, timer; const seen = new Set();
  const area = (value, max) => { const control = node('textarea'); control.value = value || ''; control.maxLength = max; control.rows = 4; return control; };
  const checkbox = (label, checked) => { const control = input('', '', 'checkbox'); control.checked = checked; control.setAttribute('aria-label', label); return control; };
  const choices = (items, selected, prefix) => items.map(item => {
    const check = checkbox(prefix + item.name, selected.includes(item.id));
    return { id: item.id, check, row: node('label', 'onboarding-choice', [check, node('span', '', item.name)]) };
  });
  async function manager(server, content) {
    const data = await api('/servers/' + server.id + '/onboarding/settings'); if (!content.isConnected) return;
    content.append(node('p', 'management-help', 'Welcome members, share server rules, and offer optional roles. Rules apply to people who join after acceptance is enabled; existing members keep their access.'));
    if (data.canManageGuide) {
      const enabled = checkbox('Show welcome guide to new members', data.enabled), required = checkbox('Require new members to accept rules', data.requireRules);
      const title = input(data.title, 'Welcome to ' + server.name), description = area(data.description, 1000), rules = area(data.rules.join('\n'), 4100); title.maxLength = 80;
      const channels = choices(data.channels, data.channelIds, 'Recommend '), form = node('form', 'onboarding-settings'), error = node('p', 'form-error'), submit = button('Save Welcome Guide', () => {}, 'primary'); submit.type = 'submit';
      form.append(field('Show welcome guide to new members', enabled), field('WELCOME TITLE', title), field('WELCOME DESCRIPTION', description), field('SERVER RULES (ONE PER LINE, UP TO 10)', rules), field('Require new members to accept rules', required), node('h3', '', 'Recommended Channels'), node('p', 'muted', 'Choose up to five. Members only see channels they can access.'), ...channels.map(c => c.row), error, submit); content.append(form);
      form.onsubmit = async event => {
        event.preventDefault(); submit.disabled = true; error.textContent = '';
        try { await api('/servers/' + server.id + '/onboarding/settings', 'PATCH', { enabled: enabled.checked, title: title.value, description: description.value, rules: rules.value.split('\n').map(r => r.trim()).filter(Boolean), requireRules: required.checked, channels: channels.filter(c => c.check.checked).map(c => c.id) }); await refreshState(); toast('Welcome guide saved.'); }
        catch (e) { error.textContent = e.message; } finally { submit.disabled = false; }
      };
    }
    if (data.canManageRoles) {
      const roles = choices(data.candidateRoles, data.roleIds, 'Offer '), form = node('form', 'onboarding-settings'), error = node('p', 'form-error'), submit = button('Save Optional Roles', () => {}, 'primary'); submit.type = 'submit';
      form.append(node('h3', '', 'Roles Members Can Choose'), node('p', 'muted', 'Offer up to 12 interest, color, or channel-access roles. Staff permissions are excluded. Self-selected roles never increase moderation rank. Removing an option withdraws its self-granted assignments; manually assigned roles stay.'), ...roles.map(r => r.row));
      if (!roles.length) form.append(node('p', 'muted', 'Create a role without staff permissions in Server Settings → Roles first.'));
      form.append(error, submit); content.append(form);
      form.onsubmit = async event => { event.preventDefault(); submit.disabled = true; error.textContent = ''; try { await api('/servers/' + server.id + '/onboarding/settings', 'PATCH', { roleIds: roles.filter(r => r.check.checked).map(r => r.id) }); await refreshState(); toast('Optional roles saved.'); } catch (e) { error.textContent = e.message; } finally { submit.disabled = false; } };
    }
  }
  async function open(server) {
    seen.add(getState().me.id + ':' + server.id);
    const root = node('section', 'onboarding-guide'), heading = node('h2'), description = node('p'), rules = node('ol', 'onboarding-rules'), channels = node('div', 'onboarding-channels'), roles = node('div', 'onboarding-roles'), status = node('p', 'muted'), error = node('p', 'form-error'), form = node('form');
    const accept = checkbox('I have read and accept the server rules', false), acceptance = node('label', 'onboarding-choice', [accept, node('span', '', 'I have read and accept the server rules')]);
    const submit = button('Finish Setup', () => {}, 'primary'); submit.type = 'submit';
    form.append(acceptance, error, submit); root.append(node('p', 'community-eyebrow', 'SERVER GUIDE'), heading, description, status, rules, node('h3', '', 'Start Here'), channels, node('h3', '', 'Choose Your Roles'), roles, form);
    modal([root], 'onboarding-dialog');
    const view = current = { root, serverId: server.id, version: 0, data: null, choices: [], dirty: false, load: null };
    view.load = async () => {
      const request = ++view.version;
      try {
        const data = await api('/servers/' + view.serverId + '/onboarding'); if (current !== view || !root.isConnected || request !== view.version) return;
        const selected = view.dirty ? view.choices.filter(r => r.check.checked).map(r => r.id) : data.roles.filter(r => r.selected).map(r => r.id);
        if (view.data && view.data.rulesVersion !== data.rulesVersion) { accept.checked = false; error.textContent = 'The server rules changed. Read them again before continuing.'; }
        view.data = data; heading.textContent = data.title; description.textContent = data.description;
        status.textContent = data.pendingRules ? 'Accept the rules to send messages, react, upload files, and join calls in this server.' : 'Pick the channels and community roles that interest you.';
        rules.replaceChildren(...data.rules.map(text => node('li', '', text))); if (!data.rules.length) rules.append(node('li', 'muted', 'No server rules have been added yet.'));
        channels.replaceChildren();
        for (const channel of data.channels) channels.append(button((channel.type === 'voice' ? 'Voice · ' : '#') + channel.name, async () => { document.getElementById('modal').close(); await navigate({ kind: channel.type === 'voice' ? 'voice' : 'channel', server: data.serverId, channel: channel.id }); }, 'onboarding-channel'));
        if (!data.channels.length) channels.append(node('p', 'muted', 'No recommended channels are available to you yet.'));
        roles.replaceChildren(); view.choices = choices(data.roles, selected, 'Choose ');
        for (const option of view.choices) {
          const item = data.roles.find(r => r.id === option.id); option.check.disabled = item.locked || !data.canChooseRoles;
          if (item.locked) { option.check.checked = true; option.row.append(node('small', 'muted', 'Assigned by staff')); }
          option.check.onchange = () => { view.dirty = true; }; roles.append(option.row);
        }
        if (!data.roles.length) roles.append(node('p', 'muted', 'No optional roles are offered right now.'));
        acceptance.hidden = !data.pendingRules; accept.required = data.pendingRules;
      } catch (e) { if (current === view && request === view.version) { root.replaceChildren(node('h2', '', 'Server Guide Unavailable'), node('p', 'form-error', e.message)); view.data = null; } }
    };
    form.onsubmit = async event => {
      event.preventDefault(); if (!view.data) return; submit.disabled = true; error.textContent = '';
      try {
        await api('/servers/' + server.id + '/onboarding/complete', 'POST', { acceptRules: accept.checked, rulesVersion: view.data.rulesVersion, ...(view.data.canChooseRoles ? { roleIds: view.choices.filter(r => r.check.checked).map(r => r.id) } : {}) });
        await refreshState(); document.getElementById('modal').close();
        if (getRoute().server !== server.id) { const joined = getState().servers.find(s => s.id === server.id), channel = joined?.channels.find(c => c.type === 'text') || joined?.channels[0]; if (channel) await navigate({ kind: channel.type === 'voice' ? 'voice' : 'channel', server: server.id, channel: channel.id }); }
        toast('Server setup complete. Your choices are saved.');
      } catch (e) { error.textContent = e.message; if (e.status === 409 || e.status === 403) await view.load(); } finally { submit.disabled = false; }
    };
    await view.load();
  }
  function maybeShow(server = getState()?.servers.find(s => s.id === getRoute().server)) {
    if (!server?.onboarding?.needsGuide || seen.has(getState().me.id + ':' + server.id) || document.getElementById('modal').open) return;
    open(server).catch(e => toast(e.message, true));
  }
  function refresh() {
    clearTimeout(timer); timer = setTimeout(() => { if (current?.root.isConnected) current.load(); else maybeShow(); }, 120);
  }
  document.getElementById('modal').addEventListener('close', () => setTimeout(() => maybeShow(), 0));
  return { manager, open, maybeShow, refresh };
}
