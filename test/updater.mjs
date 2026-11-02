import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fixture, until } from './support/server.mjs';
import { releaseFeed, sourceFiles } from '../build/release.mjs';
const require = createRequire(import.meta.url);
const { DesktopUpdater } = require('../desktop/updater.cjs');
const { FEED_URL, compareVersions, validateFeed } = require('../desktop/update-feed.cjs');
const { launchWindowsInstaller, recordDesktopStartup, SCRIPT } = require('../desktop/install-update.cjs');
const binary = Buffer.alloc(1024 * 20, 49); binary.write('MZ');
const digest = createHash('sha256').update(binary).digest('hex');
const feed = overrides => releaseFeed({ version: '2.8.0', sha256: digest, size: binary.length, notes: 'Threads, emoji and desktop updates.', commit: 'a'.repeat(40), ...overrides });
async function updater(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'voxora-updater-')), calls = [], launched = [];
  let quit = false;
  const u = new DesktopUpdater({ version: '2.7.0', directory, supported: true,
    fetch: async (url, opts) => { calls.push({ url, opts }); return url.split('?')[0] === FEED_URL ? Response.json(feed()) : new Response(binary, { headers: { 'content-length': binary.length } }); },
    launchInstaller: async value => { launched.push(value); }, quit: () => { quit = true; }, ...options });
  await u.initialize();
  return { u, directory, calls, launched, quit: () => quit, cleanup: async () => { u.stop(); await u.logging; await rm(directory, { recursive: true, force: true }); } };
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
    assert.equal(f.calls.filter(c => c.url.split('?')[0] === FEED_URL).length, 1); assert.equal(f.calls.length, 2);
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
      if (url.split('?')[0] === FEED_URL) { if (mode === 'offline') throw Error('Offline'); return Response.json(feed()); }
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
  const directory = await mkdtemp(path.join(os.tmpdir(), 'voxora-handoff-')); const calls = [];
  try {
    const installer = path.join(directory, "Voxora & friends' update.exe"), appExe = path.join(directory, "My App's Folder", 'Voxora.exe');
    await launchWindowsInstaller({ installer, appExe, directory, pid: 123, version: '2.8.0', sha256: digest, size: binary.length,
      spawnProcess: (exe, args, options) => {
        calls.push({ exe, args, options }); const child = new EventEmitter(); child.unref = () => {};
        queueMicrotask(async () => { const config = JSON.parse(await readFile(args.at(-1), 'utf8')); await writeFile(config.readyPath, JSON.stringify({ nonce: config.nonce, ready: true, helperPid: process.pid })); });
        return child;
      } });
    const config = JSON.parse(await readFile(calls[0].args.at(-1), 'utf8'));
    assert.equal(config.installer, installer); assert.equal(config.installDir, path.dirname(appExe)); assert.equal(config.sha256, digest);
    assert.ok(calls[0].exe.endsWith('powershell.exe')); assert.equal(calls[0].options.detached, false); assert.ok(!calls[0].args.includes('-Command'));
    assert.ok(SCRIPT.includes('WaitForExit(250)')); assert.ok(SCRIPT.includes('ComputeHash')); assert.ok(!SCRIPT.includes(installer));
    assert.equal(calls[0].options.cwd, directory); assert.equal(calls[0].options.stdio[0], 'ignore');
    assert.ok((await readFile(calls[0].args[calls[0].args.indexOf('-File') + 1], 'utf8')).startsWith('\uFEFF'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('helper startup failures, early exits, wrong handshakes and timeouts keep Voxora open and preserve a usable update', async () => {
  for (const mode of ['spawn', 'exit', 'dead-helper', 'timeout', 'wrong-nonce', 'preflight']) {
    const f = await updater(); let killed = false;
    try {
      await f.u.check();
      f.u.launchInstaller = value => launchWindowsInstaller({ ...value, readyTimeout: 150, spawnProcess: (exe, args) => {
        const child = new EventEmitter(); child.kill = () => { killed = true; };
        queueMicrotask(async () => {
          if (mode === 'spawn') child.emit('error', Error('PowerShell unavailable'));
          if (mode === 'exit') child.emit('exit', 1);
          const config = JSON.parse(await readFile(args.at(-1), 'utf8'));
          if (mode === 'dead-helper') { await writeFile(config.readyPath, JSON.stringify({nonce:config.nonce,ready:true,helperPid:0})); child.emit('exit',0); }
          if (mode === 'preflight') await writeFile(config.readyPath, JSON.stringify({ nonce: config.nonce, error: 'Install folder is not writable' }));
          if (mode === 'wrong-nonce') await writeFile(config.readyPath, JSON.stringify({ nonce: 'other attempt', ready: true }));
        });
        return child;
      } });
      await assert.rejects(f.u.install(), /Voxora has been kept open/);
      assert.equal(f.quit(), false); assert.equal(f.u.snapshot().phase, 'ready');
      assert.deepEqual(await readFile(f.u.downloaded), binary);
      assert.match(await readFile(path.join(f.directory, 'install-update.log'), 'utf8'), /Handoff failed/);
      assert.equal(killed, !['exit','dead-helper'].includes(mode));
    } finally { await f.cleanup(); }
  }
});
test('the relaunched desktop confirms the specific update attempt without accepting arbitrary command line paths', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'voxora-startup-')), nonce = '12345678-1234-1234-1234-123456789012';
  try {
    await recordDesktopStartup(directory, '2.12.1', ['--voxora-update=../../other-file']); assert.deepEqual(await readdir(directory), []);
    await recordDesktopStartup(directory, '2.12.1', ['--voxora-update=' + nonce]);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'desktop-started.json'), 'utf8')), { nonce, version: '2.12.1', pid: process.pid, phase:'connected' });
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


test('confirming a cached update while a focus check is pending still installs the verified release', async () => {
  const f = await updater(); let finishCheck;
  try {
    await f.u.check();
    const original = f.u.fetcher;
    f.u.fetcher = url => url.split('?')[0] === FEED_URL ? new Promise(resolve => { finishCheck = resolve; }) : original(url);
    const refresh = f.u.check({force:true});
    try {
      await f.u.install();
      assert.equal(f.launched.length, 1); assert.equal(f.quit(), true);
      assert.equal(f.u.phase, 'installing');
    } finally {
      finishCheck(Response.json(feed({version:'2.9.0'}))); await refresh;
    }
    assert.equal(f.u.phase, 'installing', 'A late check cannot reset the installer handoff');
    assert.equal(f.u.release.version, '2.8.0');
  } finally { await f.cleanup(); }
});

test('a shared install confirmation pins the verified release, blocks focus checks and resumes polling after Later', async () => {
  let serial=0,now=10000; const tasks=new Map(),timers={now:()=>now,set:(fn,ms)=>{const id=++serial;tasks.set(id,{fn,ms});return id;},clear:id=>tasks.delete(id)};
  const f=await updater({timers}); let finishCheck,answer,asked=0;
  try {
    await f.u.check(); f.u.start(); assert.equal(tasks.size,1);
    f.u.fetcher=()=>new Promise(resolve=>{finishCheck=resolve;});
    const refresh=f.u.check({force:true});
    const confirmation=f.u.confirmInstall(async release=>{asked++;assert.equal(release.version,'2.8.0');return new Promise(resolve=>{answer=resolve;});});
    assert.equal(f.u.confirmInstall(()=>{throw Error('Duplicate dialog');}),confirmation);
    await until(()=>!!answer); assert.equal(tasks.size,0); assert.equal(f.u.nextCheck,null);
    await f.u.wake(); await f.u.check({force:true}); await f.u.settings({autoDownload:false});
    finishCheck(Response.json(feed({version:'2.9.0'}))); await refresh;
    assert.equal(f.u.phase,'ready'); assert.equal(f.u.release.version,'2.8.0'); assert.equal(asked,1);
    assert.equal(JSON.parse(await readFile(path.join(f.directory,'pending.json'))).version,'2.8.0');
    answer(false); await confirmation; assert.equal(f.quit(),false); assert.equal(f.launched.length,0);
    assert.equal(f.u.confirming,false); assert.equal(tasks.size,1); assert.equal([...tasks.values()][0].ms,60000);
    f.u.fetcher=async()=>Response.json(feed({version:'2.9.0'})); await f.u.check({force:true});
    assert.equal(f.u.release.version,'2.9.0'); assert.equal(f.u.phase,'available');
  } finally { answer?.(false); finishCheck?.(Response.json(feed())); await f.cleanup(); }
});

test('confirmation holds through asynchronous verification and helper startup; duplicate install requests share one handoff', async () => {
  const f=await updater(); let answer,finishLaunch,asked=0;
  try {
    await f.u.check();
    f.u.launchInstaller=value=>{f.launched.push(value);return new Promise(resolve=>{finishLaunch=resolve;});};
    const confirmation=f.u.confirmInstall(async()=>{asked++;return new Promise(resolve=>{answer=resolve;});});
    await until(()=>!!answer); await f.u.wake(); answer(true); await until(()=>!!finishLaunch);
    const active=f.u.installation; assert.equal(f.u.install(),active);
    await f.u.check({force:true}); assert.equal(f.u.phase,'installing'); assert.equal(f.launched.length,1); assert.equal(f.quit(),false);
    finishLaunch(); await Promise.all([active,confirmation]); assert.equal(asked,1); assert.equal(f.quit(),true); assert.equal(f.u.phase,'installing');
  } finally { answer?.(false); finishLaunch?.(); await f.cleanup(); }
});

test('a changed or tampered update cannot inherit consent, and dialog failures preserve a retryable verified cache', async () => {
  const f=await updater(); let answer;
  try {
    await f.u.check();
    await assert.rejects(f.u.install(feed({version:'2.9.0'})),/available update changed/); assert.equal(f.launched.length,0);
    await assert.rejects(f.u.confirmInstall(()=>{throw Error('Dialog failed');}),/Dialog failed/); assert.equal(f.u.confirming,false); assert.equal(f.u.phase,'ready');
    const confirmation=f.u.confirmInstall(()=>new Promise(resolve=>{answer=resolve;}));
    await until(()=>!!answer); await writeFile(f.u.downloaded,Buffer.alloc(binary.length)); answer(true);
    await assert.rejects(confirmation,/not a Windows installer/); assert.equal(f.quit(),false); assert.equal(f.launched.length,0); assert.equal(f.u.phase,'available'); assert.equal(f.u.downloaded,null);
    assert.ok(!(await readdir(f.directory)).includes('pending.json'));
    await f.u.download(); assert.equal(f.u.phase,'ready');
  } finally { answer?.(false); await f.cleanup(); }
});

test('external installations keep installer downloads on the app drive while retaining preferences and logs in the profile', async () => {
  const downloadDirectory = await mkdtemp(path.join(os.tmpdir(), 'voxora-external-cache-'));
  const f = await updater({ downloadDirectory });
  try {
    await writeFile(path.join(f.directory, 'Voxora-Setup-2.6.0.exe'), binary);
    await writeFile(path.join(f.directory, 'keep-user-file.txt'), 'keep');
    await f.u.check();
    assert.equal(f.u.phase, 'ready'); assert.equal(path.dirname(f.u.downloaded), downloadDirectory);
    assert.deepEqual(await readFile(f.u.downloaded), binary);
    assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.exe')));
    assert.equal(await readFile(path.join(f.directory, 'keep-user-file.txt'), 'utf8'), 'keep');
    const restart = new DesktopUpdater({version:'2.7.0', directory:f.directory, downloadDirectory, supported:true, launchInstaller:async value=>f.launched.push(value), quit:()=>{}});
    await restart.initialize(); assert.equal(restart.phase, 'ready');
    await restart.install(); assert.equal(f.launched[0].directory, f.directory); assert.equal(path.dirname(f.launched[0].installer), downloadDirectory);
    await restart.logging;
  } finally { await f.cleanup(); await rm(downloadDirectory, {recursive:true, force:true}); }
});

test('insufficient download-drive space prevents the binary request and permits retry without closing Voxora', async () => {
  let available = 100 * 1024 * 1024;
  const f = await updater({readSpace:async()=>({bavail:BigInt(available),bsize:1n}), fetch:async url=>{
    if (url.split('?')[0]===FEED_URL) return Response.json(feed({size:110*1024*1024}));
    throw Error('The installer must not be requested without enough disk space');
  }});
  try {
    await f.u.check(); assert.equal(f.u.phase, 'available'); assert.match(f.u.error,/Not enough free space/); assert.equal(f.quit(),false);
    assert.ok(!(await readdir(f.directory)).some(name=>name.endsWith('.part')));
    available=1024*1024*1024; f.u.release=feed(); f.u.fetcher=async()=>new Response(binary);
    await f.u.download(); assert.equal(f.u.phase,'ready');
  } finally { await f.cleanup(); }
});

test('insufficient installation-drive space blocks helper handoff and leaves a verified update ready', async () => {
  const f = await updater(); let spawned=false;
  try {
    await f.u.check();
    f.u.launchInstaller=value=>launchWindowsInstaller({...value, appExe:path.join(f.directory,'Voxora.exe'), readSpace:async()=>({bavail:100n*1024n*1024n,bsize:1n}), spawnProcess:()=>{spawned=true;throw Error('Must not spawn');}});
    const {mkdir}=await import('node:fs/promises'); await mkdir(path.join(f.directory,'resources'));
    await writeFile(path.join(f.directory,'resources/voxora-release.json'),JSON.stringify({files:[{path:'Voxora.exe',size:250*1024*1024}]}));
    await assert.rejects(f.u.install(),/Not enough free space.*Voxora has been kept open/s);
    assert.equal(spawned,false); assert.equal(f.quit(),false); assert.equal(f.u.phase,'ready'); assert.deepEqual(await readFile(f.u.downloaded),binary);
  } finally { await f.cleanup(); }
});
