const { artifactCommit } = require('./update-feed.cjs');
const LFS_URL = 'https://github.com/Whoops-Lambo/Voxora.git/info/lfs/objects/batch';

async function request(fetcher, url, options, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetcher(url, { ...options, credentials: 'omit', signal: AbortSignal.any([options.signal, controller.signal]), redirect: 'manual' });
  } finally { clearTimeout(timer); }
}
async function boundedJSON(response) {
  if (!response.ok || !response.body) throw Error('GitHub file storage is unavailable.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 65536) throw Error('GitHub file-storage metadata exceeds its limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function storageURL(value, release) {
  const url = new URL(value);
  const sha = release.sha256;
  if (url.protocol !== 'https:' || url.hostname !== 'github-cloud.githubusercontent.com' || url.username || url.password || url.port || url.hash ||
    !new RegExp('^/alambic/media/[0-9]+/' + sha.slice(0,2) + '/' + sha.slice(2,4) + '/' + sha + '$').test(url.pathname))
    throw Error('GitHub file storage returned an untrusted download address.');
  return url.href;
}
async function follow(fetcher, value, release, signal, storage, timeout) {
  let url = value;
  for (let count = 0; count < 5; count++) {
    if (storage) storageURL(url, release);
    else if (artifactCommit(url, release.version) !== artifactCommit(release.url, release.version)) throw Error('The update redirected to a different release.');
    const response = await request(fetcher, url, { signal, headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' } }, timeout);
    if ([301,302,303,307,308].includes(response.status)) {
      const next = new URL(response.headers.get('location') || '', url).href;
      await response.body?.cancel(); url = next; continue;
    }
    const length = response.headers.get('content-length'), type = response.headers.get('content-type') || '';
    if (!response.ok || !response.body || length && Number(length) !== release.size || /^(?:text\/|application\/json)/i.test(type)) {
      await response.body?.cancel(); throw Error('GitHub did not return the expected installer.');
    }
    return response;
  }
  throw Error('Too many update redirects.');
}
async function downloadResponse(fetcher, release, signal, { headerTimeout = 20000 } = {}) {
  try { return { response: await follow(fetcher, release.url, release, signal, false, headerTimeout), source: 'github' }; }
  catch (error) { if (signal.aborted) throw error; }
  // Resolve the exact public Git LFS object through the official repository.
  // Signed storage URLs are temporary and never persisted or exposed in state.
  const response = await request(fetcher, LFS_URL, { signal, method: 'POST', headers: { Accept: 'application/vnd.git-lfs+json', 'Content-Type': 'application/vnd.git-lfs+json' },
    body: JSON.stringify({ operation: 'download', transfers: ['basic'], objects: [{ oid: release.sha256, size: release.size }], hash_algo: 'sha256' }) }, headerTimeout);
  const metadata = await boundedJSON(response);
  if (!Array.isArray(metadata.objects) || metadata.objects.length !== 1) throw Error('Invalid GitHub file-storage metadata.');
  const object = metadata.objects[0];
  if (object.error || object.oid !== release.sha256 || object.size !== release.size || typeof object.actions?.download?.href !== 'string') throw Error('GitHub file storage could not resolve this exact release.');
  const url = storageURL(object.actions.download.href, release);
  return { response: await follow(fetcher, url, release, signal, true, headerTimeout), source: 'github-lfs' };
}
module.exports = { downloadResponse, storageURL, LFS_URL };
