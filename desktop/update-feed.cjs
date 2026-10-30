const FEED_URL = 'https://raw.githubusercontent.com/Whoops-Lambo/Voxora/main/updates/stable.json';
const MAX_INSTALLER_SIZE = 512 * 1024 * 1024;
function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)) throw Error('Invalid stable release version.');
  return value.split('.').map(Number);
}
function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function artifactCommit(value, version) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) throw Error('Untrusted update download address.');
  const prefix = url.hostname === 'media.githubusercontent.com' ? '/media/Whoops-Lambo/Voxora/' : url.hostname === 'raw.githubusercontent.com' ? '/Whoops-Lambo/Voxora/' : url.hostname === 'github.com' ? '/Whoops-Lambo/Voxora/raw/' : null;
  if (!prefix || !url.pathname.startsWith(prefix)) throw Error('Updates must come from the official Voxora repository.');
  const [commit, folder, filename, extra] = url.pathname.slice(prefix.length).split('/');
  if (!/^[a-f0-9]{40}$/.test(commit) || folder !== 'installers' || filename !== `Voxora-Setup-${version}.exe` || extra !== undefined) throw Error('Updates must reference an immutable Voxora installer.');
  return commit;
}
function validateFeed(value) {
  if (!value || value.schema !== 1 || value.platform !== 'win32-x64') throw Error('Unsupported update feed.');
  versionParts(value.version); artifactCommit(value.url, value.version);
  if (!/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 2 || value.size > MAX_INSTALLER_SIZE) throw Error('Invalid update integrity information.');
  if (typeof value.notes !== 'string' || value.notes.length > 8000 || typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt))) throw Error('Invalid release information.');
  return { schema: 1, platform: 'win32-x64', version: value.version, url: value.url, sha256: value.sha256, size: value.size, notes: value.notes, publishedAt: value.publishedAt };
}
module.exports = { FEED_URL, MAX_INSTALLER_SIZE, compareVersions, artifactCommit, validateFeed };
