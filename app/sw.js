// Unregister and clean up — this service worker does nothing except remove itself
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k).catch(() => {}))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
      .catch(e => console.warn('SW cleanup failed:', e))
  );
});
