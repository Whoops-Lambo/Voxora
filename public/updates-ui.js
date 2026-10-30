export function renderUpdates({ content, node, button, field, toast, desktop = window.voxoraDesktop }) {
  content.append(node('p', '', 'Keep Voxora up to date. Updates preserve your accounts, messages, bots, and settings.'));
  if (!desktop?.getUpdateState) {
    content.append(node('p', 'muted', 'Automatic updates are available in the Windows desktop app. Browser users receive changes when their shared backend is upgraded.'));
    const link = node('a', 'primary', 'Download the Windows App'); link.href = '/'; content.append(link); return;
  }
  const status = node('p', 'connection-tag'), details = node('p', 'muted'), notes = node('pre', 'update-notes'), progress = node('progress'), actions = node('div', 'thread-actions'), error = node('p', 'form-error');
  progress.max = 100; progress.setAttribute('aria-label', 'Update download progress');
  const automatic = node('input'); automatic.type = 'checkbox'; automatic.setAttribute('aria-label', 'Download updates automatically');
  const run = async (action) => { try { draw(await action()); } catch (e) { toast(e.message, true); } };
  const check = button('Check for Updates', () => run(() => desktop.checkForUpdates())), download = button('Download Update', () => run(() => desktop.downloadUpdate()), 'primary'), install = button('Restart and Install', () => run(() => desktop.installUpdate()), 'primary');
  actions.append(check, download, install); content.append(status, details, progress, notes, error, field('AUTOMATIC DOWNLOADS', automatic), actions);
  automatic.onchange = () => run(() => desktop.setUpdateSettings({ autoDownload: automatic.checked }));
  function draw(state) {
    if (!content.isConnected) return;
    const labels = { idle: 'Up to date', checking: 'Checking for updates…', available: 'Update available', downloading: `Downloading update… ${state.progress}%`, ready: 'Update ready to install', installing: 'Restarting to install…', unsupported: 'Automatic updates require the installed Windows app' };
    status.textContent = `Voxora ${state.currentVersion} · ${state.phase === 'idle' && !state.lastChecked ? 'Ready to check for updates' : labels[state.phase] || state.phase}`;
    details.textContent = state.availableVersion ? `Version ${state.availableVersion} is available. Restart when you are ready; active calls will disconnect.` : state.lastChecked ? 'Last checked ' + new Date(state.lastChecked).toLocaleString() : 'Voxora checks on startup and every 15 minutes while open.';
    notes.textContent = state.notes || ''; notes.hidden = !state.notes; notes.style.whiteSpace = 'pre-wrap';
    progress.value = state.progress; progress.hidden = state.phase !== 'downloading'; error.textContent = state.error || '';
    automatic.checked = state.autoDownload; automatic.disabled = !state.supported;
    check.disabled = !state.supported || ['checking', 'downloading', 'installing'].includes(state.phase);
    download.hidden = state.phase !== 'available'; install.hidden = state.phase !== 'ready';
  }
  let unsubscribe = desktop.onUpdate(draw);
  const observer = new MutationObserver(() => { if (!content.isConnected) { unsubscribe?.(); unsubscribe = null; observer.disconnect(); } });
  observer.observe(document.getElementById('modal-content'), { childList: true, subtree: true });
  desktop.getUpdateState().then(draw).catch(e => toast(e.message, true));
}
