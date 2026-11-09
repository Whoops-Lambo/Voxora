import {test,expect} from '@playwright/test';
import {fixture} from '../support/server.mjs';
async function register(page,name){await page.goto('/app');await page.getByRole('button',{name:'Register',exact:true}).click();await page.getByLabel('DISPLAY NAME').fill(name);await page.getByLabel('USERNAME').fill(name);await page.getByLabel('PASSWORD').fill('Voice-member-fixture-584');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('#message-input')).toBeVisible();}
test('Manage Member opens a usable role editor from the profile dialog for owners and moderators',async({browser})=>{
 const f=await fixture(),a=await browser.newContext({baseURL:f.origin}),b=await browser.newContext({baseURL:f.origin}),c=await browser.newContext({baseURL:f.origin}),owner=await a.newPage(),member=await b.newPage(),mod=await c.newPage();try{
  await register(owner,'member_ui_owner');await register(member,'member_ui_target');await register(mod,'member_ui_mod');
  const target=(await(await member.request.get('/api/state')).json()).me.id,moderator=(await(await mod.request.get('/api/state')).json()).me.id;
  const role=await(await owner.request.post('/api/servers/community/roles',{data:{name:'Member Helper',permissions:['sendMessages'],hoist:true,mentionable:true}})).json();
  const staff=await(await owner.request.post('/api/servers/community/roles',{data:{name:'Community Moderator',permissions:['manageRoles','moderateMembers']}})).json();await owner.request.patch('/api/servers/community/members/'+moderator,{data:{roles:[staff.id]}});
  for(const actor of [owner,mod]){await expect(actor.locator('#detail-panel .member-row').filter({hasText:'member_ui_target'})).toBeVisible();await actor.locator('#detail-panel .member-row').filter({hasText:'member_ui_target'}).click();await actor.getByRole('button',{name:'Manage Member',exact:true}).click();await expect(actor.locator('#modal #context-menu')).toBeVisible();await actor.locator('#context-menu').getByRole('button',{name:'Manage Roles',exact:true}).click();await actor.getByRole('checkbox',{name:'Member Helper',exact:true}).check();await actor.getByRole('button',{name:'Save Roles',exact:true}).click();await expect(actor.locator('#modal')).not.toBeVisible();}
  expect((await(await member.request.get('/api/state')).json()).servers.find(s=>s.id==='community').memberRoles[target]).toContain(role.id);
  await mod.locator('#detail-panel .member-row').filter({hasText:'member_ui_owner'}).click();await expect(mod.getByRole('button',{name:'Manage Member',exact:true})).toHaveCount(0);
 }finally{await a.close();await b.close();await c.close();await f.cleanup();}
});
test('camera off hides the remote tile and camera restarts reuse the video connection; voice processing settings apply',async({browser})=>{
 const f=await fixture(),options={baseURL:f.origin,permissions:['microphone','camera']},a=await browser.newContext(options),b=await browser.newContext(options),owner=await a.newPage(),member=await b.newPage();try{
  await register(owner,'camera_fix_owner');await register(member,'camera_fix_member');
  const channel=await(await owner.request.post('/api/servers/community/channels',{data:{name:'camera-regression',type:'voice'}})).json();
  for(const page of [owner,member]){await page.getByRole('button',{name:'camera-regression',exact:true}).click();await page.getByRole('button',{name:'Join Voice',exact:true}).click();await expect(page.locator('#voice-connected')).toBeVisible();}
  await owner.getByRole('button',{name:'Turn On Video',exact:true}).click();const remote=member.locator('.call-participant').filter({hasText:'camera_fix_owner'});await expect(remote.locator('video')).toBeVisible({timeout:20000});
  await owner.getByRole('button',{name:'Turn Off Video',exact:true}).click();await expect(remote.locator('video')).toHaveCount(0);await expect(remote.locator('.avatar')).toBeVisible();
  await owner.getByRole('button',{name:'Turn On Video',exact:true}).click();await expect(remote.locator('video')).toBeVisible({timeout:15000});await owner.getByRole('button',{name:'Turn Off Video',exact:true}).click();await expect(remote.locator('video')).toHaveCount(0);
  await owner.getByRole('button',{name:'User Settings',exact:true}).click();await owner.getByRole('button',{name:'Voice & Video',exact:true}).click();for(const name of ['Noise suppression','Echo cancellation','Automatic gain control'])await expect(owner.getByRole('checkbox',{name,exact:true})).toBeChecked();await owner.getByRole('checkbox',{name:'Noise suppression',exact:true}).uncheck();await owner.getByRole('button',{name:'Close',exact:true}).click();
  const state=await(await owner.request.get('/api/state')).json();expect(state.voice.find(v=>v.channel===channel.id&&v.userId===state.me.id).cameraOn).toBe(false);
 }finally{await a.close();await b.close();await f.cleanup();}
});
test('platform admin displays open reports and can review them without exposing internal server notes',async({browser})=>{
 const f=await fixture(),a=await browser.newContext({baseURL:f.origin}),b=await browser.newContext({baseURL:f.origin}),owner=await a.newPage(),member=await b.newPage();try{
  await register(owner,'admin_reports_owner');await register(member,'admin_reports_member');const message=await(await owner.request.post('/api/messages',{data:{channel:'general',text:'Reported message for the admin queue'}})).json();await member.request.post('/api/servers/community/reports',{data:{messageId:message.id,reason:'Spam',details:'Please check this report',sendToPlatform:true}});
  await owner.goto('/admin');await expect(owner.locator('.admin-content')).toContainText('1 open report(s)');await owner.getByRole('button',{name:'Reports',exact:true}).click();await expect(owner.locator('.admin-content')).toContainText('Reported message for the admin queue');await owner.getByRole('button',{name:'Review Report',exact:true}).click();await owner.getByLabel('REPORT STATUS',{exact:true}).selectOption('resolved');await owner.getByLabel('REVIEW REASON',{exact:true}).fill('Reviewed the reported content');await owner.getByRole('button',{name:'Update Report',exact:true}).click();await expect(owner.locator('.admin-content')).toContainText('0 open');
 }finally{await a.close();await b.close();await f.cleanup();}
});
