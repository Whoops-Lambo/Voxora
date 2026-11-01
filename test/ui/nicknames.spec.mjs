import {test,expect} from '@playwright/test';
import {fixture} from '../support/server.mjs';
async function register(page,name){await page.goto('/app');await page.getByRole('button',{name:'Register',exact:true}).click();await page.getByLabel('DISPLAY NAME').fill(name);await page.getByLabel('USERNAME').fill(name);await page.getByLabel('PASSWORD').fill('Nickname-ui-password-713');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('#message-input')).toBeVisible();}
test('members choose server nicknames, existing message authors update live, and moderators can reset the name',async({browser})=>{
 const f=await fixture(),a=await browser.newContext({baseURL:f.origin}),b=await browser.newContext({baseURL:f.origin}),owner=await a.newPage(),member=await b.newPage();
 try{
  await register(owner,'nickname_ui_owner');await register(member,'nickname_ui_member');
  const state=await(await member.request.get('/api/state')).json(),channel=state.servers.find(s=>s.id==='community').channels.find(c=>c.type==='text');
  const message=await(await member.request.post('/api/messages',{data:{channel:channel.id,text:'This message keeps its real author.'}})).json();
  await expect(owner.locator('#message-'+message.id+' .message-author')).toHaveText('nickname_ui_member');
  await member.locator('#sidebar-top .server-heading').click();await member.locator('#context-menu').getByRole('button',{name:'Edit Server Nickname',exact:true}).click();await member.getByLabel('SERVER NICKNAME',{exact:true}).fill('Orbit Captain');await member.getByRole('button',{name:'Save Nickname',exact:true}).click();
  await expect(owner.locator('#detail-panel .member-row').filter({hasText:'Orbit Captain'})).toBeVisible();await expect(owner.locator('#message-'+message.id+' .message-author')).toHaveText('Orbit Captain');
  expect((await(await member.request.get('/api/state')).json()).me.displayName).toBe('nickname_ui_member');
  await owner.locator('#detail-panel').getByRole('textbox',{name:'Search members'}).fill('nickname_ui_member');await expect(owner.locator('#detail-panel .member-row')).toHaveCount(1);await expect(owner.locator('#detail-panel .member-row')).toContainText('Orbit Captain');
  await owner.screenshot({path:'test-results/voxora-server-nicknames.png',fullPage:true});
  await owner.locator('#detail-panel .member-row').click({button:'right'});await owner.locator('#context-menu').getByRole('button',{name:'Change Nickname',exact:true}).click();await owner.getByLabel('SERVER NICKNAME',{exact:true}).fill('');await owner.getByLabel('REASON').fill('Member requested a reset');await owner.getByRole('button',{name:'Save Nickname',exact:true}).click();
  await expect(owner.locator('#message-'+message.id+' .message-author')).toHaveText('nickname_ui_member');
 }finally{await a.close();await b.close();await f.cleanup();}
});
test('a nickname can be edited and found in the member directory on a narrow screen',async({browser})=>{
 const f=await fixture(),context=await browser.newContext({baseURL:f.origin,viewport:{width:390,height:844}}),page=await context.newPage();
 try{
  await register(page,'nickname_mobile');await page.getByRole('button',{name:'Show Channels',exact:true}).click();await page.locator('#sidebar-top .server-heading').click();await page.locator('#context-menu').getByRole('button',{name:'Edit Server Nickname',exact:true}).click();await page.getByLabel('SERVER NICKNAME',{exact:true}).fill('Mobile Pilot');await page.getByRole('button',{name:'Save Nickname',exact:true}).click();
  await page.locator('#sidebar-top .server-heading').click();await page.locator('#context-menu').getByRole('button',{name:'Members',exact:true}).click();await page.locator('#modal').getByRole('textbox',{name:'Search members'}).fill('pilot');await expect(page.locator('#modal .member-row')).toContainText('Mobile Pilot');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await context.close();await f.cleanup();}
});
