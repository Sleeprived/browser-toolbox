# Changelog

## 2026-06-25 — v1.8.1 — stronger master-password gate + DoS guard fix

### Changed
- **Password Vault — stronger master-password gate.** Your master password must now clear
  not just zxcvbn's "Very strong" score but a minimum guess-resistance (≈36 bits). This
  rejects long-but-low-entropy passwords such as "correcthorsebattery" that the
  score-alone check accepted, bringing protection back in line with earlier versions.
  Every built-in generator output (4+ word passphrase, 16+ character random) still passes,
  and the vault's passphrase generator minimum is raised from 3 to 4 words to match.
- Service worker bumped to v19 so installed users receive these changes.

### Fixed
- **CSV ⇄ JSON:** the very-tall-file guard now also counts rows split by a bare carriage
  return (old-Mac line endings), closing a gap where a "\r"-delimited paste could still
  freeze the tab.
- **Password Vault:** if the strength checker can't load, the create screen now says so
  instead of showing a misleading "too weak" message (it already refused to proceed).

## 2026-06-23 — v1.8.0 — stronger password-strength checking (zxcvbn) + hardening

### Changed
- **Password strength is now measured by zxcvbn**, a real pattern-matching estimator,
  replacing the previous lightweight heuristic on both the Passphrase page and the
  Password Vault. The vault now requires your master password to rate "Very strong"
  (zxcvbn's "strong protection from an offline attack") — long-but-weak passwords the
  old meter over-rated (repeated or padded patterns, e.g. "AAAAaaaa1111!!!!") are now
  correctly rejected. Analysis is capped to the first 100 characters so a large paste
  can't freeze the field. This adds a one-time ~400 KB cached download on the Passphrase
  and Vault pages.
- Service worker bumped to v18 so installed users receive these changes.

### Fixed
- **EXIF Cleaner:** an Adobe colour-profile (APP14) segment is now re-emitted in its
  canonical form, so a crafted JPEG can no longer smuggle extra bytes past the strip.
- **CSV ⇄ JSON:** a very tall file (millions of rows), or a pasted JSON object with a huge
  number of keys, is now refused before it can freeze the tab — matching the existing
  wide-file guard.
- **TOTP / 2FA Generator:** the generated code and label are now cleared from the page
  (not just hidden) when the secret is wiped after the tab has been hidden a while.
- **JWT Decoder:** a token whose payload is a bare value rather than an object is handled
  correctly (the "no usable expiry" warning still fires).

## 2026-06-23 — v1.7.1 — security & denial-of-service hardening

### Fixed
- **Password Vault:** opening a vault file or importing a CSV now warns and skips
  anything over 25 MB instead of reading the whole file into memory (a multi-gigabyte
  file could otherwise freeze the tab). A vault file whose key-derivation iteration
  count is implausibly low — a sign it was tampered with or hand-edited — is now
  refused rather than opened with near-zero key-stretching strength.
- **Hash & Checksum:** the file-size limit is now 25 MB (was 250 MB), matching the
  rest of the app — a very large file was read entirely into memory and could crash
  the tab. A rejected or unreadable file no longer leaves a previous "✓ Match" result
  on screen. A checksum pasted with a leading "0x" now compares correctly instead of
  reading as a mismatch.
- **CSV ⇄ JSON:** a file with an enormous number of columns no longer freezes the tab
  — the table shows the first 200 columns (all data is still exported) and absurdly
  wide input is refused.
- **Cipher Studio:** the Pigpen/Semaphore visual encoder no longer freezes on a very
  long paste; it draws the first 2000 symbols and notes the message was truncated for
  display.
- **TOTP / 2FA Generator:** the decoded secret is now cleared from memory after the tab
  has been hidden for a while or is unloaded, instead of staying in memory for the life
  of the tab.
- **EXIF Cleaner:** a correctly-cleaned JPEG that legitimately keeps a structural Adobe
  colour-transform segment no longer shows a false "some metadata could not be removed"
  warning.
- **JWT Decoder:** a token whose "exp" is text rather than a number now shows the "no
  usable expiry" warning instead of appearing to have a valid expiry.
- **Colour Palette & Image Resizer:** the oversized-image (decompression-bomb) guard is
  tightened from 100 MP to 64 MP to lower peak memory on a crafted image; any realistic
  photo is still accepted.
- **Passphrase strength meter:** pasting a very large string into the password field no
  longer freezes it — the repeated-pattern detection is now linear-time over the whole
  input (no rating changes).

### Changed
- Service worker bumped to v17 so installed users receive these fixes.

## 2026-06-23 — v1.7.0 — TOTP/2FA generator, hash & checksum verifier, security hardening

### Added
- **TOTP / 2FA Generator (new tool):** generate time-based one-time codes from a
  base32 secret or an `otpauth://` URI, with a live countdown and a copy button.
  Reuses the vault's RFC 6238 engine; the secret lives only in the tab and is
  never stored.
- **Hash & Checksum Verifier (new tool):** SHA-1/256/384/512 of text or a dropped
  file via Web Crypto, with a compare field that verifies a download against its
  published checksum (case/separator-insensitive). MD5 is intentionally omitted —
  browsers don't provide it and it's unfit for integrity.

### Fixed / hardened
- **Passphrase / Vault (security):** a common word hidden behind letter or interior
  padding (e.g. `qqqpasswordqqq`) no longer reads "Strong"; it is capped so it
  cannot clear the vault's 60-bit master-password gate.
- **Image Resizer:** rely on the browser's built-in EXIF auto-orientation instead
  of re-applying it — rotated phone photos were being rotated twice on modern
  browsers. Dropped the now-unused metadata-reader dependency on this page.
- **Color Palette / QR reader / Image Resizer:** reject decompression-bomb images
  by decoded pixel count (a small file can decode to a multi-gigabyte bitmap).
- **JWT Decoder:** the verify result now names the algorithm and notes it checks
  the signature only; editing the secret clears a stale verdict.
- **Vault:** lowered the PBKDF2 iteration ceiling read from a file (bounds a
  hostile-file tab freeze); imported TOTP digits/period are clamped to valid ranges.

### Changed
- Service worker bumped to v16 so the new tools and fixes reach installed users.
- Tests 422 → 441.

## 2026-06-23 — v1.6.0 — Cipher Studio + Binary in the Encode Multitool

### Added
- **Cipher Studio (new tool):** a single page that encodes and decodes four
  classic codes behind one selector, live and offline:
  - **Tap Code** — the POW knock code on a 5×5 grid (K is sent as C; because the
    two share a cell, a decoded `C` can't be told back from `K`).
  - **Baconian** — the distinct 26-letter A/B variant, so encode→decode is
    lossless (it differs from the classic 24-letter table, where I/J and U/V
    share a code, for letters K–Z).
  - **Pigpen** — the Freemason geometric cipher, rendered as glyphs.
  - **Semaphore** — flag-position figures, two arms at 45° steps.
  The visual codes (Pigpen, Semaphore) render an on-screen glyph/flag strip with a
  reference chart, download as **SVG or PNG**, and **decode by clicking a glyph
  palette** to rebuild text. Malformed decode input degrades to `�` per token
  rather than failing. Everything runs in your browser; nothing is uploaded.
- **Encode / Decode Multitool — Binary:** a new **Binary** format converts text to
  and from space-separated 8-bit groups (UTF-8), alongside Base64, Hex, URL, and
  HTML entities.

### Changed
- **Service worker bumped to v15** so installed users receive the new tool, and the
  home page, manifest, and descriptions now list twelve tools.

## 2026-06-22 — v1.5.0 — vault: view saved passwords + import from other managers

### Added
- **Password Vault — view a saved password:** each entry row now has a **Show**
  toggle that reveals its password inline, instead of only being able to copy it.
  The revealed password auto-hides after 30 seconds, on lock, and when another row
  is shown; only one is ever visible at a time. The auto-hide timer is dropped on
  lock so a revealed secret never outlives the lock.
- **Password Vault — import from other managers:** a new **Import** button reads a
  CSV export from another password manager (Chrome/Edge, Firefox, Bitwarden,
  LastPass, 1Password, KeePass). Columns are auto-detected and shown in an
  **editable** mapping panel before anything is added, so unrecognized layouts work
  too. Title falls back to the site hostname when the export has no name column,
  `otpauth://` TOTP secrets are extracted, and a folder/group column maps to a tag.
  The file is read entirely in your browser and never uploaded; a prominent warning
  reminds you to delete the plaintext CSV afterwards.

## 2026-06-22 — v1.4.1 — vault master-password gate + secret hygiene

### Fixed (security / hardening)
- **Password Vault / Passphrase (weak-master loophole):** the strength meter scored
  a string made of two or more dictionary words by length × charset, so multi-word
  and repeated-word compositions read far stronger than they are — e.g.
  `password password` showed ~100 bits ("Very strong") and **passed the vault's
  60-bit master-password gate**, as did `passwordmonkey`, `admin99admin`, and
  `Summer2024Summer`. Such inputs are now segmented against the EFF wordlist + the
  common-password list and capped at a diceware-style word-count estimate, so they
  fail the gate. A genuinely random 5+-word generated passphrase still passes.
  (Known limit: l33t of a single uncommon word, or a famous published phrase, can
  still be over-rated — the meter is a guard, not a full cracker.)

### Changed (vault hardening)
- The master-password input is cleared immediately after a successful unlock instead
  of lingering in the field for the whole unlocked session.
- The clipboard is wiped on **lock** (cancelling the pending auto-clear timer), so a
  copied password does not outlive the lock waiting on a timer the browser may have
  throttled in a background tab.
- Corrected an over-stated in-code comment: on lock the decrypted vault has its
  references dropped and the DOM scrubbed, but a browser cannot guarantee the
  underlying plaintext bytes are zeroed (immutable JS strings, non-deterministic GC).

### Added
- **README** gained a "Security & trust — Password Vault" section: the master
  password is the real security boundary, the web-delivery trust model, and the
  run-it-locally option for a stronger trust model.
- **Service worker bumped to v13** so the above reach already-installed users.

## 2026-06-22 — v1.4.0 — QR reader + local link-safety check

### Added
- **QR Code Studio now reads QR codes, not just makes them.** A new **Read & check**
  tab lets you drop or choose an image of a QR code; it is decoded entirely in your
  browser (no upload) and broken down by type — links, Wi-Fi, contacts, email, SMS,
  map locations, phone numbers, and plain text.
- **Local safety check (heuristic, not a verdict).** For the decoded content the tool
  surfaces warning signs rather than a green "safe" badge it cannot honestly give:
  `javascript:`/`data:`/`file:` schemes and embedded-credential (`user@host`) links are
  flagged as danger; plain `http://`, punycode/internationalized domains, raw-IP hosts,
  and known link shorteners as caution; with the standing reminder that a local check
  cannot guarantee a link is safe. Links are shown as inert text — never auto-opened.

### Changed
- Bundles **jsQR 1.4.0** (Apache-2.0) as the in-browser decoder; attributed in `NOTICE`.
- **Service worker bumped to v12** so the new tab reaches already-installed users.

## 2026-06-22 — v1.3.1 — dark-only + security/correctness hardening

### Changed
- **Dark-only theme.** Removed the light theme and the header light/dark toggle —
  the app now always uses the dark palette. Dropped the light-mode CSS variables,
  the toggle button and its bootstrap (`initThemeToggle`), and collapsed each page's
  dual `theme-color` meta tags to a single dark value so the browser chrome no longer
  renders light against a dark page on a light-preference OS.
- **Cron** run times are now shown in **UTC** (matching the plain-English
  description, which prints the raw field values) instead of the viewer's local
  timezone — the two halves of the result no longer disagree for non-UTC users.
- **Service worker bumped to v11** so all of the below reach already-installed users.

### Fixed (security / hardening)
- **Cron (denial of service):** a crafted expression with a huge numeric range
  (e.g. `1-999999999`) no longer hangs the tab — the range is bounds-checked before
  it is expanded, instead of building a billion-entry set first.
- **Passphrase / Vault (weak-master loophole):** a long sequential walk
  (`abcdefghijklmnop`) or a multi-row keyboard walk (`qwertyuiopasdfghjkl`) no longer
  reads "Strong". Both are now capped to their true (tiny) guessing cost, so they read
  "Very weak" and can no longer satisfy the vault master-password gate — extending the
  v1.2.4/1.2.5 strength caps to the sequential and keyboard cases.
- **CSV (formula injection):** the export-time neutralizer now also triggers when the
  dangerous character (`= + - @`) follows leading whitespace (e.g. ` =1+1`), which
  spreadsheets trim before evaluating — closing a bypass of the guard.
- **Vault:** every lock path (manual button, auto-lock, visibility timeout, bfcache)
  now clears the rendered entry rows, so the Copy-button closures that capture plaintext
  can no longer linger in memory after a lock (previously only `pagehide` did this). The
  manual Lock button now confirms before discarding unsaved entries, and the
  change-master flow re-checks master-password strength at the action site
  (defense-in-depth, mirroring create).
- **Morse:** Play, Flash, Vibrate, and Download are now bounded, so an enormous paste
  at low speed can no longer allocate a multi-gigabyte buffer or flood the event loop;
  the Flash strobe rate is capped below the seizure-risk threshold (WCAG 2.3.1)
  regardless of the chosen speed, in addition to the existing reduced-motion gate.

### Fixed (correctness / robustness)
- **EXIF:** a truncated JFIF `APP0` segment is now dropped instead of rebuilt with
  zeroed version/density bytes; a JPEG truncated at the `SOF` marker reports a clean
  error instead of `NaN×NaN` dimensions.
- **CSV:** duplicate or empty header names now show the same de-duplicated columns in
  the table as in the JSON/CSV export (they previously diverged).
- **Encode:** URL-encoding an unpaired surrogate now surfaces a clear message instead
  of a generic one (the underlying `URIError` is wrapped like every other codec).
- **JWT:** an out-of-range numeric time claim no longer renders a meaningless
  scientific-notation "relative" time.
- **QR:** the email (`mailto:`) address now strips the URI delimiters `? # &` so a
  malformed address cannot inject or duplicate the query string.
- **Image:** a non-finite typed width/height (e.g. `1e999`) is clamped to a sane canvas
  size instead of producing a `NaN×NaN` canvas.
- **Palette:** a failed image decode no longer leaves the previous image's palette to
  reappear when the colour-count slider is moved.
- **TOTP:** `totp()` now rejects a negative time instead of producing a meaningless code.
- **Morse:** multi-line / tab-separated pasted Morse is now treated with word breaks
  (3+ of any whitespace), matching the documented behaviour; Vibrate now stops any other
  active output channel first, like Play and Flash.

### Removed
- **Cron:** deleted an unused internal `matches()` helper (dead code — `nextRuns` uses
  its own equivalent).

### Tests
- 306 → 316. Added regression tests for the cron range-expansion guard, the
  sequential/keyboard strength caps, the JWT HMAC verify path (valid + wrong secret),
  the vault keyed re-save round-trip, and announced-region/skip-link coverage for
  `encode.html`, `jwt.html`, and `image.html`; the announced-region test now asserts the
  `id` and `role`/`aria-live` sit on the same element. Two cron timing-bound assertions
  were widened to remove CI flakiness.

## 2026-06-22 — v1.3.0 — Morse Code Studio

### Added
- **Morse Code Studio** (`morse.html`): translate text to and from International
  Morse Code, live as you type, with an explicit direction toggle and
  copy-to-clipboard. Decoding tolerates `.`/`-` plus common Unicode dit/dah
  variants and accepts `/` or 3+ spaces between words; unsupported characters are
  reported rather than silently dropped, and unknown tokens decode to `�` instead
  of blanking the rest. Prosigns can be sent with the `<SOS>` angle-bracket notation.
  - **Signal output**, all generated in the browser with no upload: play the code
    as CW sidetone (adjustable speed/WPM, Farnsworth character speed, and tone
    frequency), **download it as a `.wav`**, **flash** it on screen, or **vibrate**
    it on supported phones. All four are driven from one shared timeline so they
    stay identical. The flash is opt-in and is disabled automatically when the
    system requests reduced motion (a photosensitivity safeguard); vibration is
    disabled where the browser does not support it.
- **Service worker bumped to v10** — precaches `morse.html` and the five
  `src/morse` modules for offline use.

### Notes
- New pure modules are unit-tested with Vitest (text↔Morse round-trips, prosigns,
  decode tolerance, PARIS + Farnsworth timing math, and WAV header/sample-count
  correctness). The audio/flash/vibration drivers are browser-only and are covered
  by an import-and-encode smoke test plus manual verification.

## 2026-06-22 — v1.2.5 — security & correctness follow-up

### Fixed
- **Passphrase / Vault (security):** a password made of a short unit repeated to
  length (e.g. `Aa1!Aa1!Aa1!`) no longer reads "Strong". The strength score is now
  capped at the cost of guessing one unit plus its repetition, so such strings read
  "Very weak"/"Weak" and can no longer satisfy the vault's master-password
  requirement — closing the remaining case of the v1.2.4 weak-master fix.
- **Image resizer:** the "clamped to fit canvas limits" notice now stays visible
  after a successful resize, so you can see why the output size changed.
- **Service worker:** a background cache refresh can no longer raise an unhandled
  rejection on a storage error.

### Changed
- **Service worker bumped to v9.**
- **Vault:** the auto-lock visibility timer state is reset on every lock (robustness).
- Removed two now-unused internal strength penalties and corrected the service
  worker comment to describe the actual stale-while-revalidate guarantee.

## 2026-06-21 — v1.2.4 — security & correctness fixes

### Fixed
- **Passphrase / Vault (security):** the strength meter no longer rates trivially
  weak passwords as strong. A string of identical characters (`aaaaaaaaaaaaaaaaa`),
  a two-character alternation (`abababab…`), or a near-uniform password with a tiny
  suffix (`aaaaaaaaaaaa12`) now reads "Very weak". This same estimate gates the
  Password Vault's master password, so those strings can no longer satisfy the
  "genuinely strong master password" requirement.
- **EXIF cleaner:** stripped photos that carried an Orientation tag are no longer
  falsely labelled "WARNING: some metadata could not be removed". The cleaner
  re-inserts an Orientation-only EXIF block (so photos aren't shown rotated); the
  re-scan now judges by identifying *content* (GPS / camera / date), not by the mere
  presence of an EXIF container, so ordinary phone photos correctly read "verified
  clean".
- **Password Vault:** opening a hostile vault file can no longer freeze the tab — the
  PBKDF2 iteration count read from a file is now capped (≤ 10,000,000) before key
  derivation runs, instead of being passed through unbounded.
- **Image resizer:** a manually-typed width/height that exceeds canvas limits is now
  re-clamped (with a notice) instead of producing a silent encode failure.

### Added
- **Clickjacking defense:** every page now busts out of a hostile `<iframe>` in
  JavaScript (a meta-tag CSP cannot set `frame-ancestors` and GitHub Pages cannot
  send `X-Frame-Options`), protecting the Password Vault's master-password entry and
  decrypted secrets from UI-redress.

### Changed
- **Service worker bumped to v8**, and static assets (JS/CSS) now use
  stale-while-revalidate so updated modules self-heal on the next load even if the
  cache version is not bumped — preventing new HTML from running against stale
  cached JavaScript after a deploy.
- **Vault auto-lock** is now also enforced on tab-return: if the auto-lock interval
  elapsed while the tab was hidden (where background timers can be throttled), the
  vault locks on return.
- **Vault entry IDs** no longer use `Math.random` in their (unreachable) fallback
  path; a secure source is used when available.
- **QR SVG export** validates the colour values as `#rrggbb` before embedding them,
  hardening the export against a future free-text colour field.

## 2026-06-21 — v1.2.3 — security & correctness fixes

### Fixed
- **EXIF**: a crafted `FF FF <non-marker>` byte sequence in the scan data no
  longer truncates the image (regression from the v1.2.2 progressive-JPEG fix).
- **Image**: the "very large image — clamped" notice no longer lingers as a red
  alert after a successful resize.
- **Vault**: the page-hide handler now fails safe if the entry-list node is absent.

### Changed
- **Service worker bumped to v7** so the above reach already-installed users.

## 2026-06-21 — v1.2.2 — security & correctness fixes

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

## 2026-06-20 — palette & styling fixes

### Fixed
- **Empty palette message.** Dropping a fully transparent image into the Color
  Palette Extractor now shows "No opaque pixels found in this image" instead of
  an empty result panel.
- **Styling fallback.** Added solid background fallbacks behind the `color-mix()`
  translucent backgrounds (header and message boxes) so they still look right on
  browsers that do not support `color-mix()`.

## 2026-06-20 — cron & QR fixes

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

## 2026-06-20 — initial build

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
