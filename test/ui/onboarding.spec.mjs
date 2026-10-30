import { test, expect } from '@playwright/test';
import { fixture } from '../support/server.mjs';
async function register(page, name) {
  await page.goto('/app'); await page.getByRole('button', { name: 'Register', exact: true }).click(); await page.getByLabel('DISPLAY NAME').fill(name); await page.getByLabel('USERNAME').fill(name); await page.getByLabel('PASSWORD').fill('Fixture-password-349'); await page.getByRole('button', { name: 'Continue', exact: true }).click(); await expect(page.locator('#message-input')).toBeVisible();
}
async function select(page, server) { await page.locator('#server-rail').getByRole('button', { name: server.name, exact: true }).click(); }
async function serverMenu(page, label) { await page.locator('#sidebar-top .server-heading').click(); await page.locator('#context-menu').getByRole('button', { name: label, exact: true }).click(); }
test('configure a welcome guide, accept rules, choose a channel role and revoke it safely in an open guide', async ({ browser }) => {
  const f=await fixture(), a=await browser.newContext({baseURL:f.origin}), b=await browser.newContext({baseURL:f.origin}), owner=await a.newPage(), member=await b.newPage(); const errors=[];owner.on('pageerror',e=>errors.push(e.message));member.on('pageerror',e=>errors.push(e.message));
  try {
    await register(owner,'guide_ui_owner');await register(member,'guide_ui_member');
    const s=await(await owner.request.post('/api/servers',{data:{name:'Your Community'}})).json(),base='/api/servers/'+s.id;
    const interest=await(await owner.request.post(base+'/roles',{data:{name:'Gaming',permissions:[],color:'#57f287'}})).json();await owner.request.post(base+'/roles',{data:{name:'Administrators',permissions:['administrator']}});
    const room=await(await owner.request.post(base+'/channels',{data:{name:'gaming-club',type:'text',private:true}})).json();await owner.request.patch('/api/channels/'+room.id,{data:{overwrites:[{type:'role',id:'everyone',deny:['viewChannel'],allow:[]},{type:'role',id:interest.id,deny:[],allow:['viewChannel']}]}});
    await owner.reload();await select(owner,s);await serverMenu(owner,'Server Settings');await owner.locator('#modal').getByRole('button',{name:'Onboarding',exact:true}).click();
    await owner.getByRole('checkbox',{name:'Show welcome guide to new members',exact:true}).check();await owner.getByLabel('WELCOME TITLE',{exact:true}).fill('Your new home');await owner.getByLabel('WELCOME DESCRIPTION',{exact:true}).fill('Meet people, choose your interests, and get started.');await owner.getByLabel('SERVER RULES (ONE PER LINE, UP TO 10)',{exact:true}).fill('Be kind to each other\nKeep conversations welcoming');await owner.getByRole('checkbox',{name:'Require new members to accept rules',exact:true}).check();
    await owner.getByRole('checkbox',{name:'Recommend general',exact:true}).check();await owner.getByRole('checkbox',{name:'Recommend gaming-club',exact:true}).check();await owner.getByRole('button',{name:'Save Welcome Guide',exact:true}).click();await expect(owner.locator('#toast-stack')).toContainText('Welcome guide saved');
    await expect(owner.getByRole('checkbox',{name:'Offer Administrators',exact:true})).toHaveCount(0);await owner.getByRole('checkbox',{name:'Offer Gaming',exact:true}).check();await owner.getByRole('button',{name:'Save Optional Roles',exact:true}).click();await expect(owner.locator('#toast-stack')).toContainText('Optional roles saved');
    await owner.screenshot({path:'test-results/voxora-onboarding-settings.png',fullPage:true});await owner.locator('#modal-close').click();
    await member.getByRole('button',{name:'Add a Server',exact:true}).click();await member.getByRole('button',{name:'Join a Server',exact:true}).click();await member.getByLabel('INVITE LINK',{exact:true}).fill(s.invite);await member.locator('#modal').getByRole('button',{name:'Join Server',exact:true}).click();
    await expect(member.locator('#modal .onboarding-guide')).toContainText('Your new home');await expect(member.locator('#modal')).toContainText('Be kind to each other');await expect(member.locator('#modal')).not.toContainText('gaming-club');await expect(member.locator('#message-input')).toBeDisabled();
    await member.screenshot({path:'test-results/voxora-server-guide.png',fullPage:true});await member.setViewportSize({width:390,height:844});await member.screenshot({path:'test-results/voxora-server-guide-mobile.png',fullPage:true});expect(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await member.setViewportSize({width:1440,height:900});
    await member.getByRole('checkbox',{name:'Choose Gaming',exact:true}).check();await member.getByRole('checkbox',{name:'I have read and accept the server rules',exact:true}).check();await member.getByRole('button',{name:'Finish Setup',exact:true}).click();
    await expect(member.locator('#modal')).not.toBeVisible();await expect(member.locator('#message-input')).toBeEnabled();await expect(member.locator('#channel-list')).toContainText('gaming-club');
    await member.locator('#message-input').fill('Ready to join the community');await member.locator('#message-input').press('Enter');await expect(owner.locator('#message-list')).toContainText('Ready to join the community');
    await member.reload();await serverMenu(member,'Server Guide');await expect(member.getByRole('checkbox',{name:'Choose Gaming',exact:true})).toBeChecked();await expect(member.locator('#modal')).toContainText('gaming-club');
    await owner.request.patch(base+'/roles/'+interest.id,{data:{permissions:['administrator']}});await expect(member.locator('#modal')).not.toContainText('gaming-club');await expect(member.getByRole('checkbox',{name:'Choose Gaming',exact:true})).toHaveCount(0);
    await expect(member.locator('#toast-stack .error')).toHaveCount(0);expect(errors).toEqual([]);
  } finally {await a.close();await b.close();await f.cleanup();}
});

test('Discovery members can finish the guide even when every channel is initially hidden and unlock a role channel', async ({browser})=>{
  const f=await fixture(),a=await browser.newContext({baseURL:f.origin}),b=await browser.newContext({baseURL:f.origin}),owner=await a.newPage(),member=await b.newPage();
  try {
    await register(owner,'closed_ui_owner');await register(member,'closed_ui_member');const s=await(await owner.request.post('/api/servers',{data:{name:'Choose Your Rooms'}})).json(),base='/api/servers/'+s.id;
    const role=await(await owner.request.post(base+'/roles',{data:{name:'Community Member',permissions:[]}})).json();
    for(const c of s.channels)await owner.request.patch('/api/channels/'+c.id,{data:{overwrites:[{type:'role',id:'everyone',deny:['viewChannel'],allow:[]},...(c.type==='text'?[{type:'role',id:role.id,deny:[],allow:['viewChannel']}]:[])]}});
    await owner.request.patch(base+'/onboarding/settings',{data:{enabled:true,title:'Choose your community',rules:['Respect each other'],requireRules:true,channels:[s.channels[0].id],roleIds:[role.id]}});await owner.request.patch(base+'/discovery',{data:{enabled:true,summary:'A room for everyone',category:'Community'}});
    await member.getByRole('button',{name:'Discover Servers',exact:true}).click();await member.getByLabel('SEARCH PUBLIC SERVERS',{exact:true}).fill(s.name);await member.locator('.community-card').filter({hasText:s.name}).getByRole('button',{name:'Join Server',exact:true}).click();
    await expect(member.locator('#modal .onboarding-guide')).toContainText('Choose your community');await expect(member.locator('#modal')).toContainText('No recommended channels are available');
    await member.getByRole('checkbox',{name:'Choose Community Member',exact:true}).check();await member.getByRole('checkbox',{name:'I have read and accept the server rules',exact:true}).check();await member.getByRole('button',{name:'Finish Setup',exact:true}).click();
    await expect(member.locator('#message-input')).toBeEnabled();await expect(member.locator('#sidebar-top')).toContainText(s.name);await expect(member.locator('#channel-list')).toContainText('general');
  } finally {await a.close();await b.close();await f.cleanup();}
});
