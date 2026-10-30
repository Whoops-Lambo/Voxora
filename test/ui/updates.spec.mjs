import { test, expect } from '@playwright/test';
import { fixture } from '../support/server.mjs';
async function register(page, name) {
  await page.goto('/app'); await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.getByLabel('DISPLAY NAME').fill(name); await page.getByLabel('USERNAME').fill(name); await page.getByLabel('PASSWORD').fill('Fixture-password-489'); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#message-input')).toBeVisible();
}
async function desktop(context) {
  await context.addInitScript(() => {
    const listeners = new Set();
    let state = { currentVersion: '2.8.0', availableVersion: null, supported: true, phase: 'idle', progress: 0, autoDownload: false, notes: '', error: null, lastChecked: null };
    const bridge = window.updateFixture = { checks: 0, installs: 0, listeners };
    const emit = () => { for (const callback of listeners) callback({ ...state }); };
    window.voxoraDesktop = {
      getUpdateState: async () => ({ ...state }), onUpdate: fn => { listeners.add(fn); return () => listeners.delete(fn); },
      checkForUpdates: async () => { bridge.checks++; state = { ...state, availableVersion: '2.9.0', phase: 'available', notes: 'New community tools and fixes.', lastChecked: Date.now() }; emit(); return { ...state }; },
      downloadUpdate: () => new Promise(resolve => { state.phase = 'downloading'; state.progress = 35; emit(); bridge.finish = () => { state.phase = 'ready'; state.progress = 100; emit(); resolve({ ...state }); }; }),
      installUpdate: async () => { bridge.installs++; return { ...state }; },
      setUpdateSettings: async value => { state.autoDownload = value.autoDownload; emit(); return { ...state }; },
    };
  });
}
test('desktop update settings show checks, progress, restart choice and preferences; browsers explain backend upgrades', async ({ browser }) => {
  const f = await fixture(), context = await browser.newContext({ baseURL: f.origin }); await desktop(context); const page = await context.newPage(); let web;
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await register(page, 'update_ui_owner'); await page.getByRole('button', { name: 'User Settings', exact: true }).click(); await page.locator('#modal').getByRole('button', { name: 'Updates', exact: true }).click();
    await expect(page.locator('#modal .connection-tag')).toContainText('Voxora 2.8.0');
    await page.getByRole('button', { name: 'Check for Updates', exact: true }).click(); await expect(page.locator('#modal')).toContainText('Version 2.9.0 is available');
    await page.getByRole('button', { name: 'Download Update', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Update download progress' })).toHaveAttribute('value', '35');
    await expect(page.getByRole('button', { name: 'Check for Updates', exact: true })).toBeDisabled();
    await page.evaluate(() => window.updateFixture.finish()); await expect(page.getByRole('button', { name: 'Restart and Install', exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Download updates automatically', exact: true }).check();
    await page.screenshot({ path: 'test-results/voxora-desktop-updates.png', fullPage: true });
    await page.getByRole('button', { name: 'Restart and Install', exact: true }).click(); expect(await page.evaluate(() => window.updateFixture.installs)).toBe(1);
    await page.locator('#modal').getByRole('button', { name: 'Appearance', exact: true }).click(); await expect.poll(() => page.evaluate(() => window.updateFixture.listeners.size)).toBe(0);
    web = await browser.newContext({ baseURL: f.origin }); await web.addCookies(await context.cookies()); const browserPage = await web.newPage(); await browserPage.goto('/app'); await browserPage.getByRole('button', { name: 'User Settings', exact: true }).click(); await browserPage.locator('#modal').getByRole('button', { name: 'Updates', exact: true }).click();
    await expect(browserPage.locator('#modal')).toContainText('Automatic updates are available in the Windows desktop app'); expect(errors).toEqual([]);
  } finally { await context.close(); await web?.close(); await f.cleanup(); }
});
test('platform owner can notify connected desktop apps to check the official release feed', async ({ browser }) => {
  const f = await fixture(), a = await browser.newContext({ baseURL: f.origin }), b = await browser.newContext({ baseURL: f.origin }); await desktop(b); const owner = await a.newPage(), member = await b.newPage();
  try {
    await register(owner, 'push_ui_owner'); await register(member, 'push_ui_member'); await owner.goto('/admin'); await owner.getByRole('button', { name: 'Updates', exact: true }).click();
    await expect(owner.locator('.admin-record')).toContainText('This backend runs Voxora 2.10.0');
    await owner.getByRole('button', { name: 'Notify Desktop Clients', exact: true }).click();
    await expect.poll(() => member.evaluate(() => window.updateFixture.checks)).toBe(1); await expect(owner.locator('.admin-record')).toContainText('Last notification:');
    expect((await member.request.post('/api/platform/updates/notify', { data: {} })).status()).toBe(403);
    await owner.screenshot({ path: 'test-results/voxora-update-pusher.png', fullPage: true });
  } finally { await a.close(); await b.close(); await f.cleanup(); }
});
