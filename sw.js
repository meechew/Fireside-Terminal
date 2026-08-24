// Service worker — precache the app shell for offline use, then serve
// network-first with cache fallback so deploys show up on the next load
// while the fire still burns with no connection at all.
//
// Bump CACHE on any deploy that changes cached files.
const CACHE = "fireside-v3";

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/main.js",
  "js/constants.js",
  "js/palettes.js",
  "js/fire.js",
  "js/crt.js",
  "js/audio.js",
  "js/songs.js",
  "js/platform.js",
  "js/donate.js",
  "js/audio/fireside-processor.js",
  "fonts/LessPerfectDOSVGA.ttf",
  "qr/btc.png",
  "qr/eth.png",
  "qr/xrp.png",
  "qr/paypal.png",
  "splash.png",
  "icons/favicon-48.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
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
  const { request } = e;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
