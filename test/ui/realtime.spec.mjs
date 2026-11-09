import { test, expect } from '@playwright/test';
import { fixture } from '../support/server.mjs';

async function register(page, name) {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.getByLabel('DISPLAY NAME').fill(name);
  await page.getByLabel('USERNAME').fill(name);
  await page.getByLabel('PASSWORD').fill('Realtime-fixture-password-841');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#message-input')).toBeVisible();
}

test('blocked live streams still share presence, messages and friend requests without reloading', async ({ browser }) => {
  const f = await fixture(), a = await browser.newContext({ baseURL: f.origin }), b = await browser.newContext({ baseURL: f.origin });
  await a.route('**/api/events?*', route => route.abort());
  await b.route('**/api/events?*', route => route.abort());
  const owner = await a.newPage(), member = await b.newPage();
  try {
    await register(owner, 'sync_owner');
    await register(member, 'sync_member');
    await owner.locator('#message-input').fill('Keep this unsent draft');
    await member.locator('#message-input').fill('Message delivered through fallback');
    await member.locator('#message-input').press('Enter');
    await expect(owner.locator('#message-list')).toContainText('Message delivered through fallback', { timeout: 12000 });
    await expect(owner.locator('#message-input')).toHaveValue('Keep this unsent draft');
    await expect(owner.locator('#detail-panel .member-row').filter({hasText:'sync_member'})).not.toHaveClass(/offline/);
    await owner.locator('.app-chats').click();
    await owner.getByRole('button', { name: /^Pending/ }).click();
    expect((await member.request.post('/api/friends/request', { data: { username: 'sync_owner' } })).status()).toBe(201);
    await expect(owner.locator('#friends-view')).toContainText('sync_member', { timeout: 12000 });
    await owner.getByRole('button', { name: 'Accept', exact: true }).click();
    await owner.getByRole('button', { name: 'All', exact: true }).click();
    await expect(owner.locator('#friends-view .friend-row')).toContainText('sync_member');
  } finally { await a.close(); await b.close(); await f.cleanup(); }
});

test('reconnection catches up missed messages, edits and deletions while preserving the composer draft', async ({ browser }) => {
  const f=await fixture(),a=await browser.newContext({baseURL:f.origin}),b=await browser.newContext({baseURL:f.origin}),owner=await a.newPage(),member=await b.newPage();
  try{
    await register(owner,'reconnect_owner');await register(member,'reconnect_member');
    const first=await(await member.request.post('/api/messages',{data:{channel:'general',text:'Before the connection dropped'}})).json();
    const removed=await(await member.request.post('/api/messages',{data:{channel:'general',text:'This message will be deleted'}})).json();
    await expect(owner.locator('#message-list')).toContainText('This message will be deleted');
    await owner.locator('#message-input').fill('Draft stays during reconnect');
    await a.setOffline(true);
    await member.request.patch('/api/messages/'+first.id,{data:{text:'Edited during disconnect'}});
    await member.request.delete('/api/messages/'+removed.id);
    await member.request.post('/api/messages',{data:{channel:'general',text:'Arrived during disconnect'}});
    await a.setOffline(false);
    await expect(owner.locator('#message-list')).toContainText('Arrived during disconnect',{timeout:12000});
    await expect(owner.locator('#message-list')).toContainText('Edited during disconnect');
    await expect(owner.locator('#message-list')).not.toContainText('This message will be deleted');
    await expect(owner.locator('#message-input')).toHaveValue('Draft stays during reconnect');
    await expect(owner.getByRole('button',{name:'Connection status',exact:true})).toHaveAttribute('data-phase','live');
  }finally{await a.close();await b.close();await f.cleanup();}
});

test('fallback stops and returns to sign-in when its session is revoked',async({browser})=>{
  const f=await fixture(),context=await browser.newContext({baseURL:f.origin});await context.route('**/api/events?*',route=>route.abort());const page=await context.newPage();
  try{await register(page,'revoked_sync_member');await expect(page.getByRole('button',{name:'Connection status',exact:true})).toHaveAttribute('data-phase','fallback');await page.request.post('/api/auth/logout',{data:{}});await expect(page.getByRole('button',{name:'Log In',exact:true})).toBeVisible({timeout:12000});await expect(page.locator('#shell')).toBeHidden();await expect(page.locator('#auth-error')).toContainText('session expired');}finally{await context.close();await f.cleanup();}
});
