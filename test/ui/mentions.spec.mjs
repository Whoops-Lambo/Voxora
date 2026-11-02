import {test,expect} from '@playwright/test';
import {fixture} from '../support/server.mjs';
async function register(page,name){await page.goto('/app');await page.getByRole('button',{name:'Register',exact:true}).click();await page.getByLabel('DISPLAY NAME').fill(name);await page.getByLabel('USERNAME').fill(name);await page.getByLabel('PASSWORD').fill('Mention-ui-password-965');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('#message-input')).toBeVisible();}
test('mention picker selects with the keyboard and personal and role pings populate badges, Inbox and highlights',async({browser})=>{
 const f=await fixture(),a=await browser.newContext({baseURL:f.origin}),b=await browser.newContext({baseURL:f.origin}),owner=await a.newPage(),member=await b.newPage(),errors=[];
 for(const page of[owner,member])page.on('pageerror',e=>errors.push(e.message));
 try{
  await register(owner,'ping_ui_owner');await register(member,'ping_ui_member');await member.getByRole('button',{name:'Direct Messages',exact:true}).click();
  const input=owner.locator('#message-input');await input.fill('Hello @ping_ui_mem');await expect(owner.getByRole('option',{name:'Mention @ping_ui_member',exact:true})).toBeVisible();await input.press('Enter');await expect(input).toHaveValue('Hello @ping_ui_member ');await expect(owner.locator('#mention-picker')).not.toBeVisible();await input.press('Enter');
  await expect(owner.locator('.message-text .mention').filter({hasText:'@ping_ui_member'})).toBeVisible();await expect(member.locator('.rail-mention-badge')).toHaveText('1');
  await member.getByRole('button',{name:'Inbox',exact:true}).click();await expect(member.locator('#detail-panel .result-card')).toContainText('Hello @ping_ui_member');await member.getByRole('button',{name:'Open message from ping_ui_owner',exact:true}).click();await expect(member.locator('.message-row.mentioned')).toContainText('Hello');
  await member.getByRole('button',{name:'Direct Messages',exact:true}).click();
  const role=await(await owner.request.post('/api/servers/community/roles',{data:{name:'Launch Crew',mentionable:true}})).json(),me=(await(await member.request.get('/api/state')).json()).me.id;await owner.request.patch('/api/servers/community/members/'+me,{data:{roles:[role.id]}});
  await input.fill('Calling @Launch');await owner.getByRole('option',{name:'Mention @Launch Crew',exact:true}).click();await expect(input).toHaveValue('Calling @{Launch Crew} ');await input.press('Enter');await expect(member.locator('.rail-mention-badge')).toHaveText('1');await member.getByRole('button',{name:'Inbox',exact:true}).click();await expect(member.locator('#detail-panel .result-card').filter({hasText:'Calling'})).toContainText('Calling @Launch Crew');
  await input.fill('@');await expect(owner.getByRole('option',{name:'Mention @everyone',exact:true})).toBeVisible();await owner.screenshot({path:'test-results/voxora-mention-picker.png',fullPage:true});await input.press('Escape');expect(errors).toEqual([]);
 }finally{await a.close();await b.close();await f.cleanup();}
});
test('role mention settings control mobile suggestions and unauthorized everyone pings report a clear error',async({browser})=>{
 const f=await fixture(),a=await browser.newContext({baseURL:f.origin}),b=await browser.newContext({baseURL:f.origin,viewport:{width:390,height:844}}),owner=await a.newPage(),member=await b.newPage();
 try{
  await register(owner,'ping_settings_owner');await register(member,'ping_mobile_member');
  await owner.locator('#sidebar-top .server-heading').click();await owner.locator('#context-menu').getByRole('button',{name:'Server Settings',exact:true}).click();await owner.getByRole('button',{name:'Configure Roles',exact:true}).click();await owner.getByRole('button',{name:'Create Role',exact:true}).click();await owner.getByLabel('ROLE NAME',{exact:true}).fill('Public Crew');await owner.getByRole('checkbox',{name:'Allow anyone to mention this role',exact:true}).check();await owner.getByRole('button',{name:'Create Role',exact:true}).click();await expect(owner.getByRole('heading',{name:'EDIT ROLE — Public Crew',exact:true})).toBeVisible();await expect(owner.getByRole('checkbox',{name:'Allow anyone to mention this role',exact:true})).toBeChecked();
  const input=member.locator('#message-input');await input.fill('@Public');await expect(member.getByRole('option',{name:'Mention @Public Crew',exact:true})).toBeVisible();await input.press('Tab');await expect(input).toHaveValue('@{Public Crew} ');await input.fill('@ever');await expect(member.getByRole('option',{name:'Mention @everyone',exact:true})).toHaveCount(0);await input.press('Escape');await input.fill('@everyone test');await input.press('Enter');await expect(member.locator('.toast.error')).toContainText('Mention Everyone & Roles');await expect(input).toHaveValue('@everyone test');
 }finally{await a.close();await b.close();await f.cleanup();}
});
