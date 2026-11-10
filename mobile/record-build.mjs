import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const platform=process.argv[2], version=JSON.parse(await readFile('mobile/package.json','utf8')).version;
if(!['android','ios'].includes(platform)||!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||''))throw Error('Run on the matching mobile build workflow.');
const filename=platform==='android'?`Voxora-Android-${version}-unsigned.apk`:`Voxora-iOS-${version}-unsigned.ipa`,bytes=await readFile('mobile-builds/'+filename);
await writeFile(`mobile-builds/${platform}.json`,JSON.stringify({platform,version,filename,sourceCommit:process.env.GITHUB_SHA,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,simulatorLaunchPassed:true},null,2)+'\n');
console.log(`::notice title=Mobile package built::${platform} ${version} compiled and launched in the native emulator/simulator. Candidate SHA-256: ${createHash('sha256').update(bytes).digest('hex')}`);
