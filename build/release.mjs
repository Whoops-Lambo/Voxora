import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
const require = createRequire(import.meta.url);
const { ZipFile } = require('yazl');
const asar = require('@electron/asar');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');
const { compareVersions, validateFeed, artifactCommit } = require('../desktop/update-feed.cjs');
const { verifyInstaller } = require('../desktop/updater.cjs');
const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString().trim();
const exists = filename => fs.access(filename).then(() => true, () => false);
export function releaseFeed({ version, sha256, size, notes, commit, publishedAt = new Date().toISOString() }) {
  return validateFeed({ schema: 1, platform: 'win32-x64', version, sha256, size, notes, publishedAt, url: `https://media.githubusercontent.com/media/Whoops-Lambo/Voxora/${commit}/installers/Voxora-Setup-${version}.exe` });
}
export function sourceFiles(tracked, runtimeFiles) {
  const roots = new Set(['.gitignore', '.gitattributes', 'README.md', 'package.json', 'package-lock.json', 'playwright.config.mjs', 'push-update.bat', 'installers/SHA256SUMS.txt', ...runtimeFiles.filter(p => !p.includes('*'))]);
  const folders = new Set(['public', 'desktop', 'build', 'test', 'docs', 'sdk', 'examples', '.github']);
  return tracked.filter(p => p && (roots.has(p) || folders.has(p.split('/')[0])) && !p.endsWith('.exe') && !p.split('/').some(part => ['.data', 'bot-data', 'node_modules', 'dist'].includes(part) || /^\.env(?:\.|$)/.test(part) && part !== '.env.example')).sort();
}
async function sourceZip(pkg) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0');
  const files = sourceFiles(tracked, pkg.build.files), zip = new ZipFile();
  for (const file of files) zip.addFile(path.join(root, file), 'Voxora/' + file);
  const temp = path.join(root, 'Voxora.zip.tmp');
  const writing = pipeline(zip.outputStream, createWriteStream(temp)); zip.end();
  try { await writing; await fs.rename(temp, path.join(root, 'Voxora.zip')); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
async function hashFile(filename) { const hash = createHash('sha256'); for await (const chunk of createReadStream(filename)) hash.update(chunk); return hash.digest('hex'); }
async function verifyBundle(pkg) {
  const archive = path.join(root, 'dist/win-unpacked/resources/app.asar');
  if (JSON.parse(asar.extractFile(archive, 'package.json')).version !== pkg.version) throw Error('The prepared app has a different version. Build it again.');
  const files = pkg.build.files.filter(p => !p.includes('*') && p !== 'package.json');
  async function walk(dir) { for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) { const file = path.posix.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else files.push(file); } }
  await walk('desktop'); await walk('public');
  for (const file of files) if (!asar.extractFile(archive, file).equals(await fs.readFile(path.join(root, file)))) throw Error(`Prepared app differs from source: ${file}. Rebuild before publishing.`);
  if (asar.listPackage(archive).some(p => /(?:^|\/)(?:\.data|bot-data|test)(?:\/|$)/.test(p))) throw Error('The prepared app contains runtime data or tests.');
}
function command(executable, args) {
  return new Promise((resolve, reject) => { const child = spawn(executable, args, { cwd: root, stdio: 'inherit', shell: false }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`${executable} failed (${code}). No release was published.`))); });
}
function npm(script) {
  const npmCLI = process.env.npm_execpath;
  if (npmCLI) return command(process.execPath, [npmCLI, 'run', script]);
  if (process.platform === 'win32') return command(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run ' + script]);
  return command('npm', ['run', script]);
}
async function verifyArchive(filename, bundle) {
  const executable = await getPath7za(); await command(executable, ['t', filename]);
  if (!bundle) return;
  const expected = await hashFile(bundle), hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ['x', '-so', filename, 'resources/app.asar'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => hash.update(chunk)); child.stderr.resume(); child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(Error('Could not verify the installer app bundle.')));
  });
  if (hash.digest('hex') !== expected) throw Error('The installer does not contain the verified app bundle.');
}
function commit(message, files) {
  git('add', '--', ...files);
  git('-c', 'user.name=Voxora Release', '-c', 'user.email=releases@users.noreply.github.com', 'commit', '-m', message, '--', ...files);
}
export async function publish(args = process.argv.slice(2)) {
  let dry = false, reuse = false, resume = false, notesFile;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') dry = true;
    else if (args[i] === '--reuse-build') reuse = true;
    else if (args[i] === '--resume') resume = true;
    else if (args[i] === '--notes-file' && args[i + 1]) notesFile = args[++i];
    else throw Error('Usage: npm run release:push -- [--dry-run] [--reuse-build] [--resume] [--notes-file filename]');
  }
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  compareVersions(pkg.version, pkg.version);
  const origin = git('remote', 'get-url', 'origin').replace(/\.git$/, '');
  if (!/^(?:https:\/\/(?:[^/@]+@)?github\.com\/|git@github\.com:)Whoops-Lambo\/Voxora$/.test(origin)) throw Error('Release publishing is restricted to origin Whoops-Lambo/Voxora.');
  if (git('status', '--porcelain')) throw Error('Commit your source changes first. The release pusher only commits generated release files.');
  const feedPath = path.join(root, 'updates/stable.json');
  const previous = await exists(feedPath) ? validateFeed(JSON.parse(await fs.readFile(feedPath, 'utf8'))) : null;
  if (previous && compareVersions(pkg.version, previous.version) <= 0 && !(resume && pkg.version === previous.version)) throw Error('Bump package.json to a newer stable version and commit before publishing.');
  const filename = `Voxora-Setup-${pkg.version}.exe`, installerRelative = 'installers/' + filename, installer = path.join(root, installerRelative);
  if (!resume && await exists(installer)) throw Error('An installer already exists for this version. Use --resume to finish its release or bump the version.');
  console.log(`Voxora ${pkg.version}: ${dry ? 'preview' : 'publish'} Windows x64 installer, source ZIP, and official desktop update feed to GitHub main.`);
  if (dry) { console.log('Plan: check clean source and remote ancestry; test; build; verify bundle; commit release artifacts; pin feed to artifact commit; push once without force. No changes made.'); return; }
  git('lfs', 'version'); git('lfs', 'install', '--local');
  git('fetch', '--no-tags', 'origin', 'main');
  try { git('merge-base', '--is-ancestor', git('rev-parse', 'FETCH_HEAD'), 'HEAD'); }
  catch { throw Error('GitHub main has newer commits. Merge or rebase them before publishing; no release was pushed.'); }
  if (!resume) {
    await npm('check'); await npm('test');
    if (!reuse) await npm('dist:win');
    await verifyBundle(pkg);
    const built = path.join(root, 'dist', filename), size = (await fs.stat(built)).size, sha256 = await hashFile(built);
    const testFeed = releaseFeed({ version: pkg.version, size, sha256, notes: '', commit: git('rev-parse', 'HEAD') });
    await verifyInstaller(built, testFeed); await verifyArchive(built, path.join(root, 'dist/win-unpacked/resources/app.asar')); await fs.copyFile(built, installer);
    const manifestFile = path.join(root, 'installers/SHA256SUMS.txt');
    const lines = (await fs.readFile(manifestFile, 'utf8')).trimEnd().split('\n');
    if (lines.some(line => line.endsWith('  ' + filename))) throw Error('A checksum already exists for this release.');
    await fs.writeFile(manifestFile, lines.concat(sha256 + '  ' + filename).join('\n') + '\n');
    await sourceZip(pkg);
    const generated = [installerRelative, 'installers/SHA256SUMS.txt', 'Voxora.zip', 'public/bot-starter.zip'];
    const changed = [...git('diff', '--name-only', '-z', 'HEAD').split('\0'), ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0')].filter(Boolean);
    if (changed.some(file => !generated.includes(file))) throw Error('Source files changed during the build. Commit them and rebuild before publishing; generated files were preserved.');
    commit(`Release Voxora ${pkg.version} for Windows`, generated);
  }
  const digest = await hashFile(installer), size = (await fs.stat(installer)).size;
  const manifest = await fs.readFile(path.join(root, 'installers/SHA256SUMS.txt'), 'utf8');
  if (!manifest.split('\n').includes(digest + '  ' + filename)) throw Error('Installer does not match its committed checksum.');
  const fallbackNotes = path.join(root, 'docs/releases', pkg.version + '.md');
  const notes = notesFile || await exists(fallbackNotes) ? await fs.readFile(notesFile ? path.resolve(root, notesFile) : fallbackNotes, 'utf8') : `Voxora ${pkg.version} desktop update.`;
  const feed = previous?.version === pkg.version ? previous : releaseFeed({ version: pkg.version, sha256: digest, size, notes, commit: git('rev-parse', 'HEAD') });
  if (feed.sha256 !== digest || feed.size !== size) throw Error('Existing update feed does not match this installer.');
  const artifact = artifactCommit(feed.url, feed.version);
  const pointer = git('show', artifact + ':' + installerRelative);
  if (!pointer.includes('oid sha256:' + digest) || !pointer.split('\n').includes('size ' + size)) throw Error('Pinned release commit does not contain the expected Git LFS installer.');
  await verifyInstaller(installer, feed);
  if (resume) await verifyArchive(installer);
  if (previous?.version !== pkg.version) {
    await fs.mkdir(path.dirname(feedPath), { recursive: true }); await fs.writeFile(feedPath, JSON.stringify(feed, null, 2) + '\n');
    commit(`Publish Voxora ${pkg.version} desktop update feed`, ['updates/stable.json']);
  }
  await command('git', ['-c', 'http.postBuffer=157286400', 'push', 'origin', 'HEAD:main']);
  console.log(`Published Voxora ${pkg.version}. Installed 2.8+ clients check automatically; Platform Admin → Updates can notify connected clients now.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) publish().catch(error => { console.error('Release stopped: ' + error.message); process.exitCode = 1; });
