import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
const afterPack = createRequire(import.meta.url)('../build/after-pack.cjs');
const execute = promisify(execFile);
const wine = process.env.VOXORA_WINE_PATH, compiler = process.env.VOXORA_NSIS_PATH;
const native = process.platform === 'win32';
const enabled = Boolean(compiler && (native || wine));
const win = value => native ? value : 'Z:' + value.replaceAll('/', '\\');
const nsis = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
async function run(exe, args, options = {}) {
  try { return { code: 0, ...await execute(exe, args, { timeout: 30000, ...options }) }; }
  catch (error) { if (typeof error.code !== 'number') throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
}
const compile = script => run(compiler, ['-V2', '-INPUTCHARSET', 'UTF8', script], { env: { ...process.env, NSISDIR: path.dirname(path.dirname(compiler)) } });
const install = (exe, args) => native ? run(exe, args, { windowsVerbatimArguments: true }) : run(wine, [exe, ...args]);
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'voxora-nsis-')), payload = path.join(directory, 'payload'), target = path.join(directory, "Zoë 日本 [app] & friend's folder");
  await mkdir(path.join(payload, 'resources'), { recursive: true }); await mkdir(path.join(directory, 'build'));
  await writeFile(path.join(payload, 'Voxora.exe'), 'synthetic exe payload');
  await writeFile(path.join(payload, 'resources/app.asar'), 'synthetic application archive');
  await afterPack({ electronPlatformName: 'win32', appOutDir: payload, packager: { projectDir: directory, appInfo: { version: '9.9.9' } } });
  const installer = path.join(directory, 'setup.exe');
  const source = `Unicode true
Name "Voxora installer regression fixture"
OutFile "${nsis(installer)}"
SilentInstall silent
RequestExecutionLevel user
SetOverwrite on
!include "${nsis(path.join(directory, 'build/files.generated.nsh'))}"
Function .onInit
  ; Registry lookups and installer pages can leave this flag set. A successful
  ; extraction must not inherit that state and claim that Voxora is running.
  SetErrors
FunctionEnd
Section "Install"
  !insertmacro VoxoraInstallFiles
  WriteUninstaller "$INSTDIR\\UninstallFixture.exe"
SectionEnd
Section "Uninstall"
  !insertmacro VoxoraUninstallFiles
  Delete "$INSTDIR\\UninstallFixture.exe"
  RMDir "$INSTDIR"
SectionEnd
`;
  const script = path.join(directory, 'setup.nsi'); await writeFile(script, source);
  const compiled = await compile(script); assert.equal(compiled.code, 0, compiled.stdout + compiled.stderr);
  return { directory, payload, target, installer, install: () => install(installer, ['/S', '/D=' + win(target)]), cleanup: () => rm(directory, { recursive: true, force: true }) };
}
async function eventually(check) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await check()) return; await delay(50); }
  throw Error('Timed out waiting for Windows fixture');
}
test('compiled NSIS installs and reinstalls despite stale errors, preserving unrelated files during install and uninstall', { skip: !enabled, timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const first = await f.install(); assert.equal(first.code, 0, first.stdout + first.stderr);
    assert.equal(await readFile(path.join(f.target, 'resources/app.asar'), 'utf8'), 'synthetic application archive');
    assert.equal(JSON.parse(await readFile(path.join(f.target, 'resources/voxora-release.json'), 'utf8')).version, '9.9.9');
    await writeFile(path.join(f.target, 'keep-my-data.txt'), 'user data');
    await writeFile(path.join(f.target, 'resources/app.asar'), 'old version');
    const second = await f.install(); assert.equal(second.code, 0, second.stdout + second.stderr);
    assert.equal(await readFile(path.join(f.target, 'resources/app.asar'), 'utf8'), 'synthetic application archive');
    assert.equal(await readFile(path.join(f.target, 'keep-my-data.txt'), 'utf8'), 'user data');
    const removed = await install(path.join(f.target, 'UninstallFixture.exe'), ['/S']); assert.equal(removed.code, 0, removed.stdout + removed.stderr);
    await eventually(() => access(path.join(f.target, 'Voxora.exe')).then(() => false, () => true));
    assert.equal(await readFile(path.join(f.target, 'keep-my-data.txt'), 'utf8'), 'user data');
    await assert.rejects(access(path.join(f.target, 'resources/voxora-release.json')));
  } finally { await f.cleanup(); }
});
test('compiled NSIS still fails when a real destination directory cannot be created', { skip: !enabled, timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    await mkdir(f.target, { recursive: true }); await writeFile(path.join(f.target, 'resources'), 'user-owned conflicting file');
    const result = await f.install(); assert.equal(result.code, 2, result.stdout + result.stderr);
    assert.equal(await readFile(path.join(f.target, 'resources'), 'utf8'), 'user-owned conflicting file');
  } finally { await f.cleanup(); }
});
test('compiled NSIS rejects a genuinely locked file and can install after that lock is released', { skip: !enabled, timeout: 60000 }, async () => {
  const f = await fixture(); let blocker, exited;
  try {
    assert.equal((await f.install()).code, 0);
    const blockerExe = path.join(f.directory, 'lock.exe'), script = path.join(f.directory, 'lock.nsi');
    await writeFile(script, `Unicode true
Name "Voxora file lock fixture"
OutFile "${nsis(blockerExe)}"
SilentInstall silent
RequestExecutionLevel user
Section
  FileOpen $0 "$INSTDIR\\resources\\app.asar" a
  IfErrors failed
  FileOpen $1 "$INSTDIR\\lock-ready" w
  FileClose $1
loop:
  IfFileExists "$INSTDIR\\release-lock" done
  Sleep 50
  Goto loop
done:
  FileClose $0
  Goto finish
failed:
  SetErrorLevel 5
finish:
SectionEnd
`);
    const compiled = await compile(script); assert.equal(compiled.code, 0, compiled.stdout + compiled.stderr);
    blocker = native ? spawn(blockerExe, ['/S', '/D=' + win(f.target)], { stdio: 'ignore', windowsVerbatimArguments: true }) : spawn(wine, [blockerExe, '/S', '/D=' + win(f.target)], { stdio: 'ignore' }); exited = once(blocker, 'exit');
    await eventually(() => access(path.join(f.target, 'lock-ready')).then(() => true, () => false));
    const failed = await f.install(); assert.notEqual(failed.code, 0, 'A real file lock must never be reported as a successful install');
    await writeFile(path.join(f.target, 'release-lock'), 'release'); await exited;
    const retried = await f.install(); assert.equal(retried.code, 0, retried.stdout + retried.stderr);
    assert.equal(await readFile(path.join(f.target, 'resources/app.asar'), 'utf8'), 'synthetic application archive');
  } finally {
    if (blocker && blocker.exitCode === null) { await writeFile(path.join(f.target, 'release-lock'), 'release').catch(() => {}); await exited; }
    await f.cleanup();
  }
});
