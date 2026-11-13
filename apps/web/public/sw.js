// No auction data, requests, credentials or mutations are cached or queued.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{event.respondWith(fetch(event.request))});
