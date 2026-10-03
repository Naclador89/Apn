// Breathless service worker — lets the installed app run offline.
//
// Stale-while-revalidate for the app's own files: every request is answered
// from the cache immediately (if present) while a fresh copy is fetched in the
// background, so a new version of index.html shows up on the next launch
// without any version bookkeeping. Bump CACHE only to force-drop old entries.
// Only registered when served over http(s) — not when index.html is opened
// as a file (see the registration at the end of index.html).
const CACHE = "breathless-v1";
const CORE = [
  "./", "index.html", "manifest.webmanifest",
  "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png",
  "fonts/inter-latin.woff2", "fonts/space-grotesk-latin.woff2",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req)
      .then(res => { if(res && res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => cached);
    if(cached){ e.waitUntil(fresh); return cached; }
    return fresh;
  }));
});
