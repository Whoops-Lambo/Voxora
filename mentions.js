import {mentionTokens} from './public/mentions.js';
import {hasPersonalMention} from './public/activity.js';
export function mentionService({state,serverFor,canRead,canChannel,publicUser,fail}) {
  function resolve(me, channel, text, previous) {
    const server=serverFor(channel), conversation=state.conversations.find(c=>c.id===channel);
    const members=(server?.members||conversation?.members||[]).map(id=>state.users.find(u=>u.id===id)).filter(u=>u&&canRead(u,channel));
    const recipients=new Set(),references=[];
    for(const item of mentionTokens(text)) {
      let targets=[],reference;
      const name=item.value.toLowerCase();
      if(server&&item.kind==='name'&&['everyone','here'].includes(name.replace(/\.+$/,''))) {
        if(!canChannel(me,channel,'mentionEveryone'))fail(403,'You need Mention Everyone & Roles permission to use @everyone or @here here.');
        const kind=name.replace(/\.+$/,'');targets=members.filter(u=>kind==='everyone'||publicUser(u).status!=='offline');reference={kind,label:'@'+kind+(item.token.match(/\.+$/)?.[0]||'')};
      } else if(item.kind==='role') {
        const roles=(server?.roles||[]).filter(r=>r.id!=='everyone'&&(r.id===item.value||r.name.toLowerCase()===name));
        if(roles.length>1)fail(400,'Multiple roles have that name. Rename them before mentioning this role.');
        const role=roles[0];if(!role)continue;
        if(!role.mentionable&&!canChannel(me,channel,'mentionEveryone'))fail(403,'This role cannot be mentioned. Ask a server manager to make it mentionable.');
        targets=members.filter(u=>server.memberRoles[u.id]?.includes(role.id));reference={kind:'role',id:role.id,label:'@'+role.name,color:role.color};
      } else {
        const user=members.find(u=>item.kind==='userId'?u.id===item.value:u.username.toLowerCase()===name)||members.find(u=>item.kind==='name'&&u.username.toLowerCase()===name.replace(/\.+$/,''));
        if(!user)continue;targets=[user];reference={kind:'user',id:user.id,label:'@'+(server?.nicknames?.[user.id]||user.displayName||user.username)+(item.kind==='name'&&user.username.toLowerCase()!==name?(item.token.match(/\.+$/)?.[0]||''):'')};
      }
      targets.forEach(u=>recipients.add(u.id));references.push({...reference,token:item.token});
    }
    // Editing can remove an existing ping, but never notify a new recipient.
    const before=previous&&(previous.mentions?.recipients||members.filter(u=>hasPersonalMention(previous.text,u.username)).map(u=>u.id));
    return {recipients:[...recipients].filter(id=>!before||before.includes(id)),references};
  }
  return {resolve};
}
