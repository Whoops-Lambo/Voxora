import {test,expect} from '@playwright/test';
import {fixture} from '../support/server.mjs';
async function setup(browser){
 const f=await fixture({entry:'public-server.js',extraEnv:{VOXORA_OWNER_USERNAME:'platform_owner',VOXORA_OWNER_PASSWORD:'Fixture-owner-password-901'}}),owner=await browser.newContext({baseURL:f.origin}),member=await browser.newContext({baseURL:f.origin});
 expect((await owner.request.post('/api/auth/login',{data:{username:'platform_owner',password:'Fixture-owner-password-901'}})).status()).toBe(200);
 const r=await member.request.post('/api/auth/register',{data:{username:'max_recipient',password:'Fixture-password-987'}});expect(r.status()).toBe(200);const user=(await r.json()).me;
 return{f,owner,member,user,cleanup:async()=>{await owner.close();await member.close();await f.cleanup();}};
}
test('Platform Admin grants Max and boost levels 4–5 through visible controls, with durable entitlements and audit',async({browser})=>{
 const a=await setup(browser),{f,owner,member,user}=a,page=await owner.newPage(),userPage=await member.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));userPage.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('/admin');await page.getByRole('button',{name:'Voxora Max',exact:true}).click();await expect(page.locator('.max-admin-summary')).toContainText('$24.99 USD / month');await expect(page.locator('.max-admin-summary')).toContainText('$149.99 USD / year');
  const row=page.locator('.plus-member').filter({hasText:'@max_recipient'});await row.getByRole('button',{name:'Grant Max',exact:true}).click();await page.getByLabel('MAX DURATION',{exact:true}).selectOption('ongoing');await page.getByLabel('GRANT REASON',{exact:true}).fill('Owner grants the new Max membership');await page.getByRole('button',{name:'Grant Max Access',exact:true}).click();await expect(row).toContainText('Voxora Max');await page.screenshot({path:'test-results/admin-max-grant.png',fullPage:true});
  let info=await(await member.request.get('/api/premium/me')).json();expect(info.plan).toBe('max');expect(info.perks.botApplications).toBe(250);expect(info.perks.botCommands).toBe(1000);expect(info.perks.customThemes).toBe(10);expect(info.perks.groupMembers).toBe(80);
  await userPage.goto('/app');await expect(userPage.locator('#message-input')).toHaveAttribute('maxlength','8000');await userPage.getByRole('button',{name:'User Settings',exact:true}).click();await userPage.getByRole('button',{name:'Voxora Max',exact:true}).click();await expect(userPage.locator('.plus-status')).toContainText('Your Max is active');await userPage.locator('#modal-close').click();
  await userPage.goto('/developers');await expect(userPage.locator('.bot-quota')).toContainText('250 bot applications');await expect(userPage.locator('.bot-quota')).toContainText('1000 commands per bot');
  await page.getByRole('button',{name:'Server Boosts',exact:true}).click();
  for(const [level,emoji,seats,upload,days,featured] of [[4,750,250,150,60,3],[5,1000,500,250,90,10]]){
   await page.getByRole('button',{name:level===4?'Grant Boost Level':'Change Boost Grant',exact:true}).click();await page.getByLabel('BOOST LEVEL',{exact:true}).selectOption(String(level));await expect(page.locator('.boost-grant-perks')).toContainText(emoji+' emoji slots');await expect(page.locator('.boost-grant-perks')).toContainText(seats+' Stage video seats');await expect(page.locator('.boost-grant-perks')).toContainText(featured+' featured store products');
   await page.getByLabel('DURATION UNIT',{exact:true}).selectOption('unlimited');await page.getByLabel('REASON',{exact:true}).fill('Grant requested boost level '+level);await page.locator('#modal').getByRole('button',{name:'Grant Boost Level',exact:true}).click();await expect(page.locator('.admin-record')).toContainText('Granted level '+level);
   const state=await(await member.request.get('/api/state')).json(),boosts=state.servers.find(s=>s.id==='community').boosts;expect(boosts.level).toBe(level);expect(boosts.emojiSlots).toBe(emoji);expect(boosts.uploadBytes).toBe(upload*1048576);expect(boosts.videoStageSeats).toBe(seats);expect(boosts.recoveryDays).toBe(days);expect(boosts.featuredProducts).toBe(featured);
  }
  await page.screenshot({path:'test-results/admin-boost-level-five.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/admin-boost-level-five-phone.png',fullPage:true});
  const audit=await(await owner.request.get('/api/platform/audit')).json();expect(audit.items.some(e=>e.action==='Max access granted')).toBe(true);expect((await member.request.patch('/api/platform/premium/members/'+user.id,{data:{version:info.version,plan:'max',days:null,reason:'Unauthorized self grant'}})).status()).toBe(403);expect((await member.request.patch('/api/platform/server-boosts/community',{data:{version:2,level:5,expiresAt:null,reason:'Unauthorized'}})).status()).toBe(403);
  await f.stop();await f.start();info=await(await member.request.get(f.origin+'/api/premium/me')).json();expect(info.plan).toBe('max');expect((await(await member.request.get(f.origin+'/api/state')).json()).servers.find(s=>s.id==='community').boosts.level).toBe(5);expect(errors).toEqual([]);
 }finally{await a.cleanup();}
});
test('thread transfer navigates to the destination and Server Management exposes existing management tools',async({browser})=>{
 const a=await setup(browser),{owner}=a,page=await owner.newPage();
 try{
  const api=owner.request,source=(await(await api.get('/api/state')).json()).servers[0],destination=await(await api.post('/api/servers/'+source.id+'/channels',{data:{name:'transfer-destination',type:'text'}})).json(),root=await(await api.post('/api/messages',{data:{channel:'general',text:'Discussion to transfer'}})).json(),thread=await(await api.post('/api/threads',{data:{messageId:root.id,name:'Transfer UI discussion'}})).json();
  await page.goto('/app');await page.locator('#sidebar-top .server-heading').click();await page.getByRole('button',{name:'Server Management',exact:true}).click();await expect(page.getByRole('button',{name:'Roles, Permissions & Icons',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Role-Restricted Emojis',exact:true})).toBeVisible();await page.locator('#modal-close').click();
  const row=page.locator('.message-row').filter({hasText:'Discussion to transfer'});await row.getByRole('button',{name:/repl|thread/i}).click();await expect(page.getByRole('button',{name:'Move / Merge Discussion',exact:true})).toBeVisible();await page.getByRole('button',{name:'Move / Merge Discussion',exact:true}).click();await page.getByLabel('DESTINATION CHANNEL',{exact:true}).selectOption(destination.id);await page.getByRole('button',{name:'Transfer Discussion',exact:true}).click();await expect(page.locator('.thread-pane')).toContainText('Transfer UI discussion');await expect(page.getByRole('button',{name:'transfer-destination',exact:true})).toHaveClass(/active/);
 }finally{await a.cleanup();}
});

test('existing public accounts can add and switch accounts through User Settings',async({browser})=>{
 const a=await setup(browser),{owner,user}=a,page=await owner.newPage();try{
  await owner.clearCookies({name:'voxora_accounts'});await page.goto('/app');await page.getByRole('button',{name:'User Settings',exact:true}).click();await expect(page.locator('.settings-content')).toContainText('Account Switcher');
  await page.getByRole('button',{name:'Add Account',exact:true}).click();await page.getByLabel('USERNAME',{exact:true}).fill('max_recipient');await page.getByLabel('PASSWORD',{exact:true}).fill('Fixture-password-987');await page.getByRole('button',{name:'Sign In and Add',exact:true}).click();
  await expect(page.locator('#message-input')).toBeVisible();await expect.poll(async()=>(await(await owner.request.get('/api/state')).json()).me.id).toBe(user.id);
  await page.getByRole('button',{name:'User Settings',exact:true}).click();const first=page.locator('.settings-content .bot-actions').filter({hasText:'@platform_owner'});await first.getByRole('button',{name:'Switch',exact:true}).click();await expect(page.locator('#message-input')).toBeVisible();await expect.poll(async()=>(await(await owner.request.get('/api/state')).json()).me.username).toBe('platform_owner');
 }finally{await a.cleanup();}
});
