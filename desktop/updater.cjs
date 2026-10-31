const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { FEED_URL, compareVersions, artifactCommit, validateFeed } = require('./update-feed.cjs');

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
  constructor({ version, directory, supported, fetch: fetcher = globalThis.fetch, launchInstaller, quit }) {
    super(); Object.assign(this, { version, directory, supported, fetcher, launchInstaller, quit });
    this.preferences = { autoDownload: true }; this.phase = supported ? 'idle' : 'unsupported'; this.progress = 0; this.lastChecked = null; this.error = null; this.release = null; this.downloaded = null;
  }
  snapshot() {
    return { currentVersion: this.version, supported: this.supported, phase: this.phase, progress: this.progress, autoDownload: this.preferences.autoDownload, lastChecked: this.lastChecked, error: this.error, availableVersion: this.release?.version || null, notes: this.release?.notes || '' };
  }
  publish(patch = {}) { Object.assign(this, patch); this.emit('change', this.snapshot()); return this.snapshot(); }
  target(release) { return path.join(this.directory, `Voxora-Setup-${release.version}.exe`); }
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
    const response = await this.fetcher(FEED_URL, { signal, redirect: 'error', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    if (!response.ok) throw Error(response.status === 404 ? 'No desktop update has been published yet.' : 'The update service is unavailable. Try again later.');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 32768) throw Error('The update feed is too large.'); chunks.push(chunk); }
    return validateFeed(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }
  check() {
    if (!this.supported || ['downloading', 'installing'].includes(this.phase)) return Promise.resolve(this.snapshot());
    if (this.checking) return this.checking;
    if (this.lastAttempt && Date.now() - this.lastAttempt < 5000) return Promise.resolve(this.snapshot());
    this.lastAttempt = Date.now(); this.controller = new AbortController();
    this.checking = (async () => {
      const previous = this.phase; this.publish({ phase: 'checking', error: null });
      try {
        const release = await this.readFeed(AbortSignal.any([this.controller.signal, AbortSignal.timeout(15000)]));
        this.lastChecked = Date.now();
        if (compareVersions(release.version, this.version) <= 0) return this.publish({ phase: this.downloaded ? 'ready' : 'idle' });
        if (this.downloaded && compareVersions(this.release.version, release.version) >= 0) return this.publish({ phase: 'ready' });
        this.publish({ release, downloaded: null, phase: 'available', progress: 0 });
        if (this.preferences.autoDownload) return await this.download();
        return this.snapshot();
      } catch (error) {
        if (!this.stopped) this.publish({ phase: this.downloaded ? 'ready' : this.release ? 'available' : 'error', error: error.message });
        return this.snapshot();
      } finally { this.checking = null; }
    })(); return this.checking;
  }
  async fetchInstaller(release, signal) {
    let url = release.url;
    for (let count = 0; count < 5; count++) {
      const response = await this.fetcher(url, { signal, redirect: 'manual', headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const next = new URL(response.headers.get('location') || '', url).href; await response.body?.cancel();
      if (artifactCommit(next, release.version) !== artifactCommit(release.url, release.version)) throw Error('The update redirected to a different release.'); url = next;
    }
    throw Error('Too many update redirects.');
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
        const response = await this.fetchInstaller(release, AbortSignal.any([this.controller.signal, AbortSignal.timeout(15 * 60 * 1000)]));
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
      } finally { await file?.close().catch(() => {}); await fs.unlink(temp).catch(() => {}); this.downloading = null; }
    })(); return this.downloading;
  }
  async install() {
    if (this.phase !== 'ready' || !this.downloaded || this.installing) throw Error('Download and verify an update before installing.');
    this.installing = true;
    try {
      try { await verifyInstaller(this.downloaded, this.release); }
      catch (error) { this.downloaded = null; await fs.unlink(path.join(this.directory, 'pending.json')).catch(() => {}); throw error; }
      this.publish({ phase: 'installing', error: null });
      await this.launchInstaller({ installer: this.downloaded, directory: this.directory, version: this.release.version, sha256: this.release.sha256, size: this.release.size });
      this.quit(); return this.snapshot();
    } catch (error) { this.publish({ phase: this.downloaded ? 'ready' : 'available', error: error.message }); throw error; }
    finally { this.installing = false; }
  }
  start() {
    this.timer = setTimeout(() => this.check(), 15000); this.timer.unref?.();
    this.interval = setInterval(() => this.check(), 15 * 60 * 1000); this.interval.unref?.();
  }
  stop() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.interval); this.controller?.abort(); }
}
module.exports = { DesktopUpdater, verifyInstaller };
