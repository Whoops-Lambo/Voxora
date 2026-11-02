const fs = require('node:fs/promises');
const path = require('node:path');
const RESERVE_BYTES = 32 * 1024 * 1024;

async function assertFreeSpace(directory, required, readSpace = fs.statfs) {
  let existing = directory, stats;
  for (;;) {
    try { stats = await readSpace(existing, { bigint: true }); break; }
    catch (error) {
      const parent = path.dirname(existing);
      if (error.code !== 'ENOENT' || parent === existing) throw error;
      existing = parent;
    }
  }
  const available = BigInt(stats.bavail) * BigInt(stats.bsize);
  if (available < BigInt(required)) {
    throw Error(`Not enough free space on the drive containing ${directory}. This update needs at least ${Math.ceil(required / 1048576)} MB free. Free space or run the copy installed on your larger drive, then retry.`);
  }
}

async function assertInstallSpace(appExe, installerSize, readSpace) {
  const directory = path.dirname(appExe);
  let payload = (await fs.stat(appExe).catch(() => null))?.size || 0;
  try {
    const receipt = JSON.parse(await fs.readFile(path.join(directory, 'resources/voxora-release.json'), 'utf8'));
    if (Array.isArray(receipt.files) && receipt.files.every(file => Number.isSafeInteger(file.size) && file.size >= 0)) {
      const total = receipt.files.reduce((sum, file) => sum + file.size, 0);
      if (Number.isSafeInteger(total)) payload = Math.max(payload, total);
    }
  } catch {}
  await assertFreeSpace(directory, Math.max(payload, installerSize) + RESERVE_BYTES, readSpace);
}

module.exports = { assertFreeSpace, assertInstallSpace, RESERVE_BYTES };
