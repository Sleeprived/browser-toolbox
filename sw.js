// Service worker for Browser Toolbox.
// Precaches the app's own static assets for offline use. The cache name is
// VERSIONED: bump CACHE_VERSION on each deploy so old caches are purged and
// users receive the new build. Only the app's own assets are cached — no
// third-party requests are ever made.

const CACHE_VERSION = 'v10';
const CACHE_NAME = `browser-toolbox-${CACHE_VERSION}`;

// Paths are relative to the service worker's location (the site root), so this
// works correctly under a GitHub Pages project subpath.
const ASSETS = [
  '.',
  'index.html',
  'qr.html',
  'exif.html',
  'passphrase.html',
  'csv.html',
  'palette.html',
  'cron.html',
  'manifest.webmanifest',
  'assets/css/style.css',
  'src/shared/page.js',
  'src/cron/cron.js',
  'src/cron/cron-ui.js',
  'src/csv/csv.js',
  'src/csv/csv-ui.js',
  'src/passphrase/generate.js',
  'src/passphrase/strength.js',
  'src/passphrase/common-passwords.js',
  'src/passphrase/pass-ui.js',
  'assets/data/eff_wordlist.js',
  'src/qr/payloads.js',
  'src/qr/matrix.js',
  'src/qr/quality.js',
  'src/qr/qr-ui.js',
  'assets/vendor/qrcode-generator.js',
  'src/exif/jpeg.js',
  'src/exif/png.js',
  'src/exif/exif-ui.js',
  'assets/vendor/piexif.js',
  'src/palette/quantize.js',
  'src/palette/palette-ui.js',
  'encode.html',
  'jwt.html',
  'image.html',
  'vault.html',
  'src/encode/encode.js',
  'src/encode/encode-ui.js',
  'src/jwt/jwt.js',
  'src/jwt/jwt-ui.js',
  'src/image/image.js',
  'src/image/image-ui.js',
  'src/vault/crypto.js',
  'src/vault/model.js',
  'src/vault/totp.js',
  'src/vault/passgen.js',
  'src/vault/vault-ui.js',
  'morse.html',
  'src/morse/morse.js',
  'src/morse/timing.js',
  'src/morse/wav.js',
  'src/morse/player.js',
  'src/morse/morse-ui.js',
  'assets/img/icon-192.png',
  'assets/img/icon-512.png',
  'assets/img/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Resolve each asset against the SW scope; ignore individual failures so a
      // single missing file cannot break the whole install.
      Promise.all(
        ASSETS.map((path) => {
          const url = new URL(path, self.registration.scope).href;
          return cache.add(url).catch(() => null);
        }),
      ),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('browser-toolbox-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: stale-while-revalidate so a new deploy is fetched in the
  // background and served on the NEXT load (one-load-behind, documented in README).
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((resp) => {
            if (resp && resp.ok && resp.type === 'basic') {
              const clone = resp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
            }
            return resp;
          })
          .catch(async () => {
            const indexUrl = new URL('index.html', self.registration.scope).href;
            return cached || (await caches.match(indexUrl)) || Response.error();
          });
        return cached || network;
      }),
    );
    return;
  }

  // Static assets: stale-while-revalidate. Serve the cached copy immediately for
  // speed/offline, and kick off a background fetch to refresh the cache so modules
  // self-heal on a later load even if CACHE_VERSION was not bumped (audit-6 M6).
  // Navigations are SWR too, so HTML and its module graph advance together (one load
  // behind); a concurrent revalidation can briefly mix cache generations within a
  // single load, which is harmless here since the modules are version-independent.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          if (resp && resp.ok && resp.type === 'basic') {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return resp;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});
