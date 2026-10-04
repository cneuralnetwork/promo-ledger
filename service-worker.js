const CACHE = "promo-ledger-static-v10";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./src/app.js",
  "./src/db.js",
  "./src/ledger.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icon.svg",
  "./fonts/bricolage-grotesque-700.woff2",
  "./fonts/instrument-sans-400.woff2",
  "./fonts/instrument-sans-600.woff2",
  "./fonts/ibm-plex-mono-500.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith("promo-ledger-static-") && name !== CACHE,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (response.ok)
          (await caches.open(CACHE)).put(event.request, response.clone());
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
