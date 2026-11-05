// Online-only dispatch: never cache accounts, QR contents, API responses or scans.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.mode === "navigate") event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>AROMAZEN offline</title><h1>Connection unavailable</h1><p>Reconnect before dispatching. No offline scans are accepted.</p><button onclick="location.reload()">Try again</button>', {headers:{"Content-Type":"text/html"}})));
});
