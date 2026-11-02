const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { FEED_URL, compareVersions, validateFeed } = require('./update-feed.cjs');
const { downloadResponse } = require('./update-download.cjs');
const DEFAULT_TIMERS = { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: timer => clearTimeout(timer) };

async function verifyInstaller(filename, release) {
  const info = await fs.stat(filename);
  if (!info.isFile() || info.size !== release.size) throw Error('The update size did not match. Download it again.');
  const hash = createHash('sha256'); let first = true;
  for await (const chunk of createReadStream(filename)) {
    if (first && (chunk[0] !== 77 || chunk[1] !== 90)) throw Error('The download is not a Windows installer.');
    first = false; hash.update(chunk);
  }
  if (hash.digest('hex') !== release.sha256) throw Error('The update checksum did not match. Download it again.');
}
class DesktopUpdater extends EventEmitter {
  constructor({ version, directory, supported, fetch: fetcher = globalThis.fetch, launchInstaller, quit, timers = DEFAULT_TIMERS }) {
    super(); Object.assign(this, { version, directory, supported, fetcher, launchInstaller, quit, timers });
    this.preferences = { autoDownload: true }; this.phase = supported ? 'idle' : 'unsupported'; this.progress = 0; this.lastChecked = null; this.error = null; this.release = null; this.downloaded = null;
    this.nextCheck = null; this.failures = 0; this.downloadSource = null;
  }
  snapshot() {
    return { currentVersion: this.version, supported: this.supported, phase: this.phase, progress: this.progress, autoDownload: this.preferences.autoDownload, lastChecked: this.lastChecked, nextCheck: this.nextCheck, downloadSource: this.downloadSource, error: this.error, availableVersion: this.release?.version || null, notes: this.release?.notes || '' };
  }
  publish(patch = {}) {
    Object.assign(this, patch); const snapshot = this.snapshot(); this.emit('change', snapshot);
    const signature = JSON.stringify([this.phase,this.error,this.release?.version,this.downloadSource]);
    if (signature !== this.logSignature) {
      this.logSignature = signature;
      const event = { time: new Date().toISOString(), version: this.version, phase: this.phase, availableVersion: this.release?.version || null, source: this.downloadSource, error: this.error?.replaceAll(this.directory,'<updates folder>').slice(0,1000) || null };
      this.logging = (this.logging || Promise.resolve()).catch(()=>{}).then(async()=>{
        await fs.mkdir(this.directory,{recursive:true}); const filename=path.join(this.directory,'update-events.jsonl');
        if ((await fs.stat(filename).catch(()=>null))?.size > 65536) await fs.writeFile(filename,'',{mode:0o600});
        await fs.appendFile(filename,JSON.stringify(event)+'\n',{mode:0o600});
      }).catch(()=>{});
    }
    return snapshot;
  }
  async diagnostics() {
    await this.logging;
    const events=(await fs.readFile(path.join(this.directory,'update-events.jsonl'),'utf8').catch(()=>'')).trim().split('\n').slice(-40).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    return JSON.stringify({ ...this.snapshot(), error: this.error?.replaceAll(this.directory,'<updates folder>') || null, feed: FEED_URL, events },null,2);
  }
  target(release) { return path.join(this.directory, `Voxora-Setup-${release.version}.exe`); }
  readyToInstall() {
    return !!(this.supported && this.downloaded && this.release && compareVersions(this.release.version, this.version) > 0 && ['ready', 'checking'].includes(this.phase) && !this.installing);
  }
  pauseChecks() {
    this.timers.clear(this.timer); this.timer = null; this.nextCheck = null;
  }
  async cleanupCache() {
    for (const name of await fs.readdir(this.directory).catch(() => [])) {
      if (!/^Voxora-Setup-\d+\.\d+\.\d+\.exe(?:\.[a-f0-9-]{36}\.part)?$/.test(name)) continue;
      const file = path.join(this.directory, name); if (file !== this.downloaded) await fs.unlink(file).catch(() => {});
    }
  }
  async writeJSON(name, value) {
    await fs.mkdir(this.directory, { recursive: true }); const temp = path.join(this.directory, name + '.' + randomUUID() + '.tmp');
    try { await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temp, path.join(this.directory, name)); }
    finally { await fs.unlink(temp).catch(() => {}); }
  }
  async initialize() {
    try { const prefs = JSON.parse(await fs.readFile(path.join(this.directory, 'settings.json'), 'utf8')); if (typeof prefs.autoDownload === 'boolean') this.preferences.autoDownload = prefs.autoDownload; } catch {}
    if (!this.supported) return this.snapshot();
    try {
      const release = validateFeed(JSON.parse(await fs.readFile(path.join(this.directory, 'pending.json'), 'utf8')));
      if (compareVersions(release.version, this.version) > 0) {
        await verifyInstaller(this.target(release), release); this.release = release; this.downloaded = this.target(release); this.phase = 'ready'; this.progress = 100;
      } else {
        await fs.unlink(this.target(release)).catch(() => {}); await fs.unlink(path.join(this.directory, 'pending.json')).catch(() => {});
      }
    } catch { await fs.unlink(path.join(this.directory, 'pending.json')).catch(() => {}); }
    try {
      const result = JSON.parse((await fs.readFile(path.join(this.directory, 'install-result.json'), 'utf8')).replace(/^\uFEFF/, ''));
      if (result.success === false || compareVersions(result.version, this.version) > 0) {
        this.error = 'The last update did not finish. ' + String(result.message || '').slice(0, 500) + ' Retry from Updates or run the latest installer manually. Logs: ' + this.directory;
        this.recoveryMessage = this.error;
        await fs.unlink(path.join(this.directory, 'install-result.json')).catch(() => {});
      }
      else await fs.unlink(path.join(this.directory, 'install-result.json')).catch(() => {});
    } catch {}
    await this.cleanupCache(); return this.snapshot();
  }
  async settings(value) {
    if (!value || typeof value.autoDownload !== 'boolean' || Object.keys(value).some(k => k !== 'autoDownload')) throw Error('Invalid update preference.');
    this.preferences.autoDownload = value.autoDownload;
    this.preferenceWrite = (this.preferenceWrite || Promise.resolve()).catch(() => {}).then(() => this.writeJSON('settings.json', this.preferences));
    await this.preferenceWrite; this.publish();
    if (this.preferences.autoDownload && this.phase === 'available') this.download().catch(() => {});
    return this.snapshot();
  }
  async readFeed(signal) {
    const url = new URL(FEED_URL); url.searchParams.set('check',String(this.timers.now()));
    const response = await this.fetcher(url.href, { signal, redirect: 'error', cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    if (!response.ok) throw Error(response.status === 404 ? 'No desktop update has been published yet.' : 'The update service is unavailable. Try again later.');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 32768) throw Error('The update feed is too large.'); chunks.push(chunk); }
    return validateFeed(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }
  check({ force = false } = {}) {
    if (!this.supported || this.confirming || this.installing || ['downloading', 'installing'].includes(this.phase)) return Promise.resolve(this.snapshot());
    if (this.checking) return this.checking;
    if (!force && this.lastAttempt && this.timers.now() - this.lastAttempt < 5000) {
      this.queue(5000 - (this.timers.now() - this.lastAttempt)); return Promise.resolve(this.snapshot());
    }
    this.timers.clear(this.timer); this.nextCheck = null;
    this.lastAttempt = this.timers.now(); this.controller = new AbortController();
    this.checking = (async () => {
      // A feed refresh does not invalidate an already verified installer.
      this.publish({ phase: this.downloaded ? 'ready' : 'checking', error: null });
      try {
        const release = await this.readFeed(AbortSignal.any([this.controller.signal, AbortSignal.timeout(15000)]));
        if (this.stopped || this.confirming || this.installing || this.phase === 'installing') return this.snapshot();
        this.lastChecked = this.timers.now();
        if (compareVersions(release.version, this.version) <= 0) return this.publish({ phase: this.downloaded ? 'ready' : 'idle' });
        if (this.downloaded && compareVersions(this.release.version, release.version) >= 0) return this.publish({ phase: 'ready' });
        this.publish({ release, downloaded: null, phase: 'available', progress: 0 });
        if (this.preferences.autoDownload) return await this.download();
        return this.snapshot();
      } catch (error) {
        if (!this.stopped && !this.confirming && !this.installing && this.phase !== 'installing') this.publish({ phase: this.downloaded ? 'ready' : this.release ? 'available' : 'error', error: error.message });
        return this.snapshot();
      } finally { this.checking = null; this.schedule(); }
    })(); return this.checking;
  }
  download() {
    if (this.downloading) return this.downloading;
    if (!['available', 'ready'].includes(this.phase)) return Promise.reject(Error('Wait for the current update operation to finish.'));
    if (!this.supported || !this.release || compareVersions(this.release.version, this.version) <= 0) return Promise.reject(Error('Check for an available update first.'));
    if (this.downloaded) return Promise.resolve(this.snapshot());
    const release = this.release; this.controller = new AbortController();
    this.downloading = (async () => {
      const temp = this.target(release) + '.' + randomUUID() + '.part'; let file;
      this.publish({ phase: 'downloading', progress: 0, error: null });
      try {
        await fs.mkdir(this.directory, { recursive: true });
        const result = await downloadResponse(this.fetcher, release, AbortSignal.any([this.controller.signal, AbortSignal.timeout(15 * 60 * 1000)]));
        const response = result.response; this.publish({ downloadSource: result.source });
        if (!response.ok || !response.body) throw Error('The installer download failed. Try again later.');
        const length = response.headers.get('content-length'); if (length && Number(length) !== release.size) { await response.body.cancel(); throw Error('The download size did not match this release.'); }
        file = await fs.open(temp, 'wx', 0o600); let size = 0, lastProgress = 0;
        for await (const chunk of response.body) {
          size += chunk.length; if (size > release.size) throw Error('The installer exceeded its expected size.');
          await file.writeFile(chunk);
          if (Date.now() - lastProgress > 250) { this.publish({ progress: Math.min(99, Math.floor(size / release.size * 100)) }); lastProgress = Date.now(); }
        }
        await file.sync(); await file.close(); file = null; await verifyInstaller(temp, release);
        await fs.rename(temp, this.target(release)); await this.writeJSON('pending.json', release);
        this.downloaded = this.target(release); await this.cleanupCache();
        return this.publish({ phase: 'ready', progress: 100 });
      } catch (error) {
        if (!this.stopped) this.publish({ phase: 'available', error: error.message }); throw error;
      } finally { await file?.close().catch(() => {}); await fs.unlink(temp).catch(() => {}); this.downloading = null; if(!this.checking)this.schedule(); }
    })(); return this.downloading;
  }
  confirmInstall(ask) {
    if (this.confirmation) return this.confirmation;
    if (!this.readyToInstall()) return Promise.resolve(this.snapshot());
    const release = { ...this.release };
    this.confirming = true; this.pauseChecks();
    // Defer notifications until the shared promise exists, so a second
    // Settings/menu/focus request joins this confirmation instead of nesting it.
    this.confirmation = Promise.resolve().then(async () => {
      this.publish({ phase: 'ready' });
      if (await ask(release)) await this.install(release);
      return this.snapshot();
    }).finally(() => {
      this.confirming = false; this.confirmation = null; this.schedule();
    });
    return this.confirmation;
  }
  install(expectedRelease) {
    if (this.installation) return this.installation;
    if (!this.readyToInstall()) return Promise.reject(Error('The update is not ready. Download it from Updates, then choose Restart and Install.'));
    const release = { ...this.release }, installer = this.downloaded;
    if (expectedRelease && ['version', 'sha256', 'size', 'url'].some(key => expectedRelease[key] !== release[key])) return Promise.reject(Error('The available update changed. Review it in Updates before restarting.'));
    this.installing = true; this.pauseChecks();
    this.installation = Promise.resolve().then(async () => {
      this.publish({ phase: 'installing', error: null });
      try { await verifyInstaller(installer, release); }
      catch (error) {
        this.downloaded = null;
        await fs.unlink(path.join(this.directory, 'pending.json')).catch(() => {});
        await fs.unlink(installer).catch(() => {}); throw error;
      }
      await this.launchInstaller({ installer, directory: this.directory, version: release.version, sha256: release.sha256, size: release.size });
      this.quit(); return this.snapshot();
    }).catch(error => { this.publish({ phase: this.downloaded ? 'ready' : 'available', error: error.message }); throw error; })
      .finally(() => { this.installing = false; this.installation = null; this.schedule(); });
    return this.installation;
  }
  start() {
    if (this.started || !this.supported) return;
    this.started = true; this.stopped = false; this.queue(2000);
  }
  queue(delay) {
    this.timers.clear(this.timer);
    if (!this.started || this.stopped || this.confirming || this.installing || this.phase === 'installing') { this.nextCheck = null; return; }
    this.nextCheck = this.timers.now() + delay;
    this.timer = this.timers.set(() => { this.timer = null; return this.check(); },delay); this.timer?.unref?.(); this.publish();
  }
  schedule() {
    if (this.confirming || this.installing || this.phase === 'installing') return;
    this.failures = this.error ? this.failures + 1 : 0;
    this.queue(this.failures ? Math.min(15000 * 2 ** Math.min(5,this.failures-1),300000) : 60000);
  }
  wake() { return this.started && !this.stopped ? this.check() : Promise.resolve(this.snapshot()); }
  stop() { this.started = false; this.stopped = true; this.nextCheck = null; this.timers.clear(this.timer); this.controller?.abort(); }
}
module.exports = { DesktopUpdater, verifyInstaller };
