import {test, expect} from '@playwright/test';
import {fixture} from '../support/server.mjs';

test('members read the public privacy policy inside settings on desktop and phone', async ({browser}) => {
  const f = await fixture(), context = await browser.newContext({baseURL: f.origin}), page = await context.newPage();
  try {
    await context.request.post('/api/auth/register', {data: {username: 'privacy_reader', password: 'Fixture-password-947'}});
    const canonical = await (await context.request.get('/privacy')).text();
    await page.goto('/app');
    await page.getByRole('button', {name: 'User Settings', exact: true}).click();
    await page.getByRole('button', {name: 'Privacy Policy', exact: true}).click();
    const policy = page.getByRole('article', {name: 'Privacy Policy', exact: true});
    await expect(policy).toContainText('November 22, 2026');
    await expect(policy).toContainText('conversations are not end-to-end encrypted');
    await expect(policy).toContainText('up to 90 days');
    const headings = await policy.locator('h2').allTextContents();
    expect(headings).toHaveLength(10);
    for (const heading of headings) expect(canonical).toContain(heading);
    await expect(page.getByRole('link', {name: 'Open Public Privacy Policy'})).toHaveAttribute('href', '/privacy');
    expect(new URL(page.url()).pathname).toBe('/app');
    await page.setViewportSize({width: 390, height: 844});
    await expect(policy).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: 'test-results/privacy-policy-phone.png', fullPage: true});
    await page.getByRole('button', {name: 'Privacy & Safety', exact: true}).click();
    await page.getByRole('button', {name: 'Read Privacy Policy', exact: true}).click();
    await expect(page.getByRole('article', {name: 'Privacy Policy'})).toContainText('Accounts and conversations');
  } finally { await context.close(); await f.cleanup(); }
});

test('privacy settings keep an accessible public link when the policy fails to load', async ({browser}) => {
  const f = await fixture(), context = await browser.newContext({baseURL: f.origin}), page = await context.newPage();
  try {
    await context.request.post('/api/auth/register', {data: {username: 'privacy_offline', password: 'Fixture-password-947'}});
    await page.goto('/app');
    await page.route('**/privacy', route => route.fulfill({status: 503, body: 'Unavailable'}));
    await page.getByRole('button', {name: 'User Settings', exact: true}).click();
    await page.getByRole('button', {name: 'Privacy Policy', exact: true}).click();
    await expect(page.getByRole('article', {name: 'Privacy Policy'})).toContainText('could not load');
    await expect(page.getByRole('link', {name: 'Open Public Privacy Policy'})).toBeVisible();
  } finally { await context.close(); await f.cleanup(); }
});
