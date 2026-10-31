import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { launchWindowsInstaller } = createRequire(import.meta.url)('../desktop/install-update.cjs');
const shell = process.env.VOXORA_POWERSHELL_PATH;
const root = fileURLToPath(new URL('..', import.meta.url));
for (const scenario of ['success', 'installer-failure', 'version-mismatch', 'relaunch-failure', 'corrupt-after-ready', 'missing-app']) {
  test('real PowerShell update helper: ' + scenario, { skip: !shell, timeout: 25000 }, async () => {
    const directory = await mkdtemp('/tmp/voxora-powershell-');
    const installDir = path.join(directory, "Zoë 日本 [app] & friend's folder"), cache = path.join(directory, "Miyuki 日本 [updates] & friend's cache");
    const installer = path.join(cache, 'Voxora-Setup-2.12.1.exe'), appExe = path.join(installDir, 'Voxora.exe');
    const binary = Buffer.from('MZ synthetic installer, never run as a Windows executable');
    const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    let helper, helperExit;
    try {
      await mkdir(path.join(installDir, 'resources'), { recursive: true }); await mkdir(cache, { recursive: true });
      if (scenario !== 'missing-app') await writeFile(appExe, 'synthetic executable');
      await writeFile(installer, binary); await writeFile(path.join(installDir, 'resources/voxora-release.json'), JSON.stringify({ version: '2.12.0' }));
      const launch = launchWindowsInstaller({ directory: cache, installer, appExe, pid: parent.pid, version: '2.12.1', size: binary.length, sha256: createHash('sha256').update(binary).digest('hex'), readyTimeout: 15000,
        spawnProcess: (exe, args, options) => {
          helper = spawn(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'test/support/update-helper-harness.ps1'), '-ScriptPath', args[args.indexOf('-File') + 1], '-ConfigPath', args.at(-1)], { ...options, env: { ...process.env, VOXORA_TEST_NODE: process.execPath, VOXORA_TEST_HELPER_PROCESS: path.join(root, 'test/support/update-helper-process.mjs'), VOXORA_TEST_SCENARIO: scenario } });
          helperExit = once(helper, 'exit'); return helper;
        } });
      if (scenario === 'missing-app') {
        await assert.rejects(launch, /Voxora has been kept open/);
        assert.equal(parent.exitCode, null);
        assert.match(await readFile(path.join(cache, 'install-update.log'), 'utf8'), /executable could not be found/);
        return;
      }
      await launch;
      await assert.rejects(access(path.join(installDir, 'installer-arguments.json')));
      if (scenario === 'corrupt-after-ready') await writeFile(installer, Buffer.alloc(binary.length));
      const parentExit = once(parent, 'exit'); parent.kill(); await parentExit;
      const [code] = await helperExit;
      assert.equal(code, 0, await readFile(path.join(cache, 'install-helper-output.log'), 'utf8'));
      const result = JSON.parse(await readFile(path.join(cache, 'install-result.json'), 'utf8'));
      const log = await readFile(path.join(cache, 'install-update.log'), 'utf8');
      assert.equal(result.success, scenario === 'success');
      if (scenario === 'relaunch-failure') assert.match(result.message, /closed before confirming/);
      else assert.match(log, /Voxora startup confirmed:/);
      if (scenario === 'installer-failure') assert.match(result.message, /code 5/);
      if (scenario === 'version-mismatch') assert.match(result.message, /requested Voxora version/);
      if (scenario === 'corrupt-after-ready') { assert.match(result.message, /verification failed after shutdown/); await assert.rejects(access(path.join(installDir, 'installer-arguments.json'))); }
      else assert.deepEqual(JSON.parse(await readFile(path.join(installDir, 'installer-arguments.json'), 'utf8')), ['/S', '/D=' + installDir]);
    } finally {
      if (parent.exitCode === null) parent.kill();
      if (helper && helper.exitCode === null && helper.signalCode === null) helper.kill();
      await helperExit?.catch(() => {}); await rm(directory, { recursive: true, force: true });
    }
  });
}
