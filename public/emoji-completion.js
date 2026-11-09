import {visibleMentionText} from './mentions.js';
let catalogPromise;
const popular=['😀','😂','🤣','😊','😍','🥹','😎','🤔','😭','😅','👀','🔥','❤️','💜','💙','✨','🎉','🙌','👍','👎','💯','✅','🚀','💀','🤝','🙏','👋','😴','🤯','😈','🥳','🤩','💻','🎮','🎵','🍕','☕','🌈','🐱','🐶','💪','🫡','🤷','🫶','🫠','📌','⚡','💬'];
export function standardEmoji(){return catalogPromise||=(fetch('/emoji-data.json').then(response=>{if(!response.ok)throw Error('Emoji catalog unavailable.');return response.json();}).catch(error=>{catalogPromise=null;throw error;}));}
export function emojiContext(value,caret){
 const raw=value.slice(0,caret);let fenced=false,inline=false;
 for(let i=0;i<raw.length;i++){if(raw[i]==='\\'){i++;continue;}if(raw[i]!=='`')continue;let length=1;while(raw[i+length]==='`')length++;if(length>=3&&!inline)fenced=!fenced;else if(!fenced)inline=!inline;i+=length-1;}
 if(fenced||inline||raw.lastIndexOf('<:')>raw.lastIndexOf('>'))return null;
 const match=/(^|[^a-z0-9_:\/\\])(:([a-z0-9_+\-]*)(:?)$)/i.exec(visibleMentionText(raw));
 return match?{start:caret-match[2].length,end:caret,query:match[3].toLowerCase(),complete:match[4]===':'&&!!match[3]}:null;
}
export function emojiChoices(state,channel,query,standards,limit=16){
 const target=state.servers.find(s=>s.channels.some(c=>c.id===channel)),permissions=target?.channels.find(c=>c.id===channel)?.permissions||[],plus=!!state.premium?.active,candidates=[];
 for(const e of state.serverEmojis||[]){const external=e.serverId!==target?.id,source=state.servers.find(s=>s.id===e.serverId),reason=e.active===false?'Locked by server boost capacity':target&&!permissions.includes('useCustomEmoji')?'Use Custom Emoji permission required':external&&!source?.permissions.includes('useCustomEmoji')?'Source server Use Custom Emoji permission required':external&&!plus?'Voxora Plus required':external&&target&&!permissions.includes('useExternalEmoji')?'Use External Emoji permission required':'';candidates.push({name:e.name,names:[e.name],search:e.name,insert:e.code,url:e.url,serverId:e.serverId,detail:(source?.name||'Server emoji')+(reason?' · '+reason:''),reason,priority:external?2:0});}
 for(const e of standards)candidates.push({name:e.names[0],names:e.names,search:[...e.names,...e.tags,e.description].join(' ').toLowerCase(),insert:e.emoji,emoji:e.emoji,detail:e.description,reason:'',priority:1});
 const rank=c=>c.names.includes(query)?0:c.names.some(name=>name.startsWith(query))?1:2;
 return candidates.filter(c=>!query||c.search.includes(query)).sort((a,b)=>rank(a)-rank(b)||a.priority-b.priority||(!query?((popular.indexOf(a.emoji)+1||1000)-(popular.indexOf(b.emoji)+1||1000)):0)||a.name.localeCompare(b.name)).slice(0,limit);
}
export function createEmojiCompletion({input,picker,getState,getChannel,node,toast}){
 let choices=[],selected=0,context=null,generation=0,composing=false;
 picker.setAttribute('role','listbox');picker.setAttribute('aria-label','Emoji suggestions');
 function close(){picker.hidden=true;context=null;choices=[];if(input.getAttribute('aria-controls')===picker.id){input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}}
 function paint(){for(const [index,element]of [...picker.querySelectorAll('[role=option]')].entries()){element.setAttribute('aria-selected',String(index===selected));if(index===selected)input.setAttribute('aria-activedescendant',element.id);}}
 function choose(index){const choice=choices[index];if(!choice||!context)return;if(getState()?.me.id!==context.account||getChannel()!==context.channel)return close();if(choice.reason){toast(choice.reason,true);return;}
  const value=input.value.slice(0,context.start)+choice.insert+' '+input.value.slice(context.end);if(input.maxLength>0&&value.length>input.maxLength){toast('This emoji would exceed your message length limit.',true);return;}input.setRangeText(choice.insert+' ',context.start,context.end,'end');close();input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
 }
 async function update(){const request=++generation,state=getState(),token=emojiContext(input.value,input.selectionStart);if(!state||!token||input.disabled||composing)return close();const account=state.me.id,channel=getChannel(),value=input.value;
  let data;try{data=await standardEmoji();}catch{return close();}if(request!==generation||getState()?.me.id!==account||getChannel()!==channel||input.value!==value||input.selectionStart!==token.end)return;
  choices=emojiChoices(getState(),channel,token.query,data);selected=0;context={...token,channel,account};
  if(token.complete){const exact=choices.findIndex(c=>c.names.includes(token.query)&&!c.reason);if(exact>=0){choose(exact);return;}}
  if(!choices.length)return close();picker.replaceChildren(node('div','mention-picker-title','EMOJI'));
  for(const [index,choice]of choices.entries()){const visual=choice.url?node('img','server-emoji'):node('span','emoji-completion-icon',choice.emoji);if(choice.url){visual.src=choice.url;visual.alt='';}const option=node('button','mention-option emoji-option',[visual,node('span','emoji-option-copy',[node('strong','',':'+choice.name+':'),node('small','',choice.detail)])]);option.type='button';option.id=picker.id+'-'+index;option.setAttribute('role','option');option.setAttribute('aria-label','Insert emoji :'+choice.name+':'+(choice.reason?' · '+choice.reason:''));option.setAttribute('aria-disabled',String(!!choice.reason));option.onpointerdown=e=>e.preventDefault();option.onclick=()=>choose(index);option.onmouseenter=()=>{selected=index;paint();};picker.append(option);}
  picker.hidden=false;input.setAttribute('aria-controls',picker.id);input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','true');paint();
 }
 function keydown(event){if(picker.hidden||event.isComposing)return false;if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();selected=(selected+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;paint();picker.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});return true;}if(['Enter','Tab'].includes(event.key)){event.preventDefault();choose(selected);return true;}if(event.key==='Escape'){event.preventDefault();generation++;close();return true;}return false;}
 input.addEventListener('click',update);input.addEventListener('keyup',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))update();});input.addEventListener('compositionstart',()=>{composing=true;close();});input.addEventListener('compositionend',()=>{composing=false;update();});document.addEventListener('pointerdown',event=>{if(event.target!==input&&!picker.contains(event.target)){generation++;close();}});
 return {update,keydown,close};
}
