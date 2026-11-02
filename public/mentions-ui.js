import {visibleMentionText} from './mentions.js';
import {channelPermissions} from './permissions.js';
export function createMentionPicker({input,picker,getState,getRoute,node,toast}) {
  let choices=[],selected=0,context=null;
  input.setAttribute('aria-controls',picker.id);input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
  picker.setAttribute('role','listbox');picker.setAttribute('aria-label','Mention suggestions');
  function close(){picker.hidden=true;choices=[];context=null;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
  function paint(){for(const [i,option]of [...picker.querySelectorAll('[role=option]')].entries()){option.setAttribute('aria-selected',String(i===selected));if(i===selected)input.setAttribute('aria-activedescendant',option.id);}}
  function choose(index){
    const choice=choices[index],route=getRoute(),state=getState();if(!choice||!context||route.channel!==context.channel||state?.me.id!==context.account)return close();
    const value=input.value.slice(0,context.start)+choice.insert+' '+input.value.slice(context.end);
    if(input.maxLength>0&&value.length>input.maxLength){toast('This mention would exceed the message length limit.',true);return;}
    input.setRangeText(choice.insert+' ',context.start,context.end,'end');close();input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
  }
  function update(){
    const state=getState(),route=getRoute();if(!state||input.disabled||!['channel','dm'].includes(route.kind))return close();
    const prefix=visibleMentionText(input.value).slice(0,input.selectionStart),match=/(^|[^a-z0-9_.@\\])(@(?:\{[^}\n]*|[a-z0-9_.]*))$/i.exec(prefix);
    if(!match)return close();
    const fragment=match[2],query=fragment.slice(fragment.startsWith('@{')?2:1).toLowerCase(),server=state.servers.find(s=>s.id===route.server&&s.channels.some(c=>c.id===route.channel));
    const members=server?.members||state.conversations.find(c=>c.id===route.channel)?.members||[],canMass=server&&channelPermissions(server,state.me.id,route.channel).includes('mentionEveryone');
    const candidates=state.users.filter(u=>members.includes(u.id)&&(!server||channelPermissions(server,u.id,route.channel).includes('viewChannel'))).map(u=>({label:'@'+(server?.nicknames?.[u.id]||u.displayName||u.username),detail:'@'+u.username,insert:'@'+u.username,search:(u.username+' '+u.displayName+' '+(server?.nicknames?.[u.id]||'')).toLowerCase()}));
    for(const role of server?.roles||[])if(role.id!=='everyone'&&(role.mentionable||canMass)&&!/[}\n]/.test(role.name))candidates.push({label:'@'+role.name,detail:'Role · notify its members',insert:'@{'+role.name+'}',search:role.name.toLowerCase()});
    if(canMass)for(const name of ['everyone','here'])candidates.push({label:'@'+name,detail:name==='here'?'Online members who can view this channel':'Everyone who can view this channel',insert:'@'+name,search:name});
    choices=candidates.filter(c=>c.search.includes(query)).slice(0,12);selected=0;context={start:input.selectionStart-fragment.length,end:input.selectionStart,channel:route.channel,account:state.me.id};
    picker.replaceChildren(node('div','mention-picker-title','MENTION SOMEONE'));
    for(const [i,choice]of choices.entries()){
      const option=node('button','mention-option',[node('strong','',choice.label),node('small','',choice.detail)]);option.type='button';option.id='mention-option-'+i;option.setAttribute('role','option');option.setAttribute('aria-label','Mention '+choice.label);option.onmousedown=e=>e.preventDefault();option.onclick=()=>choose(i);option.onmouseenter=()=>{selected=i;paint();};picker.append(option);
    }
    if(!choices.length)picker.append(node('p','mention-picker-empty','No matching members or mentionable roles.'));
    picker.hidden=false;input.setAttribute('aria-expanded','true');paint();
  }
  function keydown(event){
    if(picker.hidden||event.isComposing)return false;
    if(['ArrowDown','ArrowUp'].includes(event.key)&&choices.length){event.preventDefault();selected=(selected+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;paint();picker.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});return true;}
    if(['Enter','Tab'].includes(event.key)&&choices.length){event.preventDefault();choose(selected);return true;}
    if(event.key==='Escape'){event.preventDefault();close();return true;}
    return false;
  }
  input.addEventListener('click',update);input.addEventListener('keyup',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key))update();});
  document.addEventListener('pointerdown',e=>{if(e.target!==input&&!picker.contains(e.target))close();});
  return {update,keydown,close};
}
