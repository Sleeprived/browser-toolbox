# Changelog

## 2026-06-21 — v1.2.2 — fixes from browser-toolbox-audit-4.md

### Fixed
- **CSV**: a column header literally named `__proto__` no longer silently drops
  that column when converting to JSON (rows are built with a null-prototype object).
- **Palette**: the median-cut quantizer no longer degenerates into near-black
  slivers on smooth gradients/photos — it splits at the median by default and only
  overrides for a clearly dominant colour gap.
- **EXIF**: metadata placed after the first scan (progressive/multi-scan or crafted
  JPEGs) is now stripped, and "verified clean" is shown only after re-scanning the
  cleaned file — previously the message was hardcoded and could be false. Corrupt
  GPS rationals no longer render as "NaN, NaN".
- **Image**: EXIF orientations 5 and 7 are corrected the right way (were
  mirrored/rotated wrong); a transparent PNG/WebP exported to JPEG now gets a white
  background instead of black; huge-pixel images are clamped to avoid an
  out-of-memory crash.
- **JWT**: an out-of-range expiry/time claim no longer throws and blanks the result.
- **Vault**: password history and the live TOTP code are cleared from the DOM on
  lock; `pagehide`/bfcache restore now fully re-locks and scrubs the decrypted list.
- **QR**: vCard values escape carriage returns; the Wi-Fi security field is
  allowlisted; email addresses are whitespace-stripped; phone/SMS numbers keep only
  a leading `+`.
- **Encode**: `&nbsp;` decodes to U+00A0 (was an ASCII space); an unknown mode
  throws instead of silently encoding; numeric refs for surrogates/NUL decode to U+FFFD.
- **Service worker**: the offline navigation fallback can no longer resolve to `undefined`.

### Changed
- **Service worker bumped to v6** so the above fixes reach already-installed users.
- **CSV download** now neutralises spreadsheet-formula cells (leading `= + - @`) with
  a `'` prefix; the CSV↔JSON round-trip is unchanged.
- **Cron** descriptions read "every minute"/"every hour" (not "every 1 minutes").
- **Vault** clipboard message now states the 25s auto-clear is best-effort.
- **README**: added an Updates/Troubleshooting note and an EFF wordlist credit.

### Notes
- Tests 242 → 265 (a regression test for every logic fix; new `test/vault.lock.test.js`).
  Full audit: `an internal audit`. Deferred pending a
  spec decision: documenting the four unscoped tools (vault/jwt/encode/image) and the
  palette/passphrase spec-wording in the build spec.

## 2026-06-21 — v1.2.1

### Added
- **Continuous integration** (`.github/workflows/ci.yml`): runs the Vitest suite
  on every push and pull request (Node 20).
- **Wi-Fi QR warning**: the QR generator now warns that a Wi-Fi password is stored
  in the code as plain text and is readable by anyone who scans the code.

### Changed
- **Service worker bumped to v5** — delivers the QR page update to installed users.
- `NOTICE` now records the exact vendored library versions (qrcode-generator 2.0.4,
  piexifjs 1.0.6).

## 2026-06-21 — v1.2.0

### Added
- **Password Vault** (`vault.html`): a private, offline password manager. Entries
  are stored in a single file the user keeps, encrypted with **AES-256-GCM**; the
  master password is stretched with **PBKDF2-HMAC-SHA256 (600,000 iterations)**.
  The file is opened/saved via plain download/upload — nothing is persisted in the
  browser and nothing is uploaded.
  - Per-entry fields: title, username, password, URL, notes, **tags**, **custom
    fields** (with optional masking), and **password history**.
  - **Offline TOTP/2FA** code generation (RFC 6238, HMAC-SHA1/256/512) with a live
    countdown — verified against the published RFC test vectors.
  - Built-in password generator: diceware passphrases (reusing the Passphrase
    tool) or random characters with class guarantees.
  - Security behaviors: master-password strength gate (reuses the strength meter),
    inactivity **auto-lock**, in-memory key wiped on lock/unload, best-effort
    **clipboard auto-clear**, unsaved-changes guard, and a master-password change
    flow. There is **no password reset** — the file is the user's to back up.
  - File format is versioned (KDF parameters in a plaintext header) so the work
    factor can be raised, or the KDF upgraded, without breaking older files.
- **Service worker bumped to v4** — precaches `vault.html` and the five vault src
  modules for offline use.

### Notes
- New pure modules are unit-tested with Vitest (crypto round-trip / wrong-password
  / tamper rejection, RFC 6238 + RFC 4226 vectors, generator class guarantees,
  model CRUD/serialize). The vault UI has runtime smoke coverage.

## 2026-06-20 — v1.1.0

### Added
- **Encode / Decode Multitool** (`encode.html`): convert text to and from
  Base64, Hex, URL encoding, and HTML entities — encode and decode directions
  for all four codecs, no file size limit beyond browser memory.
- **JWT Decoder** (`jwt.html`): Base64url-decode the header and payload of any
  JSON Web Token; verify HS256/384/512 signatures using the Web Crypto API
  (secret never stored); RS256/ES256 decoded structurally.
- **Image Resizer** (`image.html`): resize and compress JPEG, PNG, and WebP
  images via an off-screen canvas; proportional height; quality slider for JPEG
  and WebP; EXIF orientation auto-corrected before drawing.
- **Service worker bumped to v3** — precaches `encode.html`, `jwt.html`,
  `image.html`, and all six new src modules for offline use.

### Fixed / hardened (v1.0 → v1.1 patch pass)
- **QR**: non-ASCII (UTF-8) characters now encode correctly; previously
  multi-byte codepoints could overflow the payload length check.
- **CSV**: handles BOM at the start of UTF-8 files; tolerates ragged rows
  (fewer columns than the header); drop-column index re-mapped correctly after
  previous drops.
- **Cron**: leap-day schedules (Feb 29) no longer hang — impossible
  day/month combinations are detected instantly and report "no upcoming runs".
- **EXIF**: JFIF-only files (no EXIF IFD) now process correctly; the JFIF APP0
  marker is preserved as an allowed color-space marker.
- **Passphrase**: entropy display now matches actual word-count selection;
  copy-to-clipboard fall-back works in non-secure contexts.
- **Palette**: fully-transparent images show "No opaque pixels found" instead
  of an empty result panel; `color-mix()` backgrounds have solid fallbacks.
- **SW stale-while-revalidate**: navigations are served from cache immediately;
  the new build is fetched in the background and served on the next load
  (documented in Troubleshooting).

### Accessibility sweep
- EXIF and palette drop zones are keyboard-operable (focusable; Enter/Space
  opens the file picker).
- Skip-link, `id="main"`, and dual `theme-color` meta tags added to all pages.

## 2026-06-20 — QR Code Studio upgrade

### Added
- **Four new QR content types:** Email (mailto with subject/body), SMS (SMSTO),
  Map location (geo:), and Phone (tel:). Email subject/body are percent-encoded,
  geo coordinates are range-validated, and phone/SMS numbers are sanitized.
- **Custom colors:** foreground and background color pickers (applied to both the
  PNG and SVG), with a **scannability guard** that warns when a choice is low-
  contrast or inverted (light code on dark background) — which scanners struggle
  with.
- **Size & margin controls:** download resolution selector (256 / 512 / 1024 px)
  and an adjustable quiet-zone margin.
- **Copy image to clipboard** button alongside the PNG/SVG downloads.
- **Capacity readout:** live payload byte count, the QR version used, and the
  error-correction level, so you can see why a code won't fit before it fails.

## 2026-06-20 — post-review hardening + fixes

### Security / metadata
- **JPEG cleaner now strips far more than EXIF.** Rebuilt the JPEG stripper as an
  allowlist (matching the PNG approach): it keeps only what is needed to decode
  the image and removes EXIF, **XMP**, **IPTC/Photoshop**, **ICC profile**,
  comments, the embedded thumbnail, maker notes, and any **trailing bytes after
  the image**. The previous version (EXIF-only) left XMP and IPTC — which can
  duplicate GPS and creator data — and trailing payloads intact. Still lossless;
  pixels are never re-encoded. Orientation is preserved.
- **EXIF tool now lists what it removes** (EXIF / XMP / IPTC / ICC / comment /
  trailing) so you can confirm the strip was complete.
- **PNG cleaner verified** to remove the `eXIf` chunk, AI-generator prompt/
  workflow text chunks (ComfyUI / Automatic1111), and trailing data after IEND —
  now covered by regression tests.
- **Stronger password meter.** Added keyboard-walk detection (qwerty, asdf, 1234)
  and detection of disguised common passwords (leetspeak `p@ssw0rd`, common word
  + trailing digit/symbol `password1!`), capped so they can never read as strong.

### Fixed / changed
- **CSV sort arrow** no longer points at the wrong column after you drop a column
  to its left.
- **Accessibility:** the EXIF and palette drop zones are now keyboard-operable
  (focusable, Enter/Space opens the file picker).
- **Palette:** clicking a swatch's hex now shows a "Copied" confirmation; the
  color-count slider re-quantizes a cached pixel buffer instead of re-decoding
  the image on every step.
- **Manifest:** removed the `portrait-primary` orientation lock so the installed
  app (and the CSV table) can use landscape.

### Known limitations (documented, by design)
- Does not remove data hidden in pixels (LSB steganography) or alter JPEG
  quantization tables — both require re-encoding, which this lossless tool does
  not do.

## 2026-06-20 — fixes from browser-toolbox-audit-2.md

### Fixed
- **Empty palette message.** Dropping a fully transparent image into the Color
  Palette Extractor now shows "No opaque pixels found in this image" instead of
  an empty result panel.
- **Styling fallback.** Added solid background fallbacks behind the `color-mix()`
  translucent backgrounds (header and message boxes) so they still look right on
  browsers that do not support `color-mix()`.

## 2026-06-20 — fixes from browser-toolbox-audit.md

### Fixed
- **Cron `N/step` schedules.** Expressions like `0/15` or `5/20` (start at N,
  then every step) were parsed as the single value N, producing a wrong
  description and wrong run times. They now correctly expand to the field
  maximum (`0/15` → minutes 0, 15, 30, 45).
- **QR "too much data" error.** When the input was too large to fit in a QR
  code, the tool showed "undefined" because the underlying library throws a
  plain string instead of an error. It now shows a clear message telling you to
  shorten the input or lower the error correction. The EXIF tool's error message
  was hardened against the same kind of string error.
- **Slow cron preview for impossible dates.** An impossible schedule such as
  `0 0 30 2 *` (February 30th) made the preview scan five years of minutes
  before giving up. It now detects impossible day/month combinations instantly
  and shows "no upcoming runs".

### Changed
- Home page footer no longer links to a placeholder GitHub URL; it now reads
  plain text.

## 2026-06-20 — browser-toolbox.md (initial build)

### Added
- **Project shell**: a static, multi-page, fully client-side site with a home
  page listing six tools, a shared dark-first (light-toggle) mobile-first
  stylesheet using only system fonts, and a shared bootstrap that wires the
  theme toggle and registers the service worker.
- **QR Code Studio**: generates QR codes for plain text/URLs, WiFi logins, and
  vCard contact cards, with correct WiFi/vCard character escaping; live canvas
  preview with a quiet zone; PNG and SVG download; selectable error-correction
  level (L/M/Q/H). Uses the vendored `qrcode-generator` library.
- **EXIF Cleaner**: removes identifying metadata from JPEG and PNG photos
  (multiple files at once, drag-and-drop or picker). Shows detected GPS, camera,
  and timestamp before cleaning. JPEG stripping keeps only the Orientation tag
  (so photos are not rotated); PNG stripping keeps only render-critical chunks
  (IHDR, PLTE, IDAT, IEND, tRNS) and drops text/metadata chunks. Rejects
  non-JPEG/PNG and skips files over 25 MB. Uses the vendored `piexifjs` library
  for JPEG and a custom PNG chunk rewriter.
- **Passphrase Generator + strength meter**: builds diceware passphrases from
  the 7,776-word EFF large wordlist using the browser's secure RNG, with
  configurable word count (4–8), separator, capitalization, and optional
  appended digit; shows entropy in bits and offers copy-to-clipboard. Separate
  offline strength meter estimates bits from length and character classes, with
  penalties for repeated characters, sequential runs, and common passwords.
- **CSV ⇄ JSON Workbench**: parses CSV (quoted fields, escaped quotes, embedded
  commas and newlines) into a sortable table; rename and drop columns; choose
  delimiter (comma/semicolon/tab/pipe); convert to pretty or minified JSON and
  back; download CSV or JSON. Duplicate headers are de-duplicated so no column
  is lost.
- **Color Palette Extractor**: extracts a dominant-color palette from an image
  using largest-gap median-cut quantization (2–12 colors); downscales large
  images to 256 px on the long edge to bound memory; click-to-copy swatches and
  export as a hex list, CSS variables, or JSON.
- **Cron Explainer**: parses standard 5-field Unix cron (plus `@hourly`,
  `@daily`, `@weekly`, `@monthly`, `@yearly`/`@annually`, `@midnight` and
  month/weekday names), describes it in plain English, and lists the next five
  run times (computed in UTC, displayed in the local timezone). Applies Vixie
  "either matches" semantics when both day-of-month and day-of-week are set.
- **Installable PWA**: web app manifest (name, short name, standalone display,
  theme/background colors, 192/512/maskable icons) and a versioned service
  worker that precaches the app's own assets for offline use, purges old caches
  on activation, and claims clients. Icons generated by a committed dev script.
- **Security posture**: every page carries a Content-Security-Policy meta tag
  restricting scripts/connections to same-origin; all user-derived content is
  written to the DOM as text (no `innerHTML` with user data); no runtime network
  calls; no storage of any kind (fully stateless).
- **Automated tests**: 85 Vitest tests covering QR payloads + matrix vectors,
  EXIF/PNG stripping, passphrase generation + entropy + strength penalties, CSV
  parse/round-trip/edge cases, median-cut quantization, and cron
  parse/describe/next-runs.
- **Docs**: README (quick start, plain-English guide, detailed guide, glossary)
  and this changelog. EFF wordlist credited (CC BY 3.0 US).
