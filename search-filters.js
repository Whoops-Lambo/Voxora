export function searchQuery(value,fail){
 if(typeof value!=='string'||value.length>500)fail(400,'Search can contain up to 500 characters.');
 const tokens=value.match(/(?:[^\s"]+|"[^"]*")+/g)||[],groups=[[]];
 for(const token of tokens){if(token==='OR'||token==='|')groups.push([]);else groups.at(-1).push(token);}
 if(groups.length>1){if(groups.length>10||groups.some(g=>!g.length))fail(400,'Use up to ten nonempty OR branches.');return{or:groups.map(g=>searchQuery(g.join(' '),fail))};}
 const result={text:[],from:[],has:[],before:null,after:null,in:[],exclude:[],mentions:[],is:[]};
 let negate=false;
 for(let token of tokens){
  if(token==='NOT'){negate=true;continue;}
  if(negate||token.startsWith('-')){token=token.replace(/^-/,'');if(!token)fail(400,'Choose a term to exclude.');result.exclude.push(searchQuery(token,fail));negate=false;continue;}
  const m=/^(from|has|before|after|in|mentions|is):(.+)$/i.exec(token);
  if(!m){result.text.push(token.replace(/^"|"$/g,'').toLowerCase());continue;}
  const key=m[1].toLowerCase(),data=m[2].replace(/^"|"$/g,'');
  if(key==='before'||key==='after'){if(!/^\d{4}-\d{2}-\d{2}$/.test(data)||!Number.isFinite(Date.parse(data+'T00:00:00Z'))||new Date(data+'T00:00:00Z').toISOString().slice(0,10)!==data)fail(400,'Search dates use YYYY-MM-DD.');result[key]=Date.parse(data+'T00:00:00Z');}
  else if(key==='has'){if(!['file','image','video','link','voice','poll','embed','reaction','thread','sticker'].includes(data.toLowerCase()))fail(400,'Unknown has: filter.');result.has.push(data.toLowerCase());}
  else if(key==='is'){if(!['pinned','edited','bot','forwarded','thread'].includes(data.toLowerCase()))fail(400,'Use is:pinned, edited, bot, forwarded or thread.');result.is.push(data.toLowerCase());}
  else result[key].push(data.toLowerCase().replace(/^[@#]/,''));
 }
 if(negate)fail(400,'NOT needs a search term.');
 return result;
}
export function matchesSearch(query,message,context){
 const {author,channel,files=[],title='',users=[],hasThread=false}=context;
 if(query.or)return query.or.some(q=>matchesSearch(q,message,context));
 const text=(title+' '+message.text).toLowerCase();
 return query.text.every(word=>text.includes(word))&&!(query.exclude||[]).some(q=>matchesSearch(q,message,context))&&(!query.before||message.time<query.before)&&(!query.after||message.time>=query.after)&&(!query.from.length||query.from.some(value=>value===message.authorId||value===author?.username?.toLowerCase()))&&(!query.in.length||query.in.some(value=>value===message.channel||value===channel?.name.toLowerCase()))&&(!query.mentions?.length||query.mentions.some(value=>(message.mentions?.recipients||[]).some(id=>id===value||users.some(u=>u.id===id&&u.username?.toLowerCase()===value))))&&(query.is||[]).every(kind=>({pinned:!!message.pinned,edited:!!message.editedAt,bot:!!author?.bot,forwarded:!!message.forwardSource,thread:!!message.threadId||!!message.thread||hasThread})[kind])&&query.has.every(kind=>kind==='poll'?!!message.poll:kind==='embed'?!!message.embeds?.length:kind==='reaction'?!!message.reactions?.length:kind==='thread'?!!message.thread||!!message.threadId||hasThread:kind==='sticker'?!!message.stickers?.length||files.some(f=>!!f.stickerId):kind==='link'?/https?:\/\//i.test(message.text):files.some(file=>kind==='voice'?file.voiceNote:kind==='file'?true:file.mime?.startsWith(kind+'/')));
}
