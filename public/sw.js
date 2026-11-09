const CACHE = 'voxora-install-3.3.0';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html', '/voxora-icon.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('voxora-install-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  // Accounts, API responses, messages, attachments and application code are never cached.
  const url=new URL(event.request.url);
  if(url.origin===self.location.origin&&url.pathname==='/voxora-icon.png'&&event.request.method==='GET')event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
  else if (event.request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  }
});
