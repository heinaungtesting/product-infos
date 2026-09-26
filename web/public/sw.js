/*
 * Shell-only service worker.
 * Caches ONLY hashed build assets, icons and the offline page. Pages, API
 * responses, RSC payloads and chat never enter the cache: nothing personal is
 * stored on the phone, and nothing stale is ever shown as current.
 */
const CACHE = "job-os-shell-v2";
const SHELL = ["/offline.html", "/icons/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isShellAsset(url) {
  return url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || SHELL.includes(url.pathname));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate") {
    // Always live. If the network is down, show the static offline page — never a cached page.
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  if (isShellAsset(url)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
  }
  // Everything else (API, RSC, pages) goes straight to the network, uncached.
});
