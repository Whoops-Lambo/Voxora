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
  if(desktop.copyUpdateDiagnostics)actions.append(button('Copy Update Diagnostics',()=>run(async()=>{await desktop.copyUpdateDiagnostics();toast('Update diagnostics copied.');return await desktop.getUpdateState();})));
  automatic.onchange = () => run(() => desktop.setUpdateSettings({ autoDownload: automatic.checked }));
  function draw(state) {
    if (!content.isConnected) return;
    const labels = { idle: 'Up to date', error: 'Update check failed — retry scheduled', checking: 'Checking for updates…', available: 'Update available', downloading: `Downloading update… ${state.progress}%`, ready: 'Update ready to install', installing: 'Restarting to install…', unsupported: 'Automatic updates require the installed Windows app' };
    status.textContent = `Voxora ${state.currentVersion} · ${state.phase === 'idle' && !state.lastChecked ? 'Ready to check for updates' : labels[state.phase] || state.phase}`;
    details.textContent = state.availableVersion ? `Version ${state.availableVersion} is available. Restart when you are ready; active calls will disconnect.` : state.lastChecked ? 'Last checked ' + new Date(state.lastChecked).toLocaleString() : 'Voxora checks on startup, every minute, and after waking or reconnecting.';
    if(state.nextCheck)details.textContent+=' Next automatic check: '+new Date(state.nextCheck).toLocaleTimeString()+'.';
    if(state.downloadSource==='github-lfs')details.textContent+=' Downloading through GitHub file storage.';
    notes.textContent = state.notes || ''; notes.hidden = !state.notes; notes.style.whiteSpace = 'pre-wrap';
    progress.value = state.progress; progress.hidden = state.phase !== 'downloading'; error.textContent = state.error || '';
    automatic.checked = state.autoDownload; automatic.disabled = !state.supported;
    check.disabled = !state.supported || ['checking', 'downloading', 'installing'].includes(state.phase);
    download.hidden = state.phase !== 'available'; install.hidden = state.phase !== 'ready';
  }
  let unsubscribe = desktop.onUpdate(draw);
  const online=()=>desktop.checkForUpdates().catch(()=>{});
  const observer = new MutationObserver(() => { if (!content.isConnected) { unsubscribe?.(); unsubscribe = null; observer.disconnect(); window.removeEventListener('online',online); } });
  observer.observe(document.getElementById('modal-content') || document.body, { childList: true, subtree: true });
  desktop.getUpdateState().then(draw).catch(e => toast(e.message, true));
  window.addEventListener('online',online);
}

export function mountUpdateNotice({node,button,desktop=window.voxoraDesktop}) {
  if(!desktop?.getUpdateState)return;
  const root=node('aside','desktop-update-notice'),status=node('strong'),details=node('p'),actions=node('div','thread-actions');
  root.setAttribute('aria-label','Voxora app update');root.setAttribute('aria-live','polite');root.hidden=true;root.append(status,details,actions);document.body.append(root);
  let dismissed;
  const run=fn=>async()=>{try{draw(await fn());}catch(error){details.textContent=error.message;}};
  function draw(state){
    const signature=[state.phase,state.availableVersion,state.error].join(':');
    root.hidden=!state.supported||!['available','downloading','ready'].includes(state.phase)&&!state.error||dismissed===signature;
    if(root.hidden)return;
    status.textContent=state.phase==='ready'?'Voxora '+state.availableVersion+' is ready':state.phase==='downloading'?'Updating Voxora · '+state.progress+'%':state.error?'Voxora update needs attention':'Voxora '+state.availableVersion+' is available';
    details.textContent=state.error|| (state.phase==='ready'?'Restart when you’re ready to install.':state.phase==='downloading'?'Downloading and verifying your update.':'Download the latest version to get new features and fixes.');
    actions.replaceChildren();
    if(state.phase==='ready')actions.append(button('Restart Voxora',run(()=>desktop.installUpdate()),'primary'));
    else if(state.phase==='available')actions.append(button('Download Voxora Update',run(()=>desktop.downloadUpdate()),'primary'));
    else if(state.error)actions.append(button('Retry Update',run(()=>desktop.checkForUpdates()),'primary'));
    actions.append(button('Dismiss Update Notice',()=>{dismissed=signature;root.hidden=true;},'secondary'));
  }
  desktop.onUpdate(draw);desktop.getUpdateState().then(draw).catch(()=>{});
  window.addEventListener('online',()=>desktop.checkForUpdates().catch(()=>{}));
}
