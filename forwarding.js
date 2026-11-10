import {premiumPerks} from './premium.js';
import {isSuspended} from './platform.js';
import {randomUUID} from 'node:crypto';
import {copyFile,unlink} from 'node:fs/promises';
import path from 'node:path';
export function forwardingService({state,dataDir,body,json,fail,save,canRead,canChannel,collaboration,createMessage,messageView,serverFor,rate,serverAssets}){
 async function handle(req,res,url,me){const match=url.pathname.match(/^\/api\/(messages|thread-messages)\/([\w-]+)\/forward$/);if(!match)return false;if(req.method!=='POST')fail(405,'Method not allowed.');const d=await body(req);if(Object.keys(d).some(k=>!['channel','confirm'].includes(k))||typeof d.channel!=='string'||d.confirm!==true)fail(400,'Choose a destination and confirm sharing the message.');
  const find=()=>state[match[1]==='messages'?'messages':'threadMessages'].find(m=>m.id===match[2]),source=find();
  const access=()=>!isSuspended(me)&&source&&find()===source&&canRead(me,source.channel)&&!me.blocked?.includes(source.authorId)&&(!source.threadId||collaboration.hasReplyAccess(source,me))&&canChannel(me,d.channel,'sendMessages');if(!access())fail(404,'The source message or destination is unavailable.');rate('forward:'+me.id,10,60000);
  const originals=(source.files||[]).map(id=>state.files.find(f=>f.id===id)).filter(Boolean);if(originals.length&&!canChannel(me,d.channel,'attachFiles'))fail(403,'Attach Files is required at the destination.');if(originals.some(f=>f.size>premiumPerks(me).uploadBytes))fail(403,'This attachment exceeds your plan’s upload limit.');const stickerIds=originals.filter(f=>f.stickerId).map(f=>f.stickerId);serverAssets.stickers(me,d.channel,stickerIds);const copies=[];
  try{for(const file of originals){const copy={...file,id:randomUUID(),channel:d.channel,userId:me.id};await copyFile(path.join(dataDir,'uploads',file.id),path.join(dataDir,'uploads',copy.id));copies.push(copy);}if(!access()||originals.some(f=>f.size>premiumPerks(me).uploadBytes))fail(403,'Your forwarding access or plan changed.');state.files.push(...copies);
   const originalView=messageView(source),snapshot={author:originalView.author,time:source.time};
   const message=await createMessage(me,{channel:d.channel,text:source.text,files:copies.map(f=>f.id)},{forwardSource:snapshot,authorize:()=>{serverAssets.stickers(me,d.channel,stickerIds);if(!access())fail(403,'Your forwarding access changed.');}});json(res,201,message);return true;
  }catch(error){state.files=state.files.filter(f=>!copies.includes(f));for(const file of copies)await unlink(path.join(dataDir,'uploads',file.id)).catch(()=>{});await save();throw error;}
 }
 return {handle};
}
