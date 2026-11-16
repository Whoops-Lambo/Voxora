import {test,expect} from '@playwright/test';
test('install economy and music templates, see replies, and archive a channel',async({page})=>{
 await page.goto('/app');await page.getByRole('button',{name:'Register',exact:true}).click();
 await page.getByLabel('DISPLAY NAME').fill('Template Admin');await page.getByLabel('USERNAME').fill('templates_ui_admin');await page.getByLabel('PASSWORD').fill('Fixture-password-936');
 await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('#message-input')).toBeVisible();
 const r=await page.request.post('/api/servers',{data:{name:'Template Showcase'}});expect(r.status()).toBe(201);const server=await r.json(),channel=server.channels.find(c=>c.type==='text');
 await page.getByRole('button',{name:server.name,exact:true}).click();
 async function settings(){await page.locator('#sidebar-top .server-heading').click();await page.getByRole('button',{name:'Server Settings',exact:true}).click();await page.getByRole('button',{name:'Bots & Apps',exact:true}).click();}
 await settings();
 for(const [id,name] of [['voxora-economy','Voxora Economy'],['voxora-music','Voxora Music Queue']]){
  await page.getByRole('button',{name:'Add a Bot',exact:true}).click();await page.getByLabel('CHOOSE A BOT',{exact:true}).selectOption(id);
  if(id==='voxora-music')await expect(page.locator('#modal')).toContainText('Does not stream audio');
  await page.getByRole('button',{name:'Install Bot',exact:true}).click();await expect(page.locator('.bot-card').filter({hasText:name})).toBeVisible();
 }
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.locator('#message-input').fill('/daily');await page.locator('#message-input').press('Enter');
 await expect(page.locator('#message-list')).toContainText('250 credits');
 const play=await page.request.post('/api/commands',{data:{channel:channel.id,applicationId:'voxora-music',name:'play',arguments:'https://example.com/song | Launch music'}});
 expect(play.status()).toBe(201);await expect(page.locator('#message-list')).toContainText('Queued');
 await page.getByRole('button',{name:channel.name,exact:true}).click({button:'right'});await page.getByRole('button',{name:'Channel Settings',exact:true}).click();
 await page.getByRole('button',{name:'Archive Channel',exact:true}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();
 await expect(page.locator('#message-input')).toBeDisabled();
 await page.reload();await expect(page.locator('#topbar')).toContainText('Archived');
 await expect(page.locator('#message-list')).toContainText('250 credits');
});
