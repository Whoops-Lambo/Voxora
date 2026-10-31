import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fixture, until } from './support/server.mjs';
import { releaseFeed, sourceFiles } from '../build/release.mjs';
const require = createRequire(import.meta.url);
const { DesktopUpdater } = require('../desktop/updater.cjs');
const { FEED_URL, compareVersions, validateFeed } = require('../desktop/update-feed.cjs');
const { launchWindowsInstaller, SCRIPT } = require('../desktop/install-update.cjs');
const binary = Buffer.alloc(1024 * 20, 49); binary.write('MZ');
const digest = createHash('sha256').update(binary).digest('hex');
const feed = overrides => releaseFeed({ version: '2.8.0', sha256: digest, size: binary.length, notes: 'Threads, emoji and desktop updates.', commit: 'a'.repeat(40), ...overrides });
async function updater(options = {}) {
  const directory = await mkdtemp('/tmp/voxora-updater-'), calls = [], launched = [];
  let quit = false;
  const u = new DesktopUpdater({ version: '2.7.0', directory, supported: true,
    fetch: async (url, opts) => { calls.push({ url, opts }); return url === FEED_URL ? Response.json(feed()) : new Response(binary, { headers: { 'content-length': binary.length } }); },
    launchInstaller: async value => { launched.push(value); }, quit: () => { quit = true; }, ...options });
  await u.initialize();
  return { u, directory, calls, launched, quit: () => quit, cleanup: async () => { u.stop(); await rm(directory, { recursive: true, force: true }); } };
}
test('update feeds accept immutable official installers and reject downgrade tricks, external URLs and malformed releases', () => {
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1); assert.equal(compareVersions('2.8.0', '2.8.0'), 0);
  assert.equal(validateFeed(feed()).version, '2.8.0');
  for (const patch of [{ url: 'https://evil.example/setup.exe' }, { url: feed().url.replace('/' + 'a'.repeat(40) + '/', '/main/') }, { url: feed().url + '?token=private' }, { url: feed().url.replace('2.8.0.exe', '2.9.0.exe') }, { sha256: 'bad' }, { size: 513 * 1024 * 1024 }, { version: '2.8.0-beta.1' }, { notes: 'x'.repeat(8001) }, { publishedAt: 'never' }]) assert.throws(() => validateFeed({ ...feed(), ...patch }));
});
test('desktop updater downloads once, verifies bytes, persists ready updates and hands off only after verification', async () => {
  const f = await updater();
  try {
    const changes = []; f.u.on('change', value => changes.push(value));
    await Promise.all([f.u.check(), f.u.check()]);
    assert.equal(f.calls.filter(c => c.url === FEED_URL).length, 1); assert.equal(f.calls.length, 2);
    assert.equal(f.u.snapshot().phase, 'ready'); assert.equal(f.u.snapshot().progress, 100); assert.ok(changes.some(s => s.phase === 'downloading'));
    assert.deepEqual(await readFile(f.u.downloaded), binary); assert.equal(f.quit(), false);
    assert.ok(!JSON.stringify(f.u.snapshot()).includes(f.directory));
    const restart = new DesktopUpdater({ version: '2.7.0', directory: f.directory, supported: true, fetch: () => { throw Error('No network needed for a verified cached update'); }, launchInstaller: async value => f.launched.push(value), quit: () => { f.u.didQuit = true; } });
    await restart.initialize(); assert.equal(restart.snapshot().phase, 'ready');
    await restart.install(); assert.equal(f.launched.length, 1); assert.equal(f.launched[0].sha256, digest); assert.equal(f.u.didQuit, true);
  } finally { await f.cleanup(); }
});
test('failed, oversized, redirected and corrupted downloads never become installable; current releases do not downgrade', async () => {
  for (const mode of ['hash', 'length', 'redirect', 'offline', 'current']) {
    const f = await updater({ version: mode === 'current' ? '2.9.0' : '2.7.0', fetch: async url => {
      if (url === FEED_URL) { if (mode === 'offline') throw Error('Offline'); return Response.json(feed()); }
      if (mode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://evil.example/setup.exe' } });
      if (mode === 'length') return new Response(Buffer.alloc(binary.length + 1));
      return new Response(Buffer.from('MZ' + 'z'.repeat(binary.length - 2)));
    } });
    try {
      await f.u.check(); assert.notEqual(f.u.snapshot().phase, 'ready'); assert.equal(f.u.downloaded, null);
      await assert.rejects(f.u.install()); assert.equal(f.launched.length, 0); assert.equal(f.quit(), false);
      assert.ok(!(await readdir(f.directory).catch(() => [])).some(p => p.endsWith('.part') || p === 'pending.json'));
      if (mode === 'current') assert.equal(f.u.snapshot().phase, 'idle');
    } finally { await f.cleanup(); }
  }
});
test('automatic-download preferences persist, manual downloads deduplicate, and cache tampering is rejected at install', async () => {
  const f = await updater();
  try {
    await f.u.settings({ autoDownload: false }); await f.u.check(); assert.equal(f.u.snapshot().phase, 'available'); assert.equal(f.calls.length, 1);
    assert.equal(JSON.parse(await readFile(path.join(f.directory, 'settings.json'))).autoDownload, false);
    await Promise.all([f.u.download(), f.u.download()]); assert.equal(f.calls.length, 2);
    await writeFile(f.u.downloaded, Buffer.alloc(binary.length));
    await assert.rejects(f.u.install(), /not a Windows installer/); assert.equal(f.u.snapshot().phase, 'available'); assert.equal(f.quit(), false); assert.equal(f.launched.length, 0);
    await f.u.download(); assert.equal(f.u.snapshot().phase, 'ready');
    await writeFile(path.join(f.directory, 'install-result.json'), '\uFEFF' + JSON.stringify({ version: '2.8.0', success: false, message: 'Test failure' }));
    const restart = new DesktopUpdater({ version: '2.7.0', directory: f.directory, supported: true }); await restart.initialize(); assert.match(restart.snapshot().error, /last update did not finish/); assert.equal(restart.snapshot().autoDownload, false);
    const upgraded = new DesktopUpdater({ version: '2.8.0', directory: f.directory, supported: true }); await upgraded.initialize(); assert.equal(upgraded.snapshot().phase, 'idle'); assert.equal(upgraded.snapshot().error, null);
  } finally { await f.cleanup(); }
});
test('Windows installer handoff passes paths as data, waits for exit and verifies the installer again', async () => {
  const directory = await mkdtemp('/tmp/voxora-handoff-'); const calls = [];
  try {
    const installer = path.join(directory, "Voxora & friends' update.exe"), appExe = path.join(directory, "My App's Folder", 'Voxora.exe');
    await launchWindowsInstaller({ installer, appExe, directory, pid: 123, version: '2.8.0', sha256: digest, size: binary.length,
      spawnProcess: (exe, args, options) => { calls.push({ exe, args, options }); const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child; } });
    const config = JSON.parse(await readFile(calls[0].args.at(-1), 'utf8'));
    assert.equal(config.installer, installer); assert.equal(config.installDir, path.dirname(appExe)); assert.equal(config.sha256, digest);
    assert.ok(calls[0].exe.endsWith('powershell.exe')); assert.equal(calls[0].options.detached, true); assert.ok(!calls[0].args.includes('-Command'));
    assert.ok(SCRIPT.includes('WaitForExit(120000)')); assert.ok(SCRIPT.includes('Get-FileHash')); assert.ok(!SCRIPT.includes(installer));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('release archives include updater and publisher sources while excluding data, credentials, installers and mutable feeds', () => {
  const list = sourceFiles(['server.js', '.env.example', '.env', '.env.billing', 'desktop/updater.cjs', 'build/release.mjs', 'push-update.bat', 'examples/.env.example', 'examples/.env', '.data/state.json', 'bot-data/economy.json', 'public/uploads/.env', 'installers/Voxora-Setup-2.8.0.exe', 'updates/stable.json', 'Voxora.zip'], ['server.js']);
  assert.deepEqual(list, ['.env.example', 'build/release.mjs', 'desktop/updater.cjs', 'examples/.env.example', 'push-update.bat', 'server.js']);
  assert.throws(() => releaseFeed({ version: '2.8.0', sha256: digest, size: binary.length, notes: '', commit: 'main' }));
});
test('only the platform owner can push desktop update checks; notifications are rate limited, audited and durable', async () => {
  const f = await fixture(); let controller, stream;
  try {
    const owner = await f.register('update_owner'), member = await f.register('update_member');
    const role = (await f.call(owner, '/platform/staff-roles', 'POST', { name: 'Staff', color: '#5865f2', permissions: ['manageUsers', 'viewAudit'] })).data;
    await f.call(owner, '/platform/users/' + member.id, 'PATCH', { staffRoleIds: [role.id] });
    assert.equal((await f.call(member, '/platform/updates')).status, 403); assert.equal((await f.call(member, '/platform/updates/notify', 'POST', {})).status, 403);
    controller = new AbortController(); const events = [];
    const response = await fetch(f.origin + '/api/events?client=update-test-client', { headers: { Cookie: member.cookie }, signal: controller.signal }); assert.equal(response.status, 200);
    stream = (async () => { let buffer = ''; for await (const chunk of response.body) { buffer += Buffer.from(chunk).toString(); let index; while ((index = buffer.indexOf('\n\n')) >= 0) { const part = buffer.slice(0, index); buffer = buffer.slice(index + 2); for (const line of part.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6))); } } })().catch(e => { if (!controller.signal.aborted) throw e; });
    assert.equal((await f.call(owner, '/platform/updates/notify', 'POST', {})).status, 200);
    await until(() => events.some(e => e.type === 'desktop-update-check'));
    assert.equal((await f.call(owner, '/platform/updates/notify', 'POST', {})).status, 429);
    assert.ok((await f.call(owner, '/platform/audit')).data.items.some(e => e.action === 'Desktop update check requested'));
    controller.abort(); await stream; await f.stop(); await f.start();
    assert.ok((await f.call(owner, '/platform/updates')).data.lastNotifiedAt);
    assert.equal((await f.call(owner, '/platform/updates/notify', 'POST', {})).status, 429);
  } finally { controller?.abort(); await stream; await f.cleanup(); }
});
