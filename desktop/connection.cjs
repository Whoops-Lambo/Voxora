const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const DEFAULT_SERVER = require('./platform.json').defaultServer;
const LOCAL_SERVER = 'http://127.0.0.1:43127';
function trustedURL(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Enter the HTTPS address of your Voxora server.'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Enter a server address without a path or credentials.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname))) throw Error('Use HTTPS for a shared server.');
  return url.origin;
}
async function verifyServer(origin, { fetch: fetcher = globalThis.fetch, instanceId } = {}) {
  let response, info;
  try {
    response = await fetcher(trustedURL(origin) + '/api/info', { signal: AbortSignal.timeout(10000), redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' } });
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>32768)throw Error('Server metadata exceeds its limit.');chunks.push(chunk);}
    info = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw Error('Cannot reach Voxora at this address. Check that the shared server is running, then retry.'); }
  if (!response.ok || info?.name !== 'Voxora' || !['/app','/'].includes(info.appPath ?? '/') || info.instanceId !== undefined && (typeof info.instanceId !== 'string' || !/^[a-f0-9-]{36}$/i.test(info.instanceId))) throw Error('This address is not a reachable Voxora server.');
  if (instanceId && info.instanceId && instanceId !== info.instanceId) throw Error('This address is serving a different Voxora installation. Reconnect explicitly if this change is expected.');
  return { appPath: info.appPath === '/app' ? '/app' : '/', instanceId: info.instanceId || null };
}
async function readConnection(filename) {
  try {
    const raw = JSON.parse(await fs.readFile(filename,'utf8'));
    const server = trustedURL(raw.server);
    const mode = raw.mode ?? (server === LOCAL_SERVER ? 'host' : 'remote');
    if (!['host','remote'].includes(mode) || mode === 'host' && server !== LOCAL_SERVER || raw.instanceId !== undefined && raw.instanceId !== null && (typeof raw.instanceId !== 'string' || !/^[a-f0-9-]{36}$/i.test(raw.instanceId))) throw Error('The saved server connection is invalid. Choose your server again.');
    return { mode, server, instanceId: raw.instanceId || null };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function saveConnection(filename, value) {
  const temporary = filename + '.' + randomUUID() + '.tmp';
  await fs.mkdir(path.dirname(filename),{recursive:true});
  try { await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600}); await fs.rename(temporary,filename); }
  finally { await fs.unlink(temporary).catch(()=>{}); }
}
function isSetupURL(value, filename) {
  try { const url=new URL(value);if(url.protocol!=='file:'||url.search||url.hash)return false;const actual=path.resolve(fileURLToPath(url)),expected=path.resolve(filename);return process.platform==='win32'?actual.toLowerCase()===expected.toLowerCase():actual===expected; }
  catch{return false;}
}
module.exports = { DEFAULT_SERVER, LOCAL_SERVER, trustedURL, verifyServer, readConnection, saveConnection, isSetupURL };
