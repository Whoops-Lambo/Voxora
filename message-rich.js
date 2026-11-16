export function richMessage(d,actor,fail){
 if(d.embeds===undefined&&d.components===undefined)return{};
 if(!actor.bot)fail(403,'Only bot and webhook identities can send message embeds or buttons.');
 const text=(v,max)=>{if(typeof v!=='string'||v.length>max)fail(400,'Embed text is too long or invalid.');return v;};
 const url=v=>{let u;try{u=new URL(v);}catch{fail(400,'Choose an HTTPS link.');}if(u.protocol!=='https:'||u.username||u.password||u.href.length>2000)fail(400,'Choose an HTTPS link without credentials.');return u.href;};
 if(d.embeds!==undefined&&(!Array.isArray(d.embeds)||d.embeds.length>10))fail(400,'Use up to ten embeds.');
 let total=0;
 const embeds=(d.embeds||[]).map(e=>{if(!e||typeof e!=='object'||Array.isArray(e))fail(400,'Invalid embed.');const out={};for(const [k,n] of [['title',256],['description',4096],['footer',2048]])if(e[k]!==undefined){out[k]=text(e[k],n);total+=out[k].length;}if(e.url!==undefined)out.url=url(e.url);if(e.color!==undefined){if(!/^#[a-f0-9]{6}$/i.test(e.color))fail(400,'Choose a six-digit embed color.');out.color=e.color;}if(e.fields!==undefined){if(!Array.isArray(e.fields)||e.fields.length>25)fail(400,'Use up to 25 embed fields.');out.fields=e.fields.map(f=>{if(!f||typeof f!=='object')fail(400,'Invalid embed field.');const name=text(f.name,256),value=text(f.value,1024);total+=name.length+value.length;return{name,value,inline:f.inline===true};});}return out;});
 if(total>6000)fail(400,'Embeds can contain up to 6,000 text characters altogether.');
 if(d.components!==undefined&&(!Array.isArray(d.components)||d.components.length>25))fail(400,'Use up to 25 buttons.');
 const ids=new Set(),components=(d.components||[]).map(c=>{if(!c||typeof c!=='object'||typeof c.label!=='string'||!c.label.trim()||c.label.length>80)fail(400,'Choose a button label of 1–80 characters.');const out={label:c.label,disabled:c.disabled===true,style:['primary','secondary','danger','success'].includes(c.style)?c.style:'secondary'};if(c.url!==undefined){out.url=url(c.url);if(c.customId!==undefined)fail(400,'A button can have a link or an action ID.');}else{if(typeof c.customId!=='string'||!c.customId||c.customId.length>100||ids.has(c.customId))fail(400,'Action IDs must be unique and up to 100 characters.');ids.add(c.customId);out.customId=c.customId;}return out;});
 return{...(embeds.length?{embeds}:{}),...(components.length?{components}:{})};
}
export function richText(value){return(value.embeds||[]).flatMap(e=>[e.title||'',e.url||'',e.description||'',e.footer||'',...(e.fields||[]).flatMap(f=>[f.name,f.value])]).concat((value.components||[]).flatMap(c=>[c.label,c.url||''])).join('\n');}
