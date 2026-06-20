# Changelog

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
