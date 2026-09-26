// Service worker — precache the app shell for offline use, then serve
// network-first with cache fallback so deploys show up on the next load
// while the fire still burns with no connection at all.
//
// Bump CACHE on any deploy that changes cached files — but NOT per change on
// a feature branch. It is held at v8 for all of 1.1.0 and advances once, on
// the merge to master: nothing here reaches a visitor until that deploy, so
// intermediate numbers would only burn cache generations for builds nobody
// ever fetched.
const CACHE = "fireside-v8"; // v8 = the 1.1.0 shell (animated POST, hearth-glow art, portrait layout, donation links)

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/main.js",
  "js/boot.js",
  "js/constants.js",
  "js/palettes.js",
  "js/fire.js",
  "js/crt.js",
  "js/hud.js",
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
  "qr/venmo.png",
  "qr/square.png",
  "splash.png",
  "favicon.ico",
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
