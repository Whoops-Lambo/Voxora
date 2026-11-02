import {settingsForm} from './settings-ui.js';
export function createForumUI({node,button,ib,input,field,formDialog,confirmDialog,api,getState,getChannel,storage,refreshState,openThread,formatted,toast,markRead,acknowledge,openSettings}) {
  const target=()=>document.getElementById('forum-view');
  let active=null,timer,editingDialog=null;
  const allowed=permission=>getChannel()?.permissions.includes(permission);
  const closeModal=()=>document.getElementById('modal').close();
  const select=(label,items)=>{const el=node('select');el.setAttribute('aria-label',label);for(const [value,text] of items){const option=node('option','',text);option.value=value;el.append(option);}return el;};
  const chip=(tag,click)=>{const el=button(tag.name,click,'forum-tag');el.style.setProperty('--tag-color',tag.color);return el;};
  const valid=view=>active===view&&view.root.isConnected&&getState()?.me.id===view.account&&getChannel()?.id===view.channel;
  function leave(){clearTimeout(timer);active=null;target()?.replaceChildren();}
  async function openPost(id){
    const post=await api('/forum-posts/'+id);
    await openThread(post.thread.id);await acknowledge(post.message.channel,post.message);schedule();
  }
  function editor(post=null){
    const c=getChannel();if(!c?.forum)return;
    const key='forum-draft:'+getState().me.id+':'+c.id,draft=post?null:storage.get(key,{});
    const name=input(post?.title??draft?.title??'','Give your discussion a title');name.maxLength=80;name.required=true;
    const text=node('textarea','forum-post-text');text.rows=7;text.maxLength=getState().premium?.perks.messageCharacters||2000;text.value=post?.message.text??draft?.text??'';text.placeholder='Start a discussion, ask a question, or share something useful.';
    const chosen=new Set(post?.message.forumPost.tagIds??draft?.tagIds??[]),tagChoices=node('div','forum-tag-choices');
    const saveDraft=()=>{if(!post)storage.set(key,{title:name.value,text:text.value,tagIds:[...chosen]});};
    for(const tag of c.forum.tags){const check=input('','','checkbox');check.checked=chosen.has(tag.id);check.setAttribute('aria-label',tag.name);check.onchange=()=>{if(check.checked)chosen.add(tag.id);else chosen.delete(tag.id);saveDraft();};tagChoices.append(node('label','forum-tag-option',[check,node('span','',tag.name)]));}
    const files=input('','','file');files.multiple=true;files.setAttribute('aria-label','Post attachments');
    name.oninput=saveDraft;text.oninput=saveDraft;
    if(post){name.disabled=!post.canEditTitle;text.disabled=!post.canEditText;for(const check of tagChoices.querySelectorAll('input'))check.disabled=!post.canEditTags;}
    formDialog({title:post?'Edit Forum Post':'New Forum Post',description:c.forum.requireTag?'Choose at least one tag. You can add up to five.':'Give each discussion a clear title. Tags help members find it later.',
      fields:[field('POST TITLE',name),field('POST CONTENT',text),...(c.forum.tags.length?[field('POST TAGS',tagChoices)]:[]),...(!post?[field('ATTACHMENTS',files)]:[])],submitLabel:post?'Save Post':'Create Post',
      submit:async()=>{
        if(chosen.size>5)throw Error('Choose up to five tags.');if(c.forum.requireTag&&!chosen.size)throw Error('Choose at least one tag.');
        if(post){
          const changes={revision:post.revision,...(post.canEditTitle?{title:name.value}:{}),...(post.canEditText?{text:text.value}:{}),...(post.canEditTags?{tagIds:[...chosen]}:{})};
          await api('/forum-posts/'+post.message.id,'PATCH',changes);await refreshState();schedule();return;
        }
        if(!text.value.trim()&&!files.files.length)throw Error('Write post content or attach a file.');
        if(files.files.length>5)throw Error('Attach up to five files.');
        const ids=[];
        for(const file of files.files){const response=await fetch('/api/files?channel='+c.id,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});const uploaded=await response.json();if(!response.ok)throw Error(uploaded.error);ids.push(uploaded.id);}
        const result=await api('/forums/'+c.id+'/posts','POST',{title:name.value,text:text.value,tagIds:[...chosen],files:ids});
        storage.set(key,{});closeModal();await refreshState();await openPost(result.message.id);
      }});
    editingDialog={field:name,channel:c.id,account:getState().me.id};
  }
  function settings(c=getChannel(),target=null,onSaved=null){
    if(!target)return c&&openSettings(c);if(!c?.forum)return;const original=c.forum,rows=node('div','forum-tag-editor'),tags=original.tags.map(tag=>({...tag}));
    const required=input('','','checkbox');required.checked=original.requireTag;required.setAttribute('aria-label','Require a tag for new posts');
    const draw=()=>{rows.replaceChildren();tags.forEach((tag,index)=>{const name=input(tag.name);name.maxLength=24;name.setAttribute('aria-label','TAG NAME '+(index+1));const color=input(tag.color,'','color');color.setAttribute('aria-label','TAG COLOR '+(index+1));name.oninput=()=>tag.name=name.value;color.oninput=()=>tag.color=color.value;rows.append(node('div','forum-tag-editor-row',[name,color,ib('close','Remove Tag '+(index+1),()=>{tags.splice(index,1);draw();})]));});};draw();
    const config={title:'Forum Settings',description:'Create up to 20 tags. Removing a tag keeps its posts and replies.',fields:[rows,button('Add Tag',()=>{if(tags.length>=20)throw Error('Use up to 20 tags.');tags.push({name:'',color:'#5865f2'});draw();}),node('label','permission-row',[node('span','','Require a tag for new posts'),required])],submitLabel:'Save Forum Settings',submit:async()=>{await api('/forums/'+c.id,'PATCH',{version:original.version,tags,requireTag:required.checked});await refreshState();schedule();}};settingsForm({node,button,target,config,onSaved});
  }
  function card(post){
    const m=post.message,article=node('article','forum-post'+(post.unread?' unread':''));article.dataset.forumPost=m.id;
    const tags=node('div','forum-post-tags');if(m.pinned)tags.append(node('span','forum-pin','Pinned'));if(post.unread)tags.append(node('span','forum-unread','Unread'));
    for(const tag of post.tags)tags.append(chip(tag,()=>{if(!active)return;active.tags=new Set([tag.id]);active.offset=0;syncTags(active);load(active);}));
    article.append(tags,button(post.title,()=>openPost(m.id),'forum-post-title'),node('div','forum-preview',[formatted(m.text,m.customEmojis)]));
    if(m.attachments.length)article.append(node('p','forum-file-count',m.attachments.length+' attachment(s) · '+m.attachments.map(f=>f.name).join(', ')));
    const meta=node('div','forum-post-meta',[node('span','',m.author+' · '+new Date(m.time).toLocaleDateString()),node('span','',post.thread.replyCount+' replies'+(post.thread.locked?' · Locked':post.thread.archived?' · Archived':''))]);
    const actions=node('div','forum-post-actions',[button('Open Discussion',()=>openPost(m.id),'secondary')]);
    if(post.canEditText||post.canEditTitle||post.canEditTags)actions.append(button('Edit Post',async()=>editor(await api('/forum-posts/'+m.id))));
    if(post.canPin)actions.append(button(m.pinned?'Unpin Post':'Pin Post',async()=>{const latest=await api('/forum-posts/'+m.id);await api('/forum-posts/'+m.id,'PATCH',{revision:latest.revision,pinned:!latest.message.pinned});schedule();}));
    if(post.canDelete)actions.append(button('Delete Post',()=>confirmDialog('Delete Forum Post','Delete this post and every reply? This cannot be undone.',async()=>{await api('/messages/'+m.id,'DELETE');closeModal();schedule();}),'danger'));
    article.append(meta,actions);return article;
  }
  function syncTags(view){
    const c=getChannel();if(!c?.forum)return;const allowedIds=new Set(c.forum.tags.map(t=>t.id));view.tags=new Set([...view.tags].filter(id=>allowedIds.has(id)));view.filters.replaceChildren();
    const all=button('All Tags',()=>{view.tags.clear();view.offset=0;syncTags(view);load(view);},'forum-tag');all.setAttribute('aria-pressed',String(!view.tags.size));view.filters.append(all);
    for(const tag of c.forum.tags){const item=chip(tag,()=>{if(view.tags.has(tag.id))view.tags.delete(tag.id);else view.tags.add(tag.id);view.offset=0;syncTags(view);load(view);});item.setAttribute('aria-pressed',String(view.tags.has(tag.id)));view.filters.append(item);}
    view.settingsVersion=c.forum.version;view.newPost.disabled=!allowed('sendMessages')||!allowed('createThreads');
  }
  async function load(view){
    if(!valid(view))return;syncTags(view);const version=++view.version;
    const query=new URLSearchParams({q:view.search.value,sort:view.sort.value,archived:view.archived.value,offset:String(view.offset),unread:view.unread.checked?'1':'0'});for(const id of view.tags)query.append('tag',id);
    try{
      const data=await api('/forums/'+view.channel+'/posts?'+query);if(!valid(view)||version!==view.version)return;
      if(!data.posts.length&&view.offset>0){view.offset=Math.max(0,Math.floor((data.total-1)/20)*20);return load(view);}
      view.status.textContent=data.total+' post(s)'+(view.tags.size>1?' · Matches all selected tags':'');view.list.replaceChildren(...data.posts.map(card));view.pager.replaceChildren();
      if(!data.posts.length)view.list.append(node('div','forum-empty',[node('h3','','No posts here yet'),node('p','','Start a discussion or try different search filters.')]));
      if(view.offset)view.pager.append(button('Previous Posts',()=>{view.offset=Math.max(0,view.offset-20);return load(view);}));
      if(data.hasMore)view.pager.append(button('More Posts',()=>{view.offset+=20;return load(view);}));
    }catch(error){if(valid(view)&&version===view.version){view.status.textContent=error.message;if([403,404].includes(error.status))view.list.replaceChildren();}}
  }
  function show(){
    leave();const c=getChannel();if(!c?.forum)return;
    const search=input('','Search post titles and content');search.setAttribute('aria-label','Search forum posts');search.maxLength=100;
    const sort=select('Sort forum posts',[['active','Latest Activity'],['newest','Newest Posts'],['oldest','Oldest Posts'],['replies','Most Replies']]);
    const archived=select('Post status',[['0','Active Posts'],['1','Archived Posts'],['all','All Posts']]),unread=input('','','checkbox');unread.setAttribute('aria-label','Unread posts only');
    const filters=node('div','forum-filters'),list=node('div','forum-post-list'),status=node('p','forum-count'),pager=node('div','forum-pager'),newPost=button('New Post',()=>editor(),'primary');
    const tools=node('div','forum-tools',[newPost,button('Mark New Posts as Read',()=>markRead(c.id))]);
    if(allowed('manageChannels'))tools.append(button('Forum Settings',()=>settings()));
    const root=node('section','forum-board',[node('div','forum-board-heading',[node('div','',[node('h1','',c.name),node('p','',c.topic||'A place for questions, ideas, and longer conversations.')]),tools]),node('div','forum-search',[search,sort,archived,node('label','forum-unread-filter',[unread,node('span','','Unread only')])]),filters,status,list,pager]);
    target().replaceChildren(root);active={root,account:getState().me.id,channel:c.id,tags:new Set(),offset:0,version:0,settingsVersion:c.forum.version,search,sort,archived,unread,filters,list,status,pager,newPost};
    const view=active;search.oninput=()=>{view.offset=0;clearTimeout(timer);timer=setTimeout(()=>load(view),180);};
    for(const control of [sort,archived,unread])control.onchange=()=>{view.offset=0;load(view);};load(view);
  }
  function schedule(){
    if(editingDialog?.field.isConnected&&(!getState()?.servers.some(s=>s.channels.some(c=>c.id===editingDialog.channel))||getState()?.me.id!==editingDialog.account)){closeModal();editingDialog=null;}
    const view=active;if(!view)return;
    if(!valid(view)||!getChannel()?.forum){leave();return;}
    clearTimeout(timer);timer=setTimeout(()=>load(view),80);
  }
  function handleEvent(event){if(['message','message-update','message-delete','thread-state','thread-message','thread-message-update','thread-message-delete','thread-deleted','thread-read'].includes(event.type))schedule();}
  return {show,leave,refresh:schedule,handleEvent,editor,settings,openPost};
}
