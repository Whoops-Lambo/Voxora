const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { assertInstallSpace } = require('./update-storage.cjs');
const SCRIPT = readFileSync(path.join(__dirname, 'install-update.ps1'), 'utf8');
const STARTER = readFileSync(path.join(__dirname, 'start-update.ps1'), 'utf8');
async function launchWindowsInstaller({ installer, directory, version, sha256, size, appExe = process.execPath, pid = process.pid, spawnProcess = spawn, readyTimeout = 30000, readSpace }) {
  const nonce = randomUUID(), base = path.join(directory, 'install-' + nonce);
  const script = base + '.ps1', starter = base + '-start.ps1', configFile = base + '.json';
  const config = { installer, version, sha256, size, appExe, pid, nonce, helperScript:script, starterScript:starter, installDir: path.dirname(appExe), readyPath: base + '.ready.json', cancelPath: base + '.cancel', resultPath: path.join(directory, 'install-result.json'), startupPath: path.join(directory, 'desktop-started.json'), logPath: path.join(directory, 'install-update.log') };
  await fs.mkdir(directory, { recursive: true });
  // PowerShell 5.1 otherwise reads UTF-8 JSON as the user's ANSI code page.
  await fs.writeFile(script, '\uFEFF' + SCRIPT, { mode: 0o600 });
  await fs.writeFile(starter, '\uFEFF' + STARTER, { mode: 0o600 });
  await fs.writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  const output = await fs.open(path.join(directory, 'install-helper-output.log'), 'w', 0o600);
  let child, startupError, exited = false;
  try {
    await assertInstallSpace(appExe, size, readSpace);
    await fs.unlink(config.resultPath).catch(() => {});
    // The short-lived starter uses Windows Start-Process for independence.
    // DETACHED_PROCESS can silently skip PowerShell scripts; a directly
    // inherited console can close with its GUI parent. Neither is a handoff.
    child = spawnProcess(path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', starter, '-ConfigPath', configFile], { cwd: directory, detached: false, windowsHide: true, stdio: ['ignore', output.fd, output.fd] });
    child.on('error', error => { startupError = error; });
    child.on('exit', code => { exited = true; if(code!==0)startupError ||= Error('The update launcher failed (code ' + code + ').'); });
    const deadline = Date.now() + readyTimeout;
    while (true) {
      if (startupError) throw startupError;
      try {
        const ready = JSON.parse(await fs.readFile(config.readyPath, 'utf8'));
        if (ready.nonce === nonce) {
          if (ready.error) throw Error(ready.error);
          if (ready.ready === true) {
            if(!Number.isSafeInteger(ready.helperPid)||ready.helperPid<=0)throw Error('The helper did not identify its running process.');
            try{process.kill(ready.helperPid,0);}catch{throw Error('The update helper stopped before Voxora could close.');}
            child.unref(); return {nonce,helperPid:ready.helperPid};
          }
        }
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      try {
        const result=JSON.parse((await fs.readFile(config.resultPath,'utf8')).replace(/^\uFEFF/,''));
        if(result.nonce===nonce&&result.success===false)throw Error(result.message||'The update helper could not prepare installation.');
      } catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
      if (Date.now() >= deadline) throw Error('The update helper did not become ready.');
      await delay(50);
    }
  } catch (error) {
    await fs.writeFile(config.cancelPath, 'cancel', { mode: 0o600 }).catch(() => {});
    if (!exited) child?.kill();
    await fs.appendFile(config.logPath, new Date().toISOString() + ' Handoff failed: ' + error.message + '\n').catch(() => {});
    throw Error(error.message + ' Voxora has been kept open. Update logs: ' + directory);
  } finally { await output.close(); }
}

async function recordDesktopStartup(directory, version, args = process.argv, phase = 'connected') {
  const nonce = args.find(value => /^--voxora-update=[a-f0-9-]{36}$/.test(value))?.slice('--voxora-update='.length);
  if (!nonce) return;
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, 'desktop-started.json'), temp = target + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify({ nonce, version, pid: process.pid, phase }), { mode: 0o600 });
  for (let attempt=0;;attempt++) {
    try { await fs.rename(temp,target); break; }
    catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=9)throw error;await delay(50);}
  }
}
module.exports = { launchWindowsInstaller, recordDesktopStartup, SCRIPT };
