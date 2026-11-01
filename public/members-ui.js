export function createMemberUI({node,input,button,modal,getState,getServer,person,memberRow,memberRoles,invite}) {
  let sidebar = null, directory = null;
  const queries = new Map();
  const key = s => getState().me.id + ':' + s.id;
  function draw(view) {
    const s = getState()?.servers.find(s=>s.id===view.serverId);
    if (!s || view.account!==getState()?.me.id) { view.root.replaceChildren(node('p','muted','You no longer have access to this server.')); return; }
    const all = s.members.map(person), q = view.search.value.trim().toLowerCase();
    const name=u=>s.nicknames?.[u.id]||u.displayName;
    const members = all.filter(u=>(name(u)+' '+u.displayName+' '+u.username).toLowerCase().includes(q)).sort((a,b)=>name(a).localeCompare(name(b)));
    view.heading.textContent='Members · '+all.length; view.results.replaceChildren();
    const assigned = new Set();
    for(const role of s.roles.filter(r=>r.hoist).sort((a,b)=>b.position-a.position)) {
      const list=members.filter(u=>u.status!=='offline'&&!assigned.has(u.id)&&memberRoles(s,u.id).some(r=>r.id===role.id));
      if(!list.length)continue;view.results.append(node('div','member-heading',role.name+' — '+list.length));
      for(const u of list){assigned.add(u.id);view.results.append(memberRow(u,s));}
    }
    for(const [label,list] of [['ONLINE',members.filter(u=>u.status!=='offline'&&!assigned.has(u.id))],['OFFLINE',members.filter(u=>u.status==='offline')]]) {
      if(!list.length)continue;view.results.append(node('div','member-heading',label+' — '+list.length));
      for(const u of list)view.results.append(memberRow(u,s));
    }
    if(!members.length)view.results.append(node('p','muted member-empty',q?'No members match this search.':'No members to display.'));
    view.count.textContent=q?members.length+' matching member(s)':'People appear here after joining this server.';
  }
  function create(target,s) {
    const heading=node('h2','members-title'),search=input(queries.get(key(s))||'','Search members'),results=node('div','members-results'),count=node('p','member-directory-note');
    search.setAttribute('aria-label','Search members');
    const root=node('section','member-directory',[heading,search,count,results]);target.replaceChildren(root);
    const view={serverId:s.id,account:getState().me.id,root,heading,search,results,count};
    search.oninput=()=>{queries.set(key(s),search.value);draw(view);};draw(view);return view;
  }
  function render(target) {
    const s=getServer();if(!s){target.replaceChildren();return;}
    if(sidebar?.root.isConnected&&sidebar.serverId===s.id&&sidebar.account===getState()?.me.id&&target.contains(sidebar.root)){draw(sidebar);return;}
    sidebar=create(target,s);
  }
  function open(s=getServer()) {
    if(!s)return;const target=node('div');modal([target],'members-dialog');directory=create(target,s);
    if(s.permissions.includes('inviteMembers'))directory.root.insertBefore(button('Invite People',()=>invite(s),'primary'),directory.results);
  }
  function refresh(){for(const view of [sidebar,directory])if(view?.root.isConnected)draw(view);}
  return {render,open,refresh};
}
