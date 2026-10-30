// NSIS can exceed electron-builder's fixed four-minute timeout on cloud CPUs.
// Keep the pinned builder and installer script, allowing only this step more time.
const { spawn } = require('node:child_process');
const path = require('node:path');
const util = require('builder-util');
const original = util.spawnAndWriteWithOutput;
util.spawnAndWriteWithOutput = function(command, args, data, options) {
  if (path.basename(command).toLowerCase() !== 'makensis' && path.basename(command).toLowerCase() !== 'makensis.exe') return original(command, args, data, options);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10 * 60 * 1000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(Error('NSIS compression exceeded ten minutes; no installer was published.'));
      else if (code !== 0) reject(Error(`NSIS failed (${code}): ${stderr}\n${stdout}`));
      else resolve({ stdout, stderr });
    });
    child.stdin.end(data);
  });
};
const cli = path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js');
process.argv[1] = cli;
require(cli);
