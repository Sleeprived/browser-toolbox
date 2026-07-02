// Service worker for Browser Toolbox.
// Precaches the app's own static assets for offline use. The cache name is
// VERSIONED: bump CACHE_VERSION on each deploy so old caches are purged and
// users receive the new build. Only the app's own assets are cached — no
// third-party requests are ever made.

const CACHE_VERSION = 'v26';
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
  'src/qr/decode.js',
  'src/qr/risk.js',
  'src/qr/qr-read-ui.js',
  'assets/vendor/qrcode-generator.js',
  'assets/vendor/jsQR.js',
  'src/exif/jpeg.js',
  'src/exif/png.js',
  'src/exif/exif-ui.js',
  'assets/vendor/piexif.js',
  'assets/vendor/zxcvbn.js',
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
  'src/vault/import.js',
  'src/vault/vault-ui.js',
  'morse.html',
  'src/morse/morse.js',
  'src/morse/timing.js',
  'src/morse/wav.js',
  'src/morse/player.js',
  'src/morse/morse-ui.js',
  'src/morse/keyer.js',
  'src/morse/tap-ui.js',
  'cipher.html',
  'src/cipher/tapcode.js',
  'src/cipher/baconian.js',
  'src/cipher/pigpen.js',
  'src/cipher/semaphore.js',
  'src/cipher/glyph-render.js',
  'src/cipher/cipher-ui.js',
  'totp.html',
  'src/totp/otpauth.js',
  'src/totp/totp-ui.js',
  'hash.html',
  'src/hash/hash.js',
  'src/hash/hash-ui.js',
  'barcode.html',
  'src/barcode/code128.js',
  'src/barcode/ean.js',
  'src/barcode/render.js',
  'src/barcode/barcode-ui.js',
  'src/barcode/decode.js',
  'src/barcode/read-ui.js',
  'src/morse/mic.js',
  'src/morse/mic-ui.js',
  'src/shared/index-search.js',
  'diff.html',
  'src/diff/diff.js',
  'src/diff/diff-ui.js',
  'regex.html',
  'src/regex/regex.js',
  'src/regex/regex-ui.js',
  'timestamp.html',
  'src/timestamp/timestamp.js',
  'src/timestamp/timestamp-ui.js',
  'contrast.html',
  'src/contrast/contrast.js',
  'src/contrast/contrast-ui.js',
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
    ),
    // No skipWaiting() here: the new worker WAITS until the user accepts the
    // "update ready" toast (page.js posts SKIP_WAITING below) or all tabs close.
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
  // background; when the refreshed worker is waiting, the page shows the
  // "update ready" toast so the user can activate it immediately instead of
  // being one load behind. ignoreSearch: a navigation carrying a query string
  // (e.g. a share link) must still hit the cached page shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        const network = fetch(req)
          .then(async (resp) => {
            if (resp && resp.ok && resp.type === 'basic') {
              const clone = resp.clone();
              // Store under the search-stripped URL: matching ignores the
              // query, so per-query duplicate entries would pile up unread.
              const bare = new URL(req.url);
              bare.search = '';
              await caches.open(CACHE_NAME).then((cache) => cache.put(bare.href, clone)).catch(() => {});
            }
            return resp;
          })
          .catch(async () => {
            const indexUrl = new URL('index.html', self.registration.scope).href;
            return cached || (await caches.match(indexUrl)) || Response.error();
          });
        // When the cached copy is served, nothing awaits the refresh — without
        // waitUntil the browser may stop the idle worker before the fetch and
        // cache.put land, and the background revalidation silently never
        // happens. (The put is awaited inside `network` so this covers it.)
        event.waitUntil(network.then(() => undefined, () => undefined));
        return cached || network;
      }),
    );
    return;
  }

  // Static assets: stale-while-revalidate. Serve the cached copy immediately for
  // speed/offline, and kick off a background fetch to refresh the cache so modules
  // self-heal on a later load even if CACHE_VERSION was not bumped.
  // Navigations are SWR too, so HTML and its module graph advance together (one load
  // behind); a concurrent revalidation can briefly mix cache generations within a
  // single load, which is harmless here since the modules are version-independent.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then(async (resp) => {
          if (resp && resp.ok && resp.type === 'basic') {
            const clone = resp.clone();
            await caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return resp;
        })
        .catch(() => cached || Response.error());
      // Same worker-lifetime guarantee as the navigation branch above.
      event.waitUntil(network.then(() => undefined, () => undefined));
      return cached || network;
    }),
  );
});
