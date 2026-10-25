// Caches the app shell so the page itself loads with no signal when
// offline. API calls are never cached here — store.js/api.js own the
// offline data story. Network-first: a staff member who is online always
// gets the current shell immediately (important right after we ship a fix),
// and only falls back to the cached copy when the network fetch fails —
// i.e. genuinely offline in the field.
const CACHE = "sir-audit-hyd-v8";
const SHELL = ["/", "/civic.css", "/js/store.js", "/js/api.js", "/js/app.js", "/js/worklist-configs.js", "/js/worklist-tab.js", "/js/asddo-list.js", "/js/draftsir-list.js", "/js/reverify-dashboard.js", "/js/search-all.js", "/js/ph-followup-tab.js", "/js/okhla-tab.js", "/js/okhla-offline.js", "/js/okhla-house.js", "/js/okhla-hearing.js", "/js/okhla-changes.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // never cache API responses
  // The public dashboard at /live/ is live data by definition. This worker has
  // scope "/", so without this line a staff member with the PWA installed
  // would have /live/data written into the shell cache and could be shown
  // stale figures offline with nothing indicating they were stale.
  if (url.pathname.startsWith("/live/")) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((cache) => cache.put(event.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
