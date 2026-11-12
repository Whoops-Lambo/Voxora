import {test,expect} from '@playwright/test';
import {fixture} from '../support/server.mjs';

async function signedIn(browser,f,user,width=1440) {
  const context=await browser.newContext({baseURL:f.origin,viewport:{width,height:width<1000?844:960},isMobile:width<1000,hasTouch:width<1000}),[name,value]=user.cookie.split('=');
  await context.addCookies([{name,value,url:f.origin}]);const page=await context.newPage();await page.goto('/app');await expect(page.locator('#message-input')).toBeVisible();return{context,page};
}
const modal=p=>p.locator('#modal');
async function voices(p) {await p.locator('.app-tools').click();await modal(p).getByRole('button',{name:'Open Community Voices',exact:true}).click();}
async function serverTool(p,s,label) {
  await p.getByRole('button',{name:s.name,exact:true}).click();
  if(await p.getByRole('button',{name:'Show Channels',exact:true}).isVisible())await p.getByRole('button',{name:'Show Channels',exact:true}).click();
  await p.locator('#channel-sidebar').getByRole('button',{name:label,exact:true}).click();
}
async function lab() {
  const f=await fixture(),o=await f.register('voices_ui_owner'),m=await f.register('voices_ui_member'),n=await f.register('voices_ui_friend'),s=(await f.call(o,'/servers','POST',{name:'Community Voices UI'})).data;
  for(const u of[m,n])await f.call(u,'/invites/join','POST',{code:s.invite});return{f,o,m,n,s,ch:s.channels[0].id,base:'/servers/'+s.id+'/voices'};
}

for(const width of[320,390,820,1440])test('Community Voices and server profile editing fit '+width+'px',async({browser})=>{
  const f=await fixture();let context;
  try{
    const user=await f.register('voices_layout'),session=await signedIn(browser,f,user,width);context=session.context;const p=session.page;
    await voices(p);await expect(modal(p).getByRole('heading',{name:'Every community has a voice.',exact:true})).toBeVisible();
    expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await modal(p).evaluate(e=>e.scrollWidth<=e.clientWidth+2)).toBe(true);
    await p.screenshot({path:'test-results/voxora37-home-'+width+'.png',fullPage:true});
    await modal(p).getByRole('button',{name:'Community Directory',exact:true}).click();
    await modal(p).getByRole('button',{name:'My Server Profile',exact:true}).click();
    await expect(modal(p).getByRole('button',{name:'Style Server Profile · Plus',exact:true})).toBeDisabled();
    await modal(p).getByRole('button',{name:'Edit Server Profile',exact:true}).click();
    await p.getByLabel('SERVER ABOUT ME',{exact:true}).fill('Finding friends for music and games.');await p.getByLabel('SERVER PRONOUNS',{exact:true}).fill('they/them');
    await p.getByLabel('INTERESTS — COMMA SEPARATED',{exact:true}).fill('music, games');await p.getByRole('checkbox',{name:'Looking for a group',exact:true}).check();await p.getByLabel('AVAILABILITY',{exact:true}).selectOption('open');
    await p.getByRole('button',{name:'Save Server Profile',exact:true}).click();await expect(modal(p)).toContainText('Finding friends for music and games.');
    await modal(p).getByRole('button',{name:'Community Directory',exact:true}).click();await p.getByLabel('DIRECTORY INTEREST',{exact:true}).selectOption('music');
    await expect(modal(p)).toContainText('1 matching profile(s)');await expect(modal(p)).toContainText('Open to connect');
    expect(await modal(p).evaluate(e=>e.scrollWidth<=e.clientWidth+2)).toBe(true);
    await p.screenshot({path:'test-results/voxora37-directory-'+width+'.png',fullPage:true});
  }finally{await context?.close();await f.cleanup();}
});

test('suggestions, votes, comments, official roadmap decisions and private updates work across browsers',async({browser})=>{
  test.setTimeout(90000);const a=await lab();let oc,mc,nc;
  try{
    const{f,o,m,n,s}=a,owner=await signedIn(browser,f,o),member=await signedIn(browser,f,m),friend=await signedIn(browser,f,n);oc=owner.context;mc=member.context;nc=friend.context;const p=owner.page,q=member.page,r=friend.page;
    await serverTool(q,s,'Suggestion Board');await modal(q).getByRole('button',{name:'New Suggestion',exact:true}).click();
    await q.getByLabel('SUGGESTION TITLE',{exact:true}).fill('A monthly community game night');await q.getByLabel('SUGGESTION DETAILS',{exact:true}).fill('Let us meet and play together.');await q.getByLabel('CATEGORY',{exact:true}).selectOption('community');
    await q.getByRole('button',{name:'Save Suggestion',exact:true}).click();await expect(modal(q).getByRole('heading',{name:'A monthly community game night',exact:true})).toBeVisible();
    for(const page of[p,r]){await serverTool(page,s,'Suggestion Board');await modal(page).getByRole('button',{name:'Open Suggestion',exact:true}).click();}
    await modal(r).getByRole('button',{name:'Vote for Suggestion',exact:true}).click();await expect(modal(q)).toContainText('1 vote(s)');
    await modal(r).getByRole('button',{name:'Watch Suggestion',exact:true}).click();await modal(r).getByRole('button',{name:'Add Comment',exact:true}).click();await r.getByLabel('COMMENT TEXT',{exact:true}).fill('Saturday evenings would be great.');await r.getByRole('button',{name:'Save Comment',exact:true}).click();
    await expect(modal(q)).toContainText('Saturday evenings would be great.');
    await modal(r).getByRole('button',{name:'Edit Comment',exact:true}).click();await r.getByLabel('COMMENT TEXT',{exact:true}).fill('Saturday evenings or Sunday afternoons.');await r.getByRole('button',{name:'Save Comment',exact:true}).click();await expect(modal(p)).toContainText('Sunday afternoons.');
    await expect(modal(q).getByRole('button',{name:'Manage Suggestion',exact:true})).toHaveCount(0);
    await modal(p).getByRole('button',{name:'Manage Suggestion',exact:true}).click();await p.getByLabel('ROADMAP STATUS',{exact:true}).selectOption('planned');await p.getByLabel('OFFICIAL RESPONSE',{exact:true}).fill('We are organizing the first event.');await p.getByRole('checkbox',{name:'Pin suggestion',exact:true}).check();await p.getByRole('button',{name:'Save Suggestion Decision',exact:true}).click();
    await expect(modal(r)).toContainText('We are organizing the first event.');await p.screenshot({path:'test-results/voxora37-suggestion.png',fullPage:true});
    await modal(r).getByRole('button',{name:'Back to Suggestions',exact:true}).click();await modal(r).getByRole('button',{name:'Community Updates',exact:true}).click();await expect(modal(r)).toContainText('Roadmap / official response updated');await modal(r).getByRole('button',{name:'Mark Community Updates Read',exact:true}).click();
    await modal(q).getByRole('button',{name:'Back to Suggestions',exact:true}).click();await modal(q).getByRole('button',{name:'Community Roadmap',exact:true}).click();await expect(modal(q).locator('.voices-roadmap-column').filter({has:q.getByRole('heading',{name:'Planned',exact:true})})).toContainText('A monthly community game night');
    await q.screenshot({path:'test-results/voxora37-roadmap.png',fullPage:true});
    await modal(p).getByRole('button',{name:'Manage Suggestion',exact:true}).click();await p.getByRole('checkbox',{name:'Lock voting and discussion',exact:true}).check();await p.getByRole('button',{name:'Save Suggestion Decision',exact:true}).click();
    await modal(r).getByRole('button',{name:'Open Suggestion',exact:true}).first().click();await expect(modal(r).getByRole('button',{name:'Add Comment',exact:true})).toHaveCount(0);await expect(modal(r).getByRole('button',{name:'Withdraw Vote',exact:true})).toBeEnabled();
  }finally{await oc?.close();await mc?.close();await nc?.close();await a.f.cleanup();}
});

for(const width of[390,1440])test('all six Plus server profile options render and revert after revocation at '+width+'px',async({browser})=>{
  test.setTimeout(90000);const a=await lab();let mc,nc;
  try{
    const{f,o,m,n,s,base}=a,info=(await f.call(m,'/premium/me')).data;await f.call(o,'/platform/premium/members/'+m.id,'PATCH',{version:info.version,days:null,reason:'Profile browser test'});
    const member=await signedIn(browser,f,m,width),friend=await signedIn(browser,f,n,width);mc=member.context;nc=friend.context;const p=member.page,q=friend.page;
    await serverTool(p,s,'Community Voices');await modal(p).getByRole('button',{name:'My Server Profile',exact:true}).click();await modal(p).getByRole('button',{name:'Style Server Profile · Plus',exact:true}).click();
    await p.getByLabel('PROFILE ACCENT',{exact:true}).fill('#aaffdd');await p.getByLabel('BANNER START',{exact:true}).fill('#142345');await p.getByLabel('BANNER END',{exact:true}).fill('#234567');await p.getByLabel('SERVER HEADLINE',{exact:true}).fill('Building worlds together');await p.getByLabel('COMMUNITY TITLE',{exact:true}).fill('World builder');await p.getByLabel('BANNER PATTERN',{exact:true}).selectOption('dots');await p.getByLabel('PROFILE LINKS — ONE LABEL | URL PER LINE',{exact:true}).fill('Portfolio | https://example.com/portfolio');
    await p.getByRole('button',{name:'Save Server Profile Style',exact:true}).click();await expect(modal(p)).toContainText('Building worlds together');await expect(modal(p).getByRole('link',{name:'Portfolio',exact:true})).toHaveAttribute('href','https://example.com/portfolio');
    expect(await modal(p).evaluate(e=>e.scrollWidth<=e.clientWidth+2)).toBe(true);await p.screenshot({path:'test-results/voxora37-plus-profile-'+width+'.png',fullPage:true});
    await serverTool(q,s,'Community Voices');await q.getByRole('textbox',{name:'Search community profiles',exact:true}).fill('voices_ui_member');await modal(q).getByRole('button',{name:'Search Profiles',exact:true}).click();await modal(q).getByRole('button',{name:'View Server Profile',exact:true}).click();await expect(modal(q)).toContainText('World builder');
    await modal(p).getByRole('button',{name:'Style Server Profile · Plus',exact:true}).click();await p.getByLabel('SERVER HEADLINE',{exact:true}).fill('Unsaved style draft');
    const current=(await f.call(m,'/premium/me')).data;await f.call(o,'/platform/premium/members/'+m.id,'PATCH',{version:current.version,revoke:true,reason:'Profile expiry test'});
    await expect(modal(p)).not.toBeVisible();await expect(modal(q)).not.toContainText('World builder');await expect(modal(q)).not.toContainText('Building worlds together');
    expect((await f.call(m,base+'/profiles/me')).data.storedStyle.headline).toBe('Building worlds together');
  }finally{await mc?.close();await nc?.close();await a.f.cleanup();}
});

test('channel revocation closes a suggestion draft and member-profile reset works from the directory',async({browser})=>{
  const a=await lab();let oc,mc;
  try{
    const{f,o,m,s,ch,base}=a,t=(await f.call(m,base+'/suggestions','POST',{title:'Draft access test',channelId:ch,nonce:crypto.randomUUID()})).data;
    await f.call(m,base+'/profiles/me','PATCH',{revision:0,bio:'Server-specific introduction',interests:['music']});
    const owner=await signedIn(browser,f,o),member=await signedIn(browser,f,m);oc=owner.context;mc=member.context;const p=owner.page,q=member.page;
    await serverTool(q,s,'Suggestion Board');await modal(q).getByRole('button',{name:'Open Suggestion',exact:true}).click();await modal(q).getByRole('button',{name:'Edit Suggestion',exact:true}).click();await q.getByLabel('SUGGESTION DETAILS',{exact:true}).fill('An unsaved private draft.');
    await f.call(o,'/channels/'+ch,'PATCH',{overwrites:[{type:'member',id:m.id,allow:[],deny:['viewChannel']}]});await expect(modal(q)).not.toBeVisible();expect((await f.call(m,base+'/suggestions/'+t.id)).status).toBe(404);
    await serverTool(p,s,'Community Voices');await p.getByRole('textbox',{name:'Search community profiles',exact:true}).fill('voices_ui_member');await modal(p).getByRole('button',{name:'Search Profiles',exact:true}).click();await modal(p).getByRole('button',{name:'View Server Profile',exact:true}).click();await expect(modal(p)).toContainText('Server-specific introduction');
    await modal(p).getByRole('button',{name:'Reset Member Server Profile',exact:true}).click();await modal(p).getByRole('button',{name:'Confirm',exact:true}).click();await expect(modal(p)).not.toContainText('Server-specific introduction');
  }finally{await oc?.close();await mc?.close();await a.f.cleanup();}
});
