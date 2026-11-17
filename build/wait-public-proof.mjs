import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {findPublicProof} from './deployment-readiness.mjs';
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:8*1024*1024}).trim(),head=git('rev-parse','HEAD'),deadline=Date.now()+8*60000;
while(true){
 try{const proof=findPublicProof({version:pkg.version,artifactCommit:head,runtimeFiles:pkg.build.files,git});console.log('Matching public deployment verified at '+proof.commit+'.');break;}
 catch(error){if(Date.now()>=deadline)throw error;console.log('Waiting for the matching public service before the installed desktop connection test.');await new Promise(r=>setTimeout(r,15000));}
}
