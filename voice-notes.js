import {randomUUID} from 'node:crypto';
import {writeFile,unlink,open} from 'node:fs/promises';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {isSuspended} from './platform.js';
import {premiumPerks} from './premium.js';
export function voiceNoteService({state,dataDir,bytes,json,fail,save,rate,canRead,canChannel,isText}){
 const formats={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a'};
 const allowed=(me,channel)=>!isSuspended(me)&&isText(channel)&&canChannel(me,channel,'sendMessages')&&canChannel(me,channel,'attachFiles')&&canChannel(me,channel,'sendVoiceMessages');
 async function handle(req,res,url,me){
  if(url.pathname==='/api/voice-notes'&&req.method==='POST'){
   const channel=url.searchParams.get('channel'),mime=String(req.headers['content-type']||'').split(';')[0],durationMs=Number(req.headers['x-voice-duration']);
   if(!allowed(me,channel))fail(403,'Send Voice Messages, Send Messages and Attach Files are required.');
   if(!formats[mime]||!Number.isFinite(durationMs)||durationMs<100||durationMs>premiumPerks(me).voiceDurationMs)fail(400,'Choose a supported voice recording within your plan’s duration limit.');rate('voice-note:'+me.id,10,60000);
   const content=await bytes(req,Math.min(premiumPerks(me).uploadBytes,premiumPerks(me).voiceBytes));
   const valid=content.length>=12&&(mime==='audio/webm'?content.subarray(0,4).equals(Buffer.from([26,69,223,163])):mime==='audio/ogg'?content.toString('ascii',0,4)==='OggS':content.toString('ascii',4,8)==='ftyp');
   if(!valid)fail(400,'This file is not a supported voice recording.');if(!allowed(me,channel)||durationMs>premiumPerks(me).voiceDurationMs||content.length>premiumPerks(me).voiceBytes)fail(403,'Your recording permissions or plan changed.');
   const file={id:randomUUID(),channel,userId:me.id,name:'Voice message.'+formats[mime],mime,size:content.length,voiceNote:true,durationMs:Math.round(durationMs)},filename=path.join(dataDir,'uploads',file.id);
   await writeFile(filename,content);try{if(!allowed(me,channel)||durationMs>premiumPerks(me).voiceDurationMs||content.length>premiumPerks(me).voiceBytes)fail(403,'Your recording permissions or plan changed.');state.files.push(file);await save();}catch(error){state.files=state.files.filter(f=>f!==file);await unlink(filename).catch(()=>{});throw error;}
   json(res,201,file);return true;
  }
  const match=url.pathname.match(/^\/api\/voice-notes\/([\w-]+)$/);if(!match)return false;if(!['GET','HEAD'].includes(req.method))fail(405,'Method not allowed.');
  const file=state.files.find(f=>f.id===match[1]&&f.voiceNote&&formats[f.mime]);if(!file||!canRead(me,file.channel))fail(404,'Voice message not found.');let handle;try{handle=await open(path.join(dataDir,'uploads',file.id));}catch{fail(404,'Voice message not found.');}
  try{const size=(await handle.stat()).size;let start=0,end=size-1,status=200;const range=req.headers.range;
   if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||!m[1]&&!m[2]){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return true;}if(m[1]){start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1;}else start=Math.max(0,size-Number(m[2]));if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return true;}status=206;}
   if(!canRead(me,file.channel))fail(404,'Voice message not found.');res.writeHead(status,{'Content-Type':file.mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});if(req.method==='HEAD')res.end();else await pipeline(handle.createReadStream({start,end}),res);return true;
  }finally{await handle.close().catch(()=>{});}
 }
 return {handle};
}
