import {test,expect} from '@playwright/test';
import {fixture} from '../support/server.mjs';
test('phone installation has correct metadata, public downloads and an offline page without caching account data',async({browser})=>{
 const f=await fixture(),context=await browser.newContext({baseURL:f.origin,viewport:{width:390,height:844},serviceWorkers:'allow'}),page=await context.newPage();
 try{
  await page.goto('/install');await expect(page.getByRole('heading',{name:'iPhone — install directly',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Download Android APK',exact:true})).toHaveAttribute('href',/Whoops-Lambo\/Voxora\/raw\/refs\/heads\/main\/mobile-releases\/Voxora-Android-3\.3\.0\.apk$/);
  await expect(page.getByRole('link',{name:'Download iOS IPA',exact:true})).toHaveAttribute('href',/-unsigned\.ipa$/);
  const response=await page.request.get('/manifest.webmanifest');expect(response.headers()['content-type']).toContain('application/manifest+json');const manifest=await response.json();expect(manifest.name).toBe('Voxora');expect(manifest.start_url).toBe('/app');expect(manifest.display).toBe('standalone');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  expect((await page.request.get('/api/state')).status()).toBe(401);
  expect(await page.evaluate(async()=>!!await caches.match('/api/state'))).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await context.setOffline(true);await page.goto('/app');await expect(page.getByRole('heading',{name:"Let's reconnect.",exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Try Voxora again',exact:true})).toHaveAttribute('href','/app');
  expect(await page.locator('img').evaluate(image=>image.complete&&image.naturalWidth===256)).toBe(true);
  await context.setOffline(false);await page.getByRole('link',{name:'Try Voxora again',exact:true}).click();await expect(page.getByRole('button',{name:'Log In',exact:true})).toBeVisible();
 }finally{await context.close();await f.cleanup();}
});
