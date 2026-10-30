const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const SCRIPT = `param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$success = $false
$message = ''
try {
  $running = Get-Process -Id $config.pid -ErrorAction SilentlyContinue
  if ($running -and -not $running.WaitForExit(120000)) { throw 'Voxora did not close; the update was not installed.' }
  if ((Get-Item -LiteralPath $config.installer).Length -ne $config.size -or (Get-FileHash -LiteralPath $config.installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.sha256) { throw 'Installer verification failed. Download the update again.' }
  $installed = Start-Process -FilePath $config.installer -ArgumentList @('/S', ('/D=' + $config.installDir)) -Wait -PassThru
  if ($installed.ExitCode -ne 0) { throw ('Installer exited with code ' + $installed.ExitCode) }
  $success = $true
} catch { $message = $_.Exception.Message }
@{ version = $config.version; success = $success; message = $message } | ConvertTo-Json | Set-Content -LiteralPath $config.resultPath -Encoding UTF8
try { Start-Process -FilePath $config.appExe -WorkingDirectory $config.installDir } catch {}
Remove-Item -LiteralPath $ConfigPath -Force -ErrorAction SilentlyContinue
`;
async function launchWindowsInstaller({ installer, directory, version, sha256, size, appExe = process.execPath, pid = process.pid, spawnProcess = spawn }) {
  const script = path.join(directory, 'install-update.ps1'), configFile = path.join(directory, 'install-' + randomUUID() + '.json');
  const config = { installer, version, sha256, size, appExe, pid, installDir: path.dirname(appExe), resultPath: path.join(directory, 'install-result.json') };
  await fs.writeFile(script, SCRIPT, { mode: 0o600 }); await fs.writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  try {
    await new Promise((resolve, reject) => {
      const child = spawnProcess(path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ConfigPath', configFile], { detached: true, windowsHide: true, stdio: 'ignore' });
      child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
    });
  } catch (error) { await fs.unlink(configFile).catch(() => {}); throw error; }
}
module.exports = { launchWindowsInstaller, SCRIPT };
