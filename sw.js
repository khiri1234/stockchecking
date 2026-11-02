/* Installable web app: keeps a copy of the app on the device so it opens
 * without signal. Counts made offline are kept by Firebase and sent later;
 * this file only caches the app's own files and the libraries it loads.
 *
 * - The app's pages and scripts: the network first (always the newest
 *   version when online), the saved copy when offline.
 * - Libraries from CDNs (Firebase, Excel, barcode reader, fonts): the saved
 *   copy straight away, refreshed in the background.
 * - Everything else (the database, sign-in) is never touched. */
var CACHE = "hstock-app-v1";
var APP_FILES = [
  "./", "./index.html", "./dashboard.html", "./common.js", "./app-icon.png", "./logo.png",
  "./manifest.webmanifest", "./dashboard.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"
];
var LIBRARY_HOSTS = ["www.gstatic.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return Promise.all(APP_FILES.map(function (url) { return cache.add(url).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isLibrary(url) {
  if (LIBRARY_HOSTS.indexOf(url.hostname) < 0) return false;
  return url.hostname !== "www.gstatic.com" || url.pathname.indexOf("/firebasejs/") === 0;
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(fetch(req).then(function (res) {
      // One saved copy per file: common.js?v=... is kept as common.js
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(url.origin + url.pathname, copy); }); }
      return res;
    }).catch(function () {
      // Offline: the saved copy (common.js?v=... matches common.js), or the app's page
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match(url.pathname.indexOf("dashboard") >= 0 ? "./dashboard.html" : "./index.html");
        return Response.error();
      });
    }));
    return;
  }

  if (isLibrary(url)) {
    event.respondWith(caches.open(CACHE).then(function (cache) {
      return cache.match(req).then(function (hit) {
        var fresh = fetch(req).then(function (res) {
          if (res.ok || res.type === "opaque") cache.put(req, res.clone());
          return res;
        });
        if (hit) { fresh.catch(function () {}); return hit; }
        return fresh;
      });
    }));
  }
  // anything else: not handled here (the browser fetches it as usual)
});
