import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const { recordDesktopStartup } = createRequire(import.meta.url)('../../desktop/install-update.cjs');
const [mode, filename] = process.argv.slice(2), config = JSON.parse(await readFile(filename, 'utf8'));
const scenario = process.env.VOXORA_TEST_SCENARIO;
const receiptPath = path.join(config.installDir, 'resources/voxora-release.json');
if (mode === 'install') {
  try { process.kill(config.pid, 0); throw Error('Installer started before the old app exited'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (scenario === 'installer-failure') { await writeFile(path.join(path.dirname(config.logPath), 'installer-details.log'), 'Could not back up resources\\app.asar. The previous files will be restored.'); process.exit(5); }
  if (scenario !== 'version-mismatch') await writeFile(receiptPath, JSON.stringify({ version: config.version, ...(scenario === 'payload-mismatch' ? {files:[{path:'Voxora.exe',size:20,sha256:'0'.repeat(64)}]} : {}) }));
} else {
  if (scenario === 'relaunch-failure') process.exit(3);
  const { version } = JSON.parse(await readFile(receiptPath, 'utf8'));
  await recordDesktopStartup(path.dirname(config.startupPath), version, ['--voxora-update=' + config.nonce]);
}
