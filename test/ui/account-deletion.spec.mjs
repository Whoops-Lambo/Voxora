import {test, expect} from '@playwright/test';
import {fixture} from '../support/server.mjs';

test('signed-out phone users request deletion and staff privately review it without treating status updates as deletion', async ({browser}) => {
  const f = await fixture(), requester = await browser.newContext({baseURL: f.origin, viewport: {width: 390, height: 844}}), staff = await browser.newContext({baseURL: f.origin});
  const page = await requester.newPage(), admin = await staff.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message)); admin.on('pageerror', error => errors.push(error.message));
  try {
    const owner = await f.register('delete_form_owner'), member = await f.register('delete_form_member');
    const [name, value] = owner.cookie.split('='); await staff.addCookies([{name, value, url: f.origin}]);
    const response = await page.goto('/account-deletion'); expect(response.headers()['x-robots-tag']).toContain('noindex');
    await expect(page.getByRole('heading', {name: 'Request account deletion', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Submit deletion request', exact: true})).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: 'test-results/account-deletion-form-phone.png', fullPage: true});
    await page.getByLabel('Voxora username or user ID *', {exact: true}).fill('delete_form_member');
    await page.getByLabel('Contact email (optional)', {exact: true}).fill('requester@example.test');
    await page.getByLabel('Additional information (optional)', {exact: true}).fill('My request includes <img src=x onerror=alert(1)> as plain text.');
    await page.getByRole('checkbox', {name: /I am requesting deletion of my own account/}).check();
    const sent = page.waitForRequest(request => request.url().endsWith('/api/safety/reports'));
    await page.getByRole('button', {name: 'Submit deletion request', exact: true}).click();
    expect((await (await sent).allHeaders()).cookie).toBeUndefined();
    await expect(page.getByRole('heading', {name: 'Request received', exact: true})).toBeVisible();
    await expect(page.locator('#deletion-receipt')).toContainText('Your account has not been deleted');
    const key = await page.locator('#receipt-key').inputValue(); expect(key).toHaveLength(43); expect(page.url()).not.toContain(key);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const download = page.waitForEvent('download'); await page.getByRole('button', {name: 'Download receipt', exact: true}).click(); expect(await (await download).failure()).toBeNull();
    await admin.goto('/admin'); await admin.getByRole('button', {name: 'Reports', exact: true}).click(); await admin.getByLabel('Report source', {exact: true}).selectOption('deletion');
    await expect(admin.locator('.admin-content')).toContainText('ownership verification required');
    await admin.getByRole('button', {name: 'Review Report', exact: true}).click();
    await expect(admin.locator('#modal')).toContainText('Recording a review status does not delete an account');
    await expect(admin.locator('.report-evidence')).toContainText('requester@example.test'); await expect(admin.locator('#modal img[src=x]')).toHaveCount(0);
    await admin.getByLabel('REPORT STATUS', {exact: true}).selectOption('reviewing'); await admin.getByRole('button', {name: 'Update Report', exact: true}).click();
    await page.getByRole('button', {name: 'Check request status', exact: true}).click(); await expect(page.locator('#lookup-result')).toContainText('Under review'); await expect(page.locator('#lookup-result')).not.toContainText('requester@example.test');
    expect((await f.call(member, '/state')).status).toBe(200);
    await page.screenshot({path: 'test-results/account-deletion-phone.png', fullPage: true}); expect(errors).toEqual([]);
  } finally { await requester.close(); await staff.close(); await f.cleanup(); }
});
