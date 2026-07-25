/* Breathless service worker — offline-first cache.
   Bump CACHE whenever index.html (or any precached asset) changes, or
   returning users keep the previous version one visit longer than needed. */
const CACHE = "breathless-v1";
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  if (sameOrigin) {
    // stale-while-revalidate: serve the cached app instantly, refresh the
    // cache in the background so an updated index.html lands on the next visit
    e.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then((cached) => {
          const refresh = fetch(req)
            .then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; })
            .catch(() => cached);
          return cached || refresh;
        })
      )
    );
  } else {
    // cross-origin (Google Fonts): cache-first; opaque responses are fine.
    // Offline with a cold cache this rejects and the page's system-ui font
    // fallback takes over.
    e.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then((cached) =>
          cached || fetch(req).then((res) => { c.put(req, res.clone()); return res; })
        )
      )
    );
  }
});
