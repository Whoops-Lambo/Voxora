// Exercise the updater actually shipped in 3.0.0, rather than candidate code.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true')throw Error('Isolated Windows CI only.');
const require=createRequire(import.meta.url),asar=require('@electron/asar');
const [previousInstaller,candidateInstaller,appExe,targetVersion]=process.argv.slice(2);
const previousVersion='3.0.0',previousSHA='66ab265c88c843cfeb14d4c30a1ee5f9b484aed66d831c6ce72c0a8572d27d19';
const run=(exe,args)=>new Promise((resolve,reject)=>{const child=spawn(exe,args,{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(path.basename(exe)+' exited '+code)));});
const bytes=await readFile(previousInstaller);assert.equal(createHash('sha256').update(bytes).digest('hex'),previousSHA,'The old installer must be the immutable published 3.0.0 release.');
await run(previousInstaller,['/S','/D='+path.dirname(appExe)]);
const archive=path.join(path.dirname(appExe),'resources','app.asar');
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,previousVersion);
const directory=await mkdtemp(path.join(process.env.RUNNER_TEMP,'voxora-shipped-updater-'));
try{
 for(const file of ['updater.cjs','update-storage.cjs','update-feed.cjs','update-download.cjs','install-update.cjs','install-update.ps1','start-update.ps1']){
  await writeFile(path.join(directory,file),asar.extractFile(archive,'desktop/'+file));
 }
 console.log('Testing the unmodified updater and PowerShell scripts extracted from published '+previousVersion+'.');
 await run(process.execPath,[fileURLToPath(new URL('./test-windows-update.mjs',import.meta.url)),candidateInstaller,appExe,targetVersion,directory,previousVersion]);
}finally{await rm(directory,{recursive:true,force:true});}
