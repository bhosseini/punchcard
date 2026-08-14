const CACHE = "punchcard-v2";
const FILES = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k =>
    Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
/* The page itself is network-first, so pushing a new index.html to the repo
   reaches you on the next launch instead of being pinned to a stale cache.
   Everything else is cache-first. Offline still works either way.

   {cache:"no-store"} matters: GitHub Pages serves index.html with
   cache-control max-age=600, and a plain fetch() is allowed to satisfy itself
   from the browser's own HTTP cache. "Network-first" would then still hand back
   a copy up to ten minutes stale — the page looked pinned to an old version even
   though the service worker was doing its job. This forces a real trip out. */
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const isPage = e.request.mode === "navigate" ||
                 e.request.destination === "document" ||
                 e.request.url.endsWith("index.html");
  if (isPage) {
    e.respondWith(
      fetch(e.request, { cache: "no-store" }).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }))
  );
});
