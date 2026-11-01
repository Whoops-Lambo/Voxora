import {test,expect} from '@playwright/test';
import {fixture} from '../support/server.mjs';
import {fileURLToPath} from 'node:url';
async function register(page,name){await page.goto('/app');await page.getByRole('button',{name:'Register',exact:true}).click();await page.getByLabel('DISPLAY NAME').fill(name);await page.getByLabel('USERNAME').fill(name);await page.getByLabel('PASSWORD').fill('Members-test-password-791');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('#message-input')).toBeVisible();}
test('registrations appear live in the shared member list, remain visible offline, and do not receive platform administration',async({browser})=>{
 const f=await fixture(),a=await browser.newContext({baseURL:f.origin}),b=await browser.newContext({baseURL:f.origin}),owner=await a.newPage(),member=await b.newPage();let closed=false;
 try{
  await register(owner,'visible_owner');await register(member,'visible_member');
  await expect(owner.locator('#detail-panel .members-title')).toHaveText('Members · 2');await expect(owner.locator('#detail-panel')).toContainText('visible_member');
  expect((await member.request.get('/api/platform/overview')).status()).toBe(403);
  await member.getByRole('button',{name:'User Settings',exact:true}).click();await expect(member.locator('#modal').getByRole('button',{name:'Platform Admin',exact:true})).toHaveCount(0);await member.locator('#modal-close').click();
  const info=await(await owner.request.get('/api/info')).json(),memberInfo=await(await member.request.get('/api/state')).json();expect(memberInfo.platform.instanceId).toBe(info.instanceId);expect(memberInfo.platform.owner).toBe(false);
  await b.close();closed=true;await expect(owner.locator('#detail-panel .member-row.offline')).toContainText('visible_member');
  await owner.locator('#detail-panel').getByRole('textbox',{name:'Search members'}).fill('visible_member');await expect(owner.locator('#detail-panel .member-row')).toHaveCount(1);
  await owner.screenshot({path:'test-results/voxora-shared-members.png',fullPage:true});
 }finally{await a.close();if(!closed)await b.close();await f.cleanup();}
});
test('the server menu opens a searchable member directory on small screens',async({browser})=>{
 const f=await fixture(),a=await browser.newContext({baseURL:f.origin,viewport:{width:390,height:844}}),b=await browser.newContext({baseURL:f.origin}),owner=await a.newPage(),member=await b.newPage();
 try{
  await register(owner,'mobile_owner');await register(member,'mobile_member');
  await owner.getByRole('button',{name:'Show Channels',exact:true}).click();await owner.locator('#sidebar-top .server-heading').click();await owner.locator('#context-menu').getByRole('button',{name:'Members',exact:true}).click();
  await expect(owner.locator('#modal .members-title')).toHaveText('Members · 2');await owner.locator('#modal').getByRole('textbox',{name:'Search members'}).fill('mobile_member');await expect(owner.locator('#modal .member-row')).toHaveCount(1);await expect(owner.locator('#modal .member-row')).toContainText('mobile_member');
  await owner.screenshot({path:'test-results/voxora-members-mobile.png',fullPage:true});expect(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await a.close().catch(()=>{});await b.close().catch(()=>{});await f.cleanup();}
});
test('desktop connection setup selects a shared address and keeps failed connections separate from private hosting',async({browser})=>{
 const context=await browser.newContext();await context.addInitScript(()=>{window.connectionTest={connect:[],hosts:0};window.voxoraDesktop={getConnectionInfo:async()=>({server:'',hasLocalData:true,message:''}),connect:async url=>{window.connectionTest.connect.push(url);throw Error('Shared server is unavailable. Retry the connection.');},hostPrivateWorkspace:async()=>{window.connectionTest.hosts++;return {cancelled:true};}};});
 const page=await context.newPage();
 try{
  await page.goto('file://'+fileURLToPath(new URL('../../desktop/connection.html',import.meta.url)));
  await expect(page.getByLabel('SERVER ADDRESS')).toHaveValue('');await expect(page.getByRole('button',{name:'Open Local Workspace',exact:true})).toBeVisible();await page.getByText('Connect to a shared server instead',{exact:true}).click();await page.getByLabel('SERVER ADDRESS').fill('https://chat.example.com');await page.getByRole('button',{name:'Connect',exact:true}).click();await expect(page.getByRole('status')).toContainText('Shared server is unavailable');expect(await page.evaluate(()=>window.connectionTest.hosts)).toBe(0);
  await expect(page.locator('#existing')).toBeVisible();await page.getByRole('button',{name:'Open Local Workspace',exact:true}).click();expect(await page.evaluate(()=>window.connectionTest.hosts)).toBe(1);await expect(page.getByRole('button',{name:'Connect',exact:true})).toBeEnabled();
  await page.screenshot({path:'test-results/voxora-connection-setup.png',fullPage:true});
 }finally{await context.close();}
});
