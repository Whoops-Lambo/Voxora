export function searchQuery(value,fail){
 if(typeof value!=='string'||value.length>500)fail(400,'Search can contain up to 500 characters.');
 const result={text:[],from:[],has:[],before:null,after:null,in:[]};
 for(const token of value.match(/(?:[^\s"]+|"[^"]*")+/g)||[]){const m=/^(from|has|before|after|in):(.+)$/i.exec(token);if(!m){result.text.push(token.replace(/^"|"$/g,'').toLowerCase());continue;}const key=m[1].toLowerCase(),data=m[2].replace(/^"|"$/g,'');if(key==='before'||key==='after'){if(!/^\d{4}-\d{2}-\d{2}$/.test(data)||!Number.isFinite(Date.parse(data+'T00:00:00Z'))||new Date(data+'T00:00:00Z').toISOString().slice(0,10)!==data)fail(400,'Search dates use YYYY-MM-DD.');result[key]=Date.parse(data+'T00:00:00Z');}else if(key==='has'){if(!['file','image','video','link','voice','poll'].includes(data.toLowerCase()))fail(400,'Use has:file, image, video, link, voice or poll.');result.has.push(data.toLowerCase());}else result[key].push(data.toLowerCase().replace(/^[@#]/,''));}
 return result;
}
export function matchesSearch(query,message,{author,channel,files,title=''}){
 const text=(title+' '+message.text).toLowerCase();
 return query.text.every(word=>text.includes(word))&&(!query.before||message.time<query.before)&&(!query.after||message.time>=query.after)&&(!query.from.length||query.from.some(value=>value===message.authorId||value===author?.username?.toLowerCase()))&&(!query.in.length||query.in.some(value=>value===message.channel||value===channel?.name.toLowerCase()))&&query.has.every(kind=>kind==='poll'?!!message.poll:kind==='link'?/https?:\/\//i.test(message.text):files.some(file=>kind==='voice'?file.voiceNote:kind==='file'?true:file.mime.startsWith(kind+'/')));
}
