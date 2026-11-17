// Use the updater inside an already published Windows app against the real
// stable feed. Network responses and downloaded installer bytes are not fixtures.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import path from 'node:path';
import {evaluateDesktop} from './test-desktop-page.mjs';

if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw Error('Isolated Windows CI only.');
const [previousVersion] = process.argv.slice(2);
assert.match(previousVersion || '', /^\d+\.\d+\.\d+$/);
const expected = JSON.parse(await readFile('updates/stable.json', 'utf8'));
const installer = path.resolve(`installers/Voxora-Setup-${previousVersion}.exe`);
const manifest = await readFile('installers/SHA256SUMS.txt', 'utf8');
const digest = createHash('sha256').update(await readFile(installer)).digest('hex');
assert.ok(manifest.split(/\r?\n/).includes(`${digest}  Voxora-Setup-${previousVersion}.exe`), 'Published old installer checksum mismatch.');
const profile = path.join(process.env.APPDATA, 'Voxora', 'updates');
await assert.rejects(readFile(path.join(profile, 'settings.json')), {code: 'ENOENT'});
await mkdir(profile, {recursive: true});
await writeFile(path.join(profile, 'settings.json'), JSON.stringify({autoDownload: false}));
const target = await mkdtemp(path.join(process.env.RUNNER_TEMP, 'voxora-live-update-'));
await new Promise((resolve, reject) => {
  const install = spawn(installer, ['/S', '/D=' + target], {stdio: 'inherit'});
  install.once('error', reject);
  install.once('exit', code => code === 0 ? resolve() : reject(Error('Installation exited ' + code)));
});
const port = 44000 + Math.floor(Math.random() * 1000);
const app = spawn(path.join(target, 'Voxora.exe'), ['--disable-gpu', '--voxora-connection-setup', '--remote-debugging-port=' + port], {stdio: 'ignore'});
let state;
try {
  state = await evaluateDesktop(port, `(async()=>{
    for(let n=0;n<100&&!window.voxoraDesktop?.getUpdateState;n++)await new Promise(r=>setTimeout(r,100));
    return window.voxoraDesktop.getUpdateState();
  })()`);
  assert.equal(state.currentVersion, previousVersion);
  assert.equal(state.supported, true);
  // Start the production IPC request without holding the debugger's short
  // response timeout while GitHub serves the real installer.
  await evaluateDesktop(port, 'window.voxoraDesktop.checkForUpdates().catch(()=>{}); true');
  for (let n = 0; n < 60; n++) {
    state = await evaluateDesktop(port, 'window.voxoraDesktop.getUpdateState()');
    if (state.availableVersion || state.error) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(state.error, null, JSON.stringify(state));
  assert.equal(state.availableVersion, expected.version, JSON.stringify(state));
  assert.equal(state.phase, 'available', JSON.stringify(state));
  console.log(`Published ${previousVersion} discovered live ${state.availableVersion} through its real Electron updater.`);
  await evaluateDesktop(port, 'window.voxoraDesktop.downloadUpdate().catch(()=>{}); true');
  let lastProgress;
  for (let n = 0; n < 600; n++) {
    state = await evaluateDesktop(port, 'window.voxoraDesktop.getUpdateState()');
    if (state.phase === 'ready' || state.error) break;
    if (state.progress !== lastProgress) {
      console.log(`Real desktop download: ${state.progress}% (${state.downloadSource || 'connecting'})`);
      lastProgress = state.progress;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(state.error, null, JSON.stringify(state));
  assert.equal(state.phase, 'ready', JSON.stringify(state));
  const pending = JSON.parse(await readFile(path.join(profile, 'pending.json'), 'utf8'));
  for (const key of ['version', 'sha256', 'size', 'url']) assert.equal(pending[key], expected[key]);
  const binary = await readFile(path.join(target, '.voxora-updates', `Voxora-Setup-${expected.version}.exe`));
  assert.equal(binary.length, expected.size);
  assert.equal(createHash('sha256').update(binary).digest('hex'), expected.sha256);
  console.log(`Live ${previousVersion} → ${expected.version} delivery passed: exact ${binary.length} bytes verified and ready for user-approved installation.`);
} catch (error) {
  console.error('Isolated desktop updater state: ' + JSON.stringify(state));
  console.error(await readFile(path.join(profile, 'update-events.jsonl'), 'utf8').catch(() => 'No update events.'));
  throw error;
} finally {
  try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], {stdio: 'ignore'}); } catch {}
}
