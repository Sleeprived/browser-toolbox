# Browser Toolbox

Six handy tools that run **entirely in your web browser** — no upload, no
account, no server, works offline. Host it for free on GitHub Pages and share
it by link; anyone can use it on a phone or a desktop.

The tools:

1. **QR Code Studio** — make QR codes for text, links, WiFi logins, contact cards, email, SMS, map locations, and phone numbers; custom colors, sizes, PNG/SVG, or copy to clipboard.
2. **EXIF Cleaner** — strip GPS, camera, and timestamp metadata out of JPEG and PNG photos.
3. **Passphrase Generator** — make strong diceware passphrases, plus an offline password strength meter.
4. **CSV ⇄ JSON Workbench** — view a CSV as a table, sort/rename/drop columns, convert to JSON and back.
5. **Color Palette Extractor** — pull the dominant colors out of an image; export as hex, CSS variables, or JSON.
6. **Cron Explainer** — translate a cron schedule into plain English and preview its next run times.

---

## 1. Quick summary

It is a plain static website (HTML + CSS + JavaScript). There is **no build
step** — the files you edit are the files that ship. Tests cover the logic of
every tool.

Quick start (run the tests, then preview the site locally):

```
npm install
npm test
python -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

- `npm install` downloads the developer tools used for **testing** only (they
  never ship to users).
- `npm test` runs the automated tests for all six tools' logic.
- `python -m http.server 8080` starts a tiny local web server so the browser
  can load the pages (opening the files directly with `file://` will not work,
  because browsers block JavaScript modules and the offline feature on
  `file://`).

---

## 2. Plain-English guide

### Using the tools (no setup needed once it is hosted)

Open the site. You will see a home page listing the six tools. Tap one to open
it. Every tool works the same way: you type or drop something in, and the
result appears immediately. Nothing you enter ever leaves your device.

- **QR Code Studio** — pick a type (Text/URL, WiFi, Contact card, Email, SMS,
  Map location, or Phone number), fill in the boxes, and the QR code is drawn
  live. Under **Appearance** you can change the code and background colors (it
  warns you if a color choice would be hard to scan), adjust the white border,
  and pick the download size. Press **Download PNG** to save it as an image,
  **Download SVG** for a sharp resizable version, or **Copy image** to paste it
  straight into a chat or document. The line under the buttons tells you how big
  the data is and whether it fits. Point your phone camera at the code to check
  it works.
- **EXIF Cleaner** — drop one or more JPEG/PNG photos onto the box (or press
  Enter when it is focused to pick files with the keyboard). It shows you what
  hidden data each photo carries (for example GPS coordinates of where it was
  taken) and lists every kind of hidden information it is removing, then gives
  you a **Download cleaned** button for a copy with all of it gone. It strips far
  more than GPS: camera info, dates, editing history (XMP/IPTC), author names,
  the embedded thumbnail, and even data secretly tacked onto the end of the file.
  The picture itself is unchanged and not re-compressed; only the hidden metadata
  is gone. The photo's rotation flag is kept so cleaned photos are not displayed
  sideways.
- **Passphrase Generator** — choose how many words you want and press
  **Generate**. You get something like `correct-horse-battery-staple` that is
  easy to remember but very hard to guess. The **Copy** button puts it on your
  clipboard. Below that, you can type any password into the strength meter to
  see roughly how strong it is — this check also happens entirely offline.
- **CSV ⇄ JSON Workbench** — paste CSV text or load a `.csv` file, press **Parse
  to table**, and your data appears as a table. Click a column heading to sort,
  the ✎ button to rename a column, or the ✕ button to delete one. Press **Show
  JSON** to convert it, or the download buttons to save CSV or JSON. You can
  also paste JSON and turn it back into a table.
- **Color Palette Extractor** — drop an image in. It picks out the main colors
  and shows them as swatches. Click any swatch to copy its hex code, or use the
  export buttons for a hex list, CSS variables, or JSON.
- **Cron Explainer** — type a cron schedule such as `0 9 * * 1-5`. It tells you
  what that means in plain English ("At 09:00, Monday through Friday.") and
  lists the next five times it would run, shown in your device's local time.

If a page is blank, JavaScript is probably turned off — a message will say so.
Turn JavaScript on and reload.

### Running and publishing it yourself

You only need this part if you want to host your own copy.

**Step 1 — install the test tools (one time):**

```
npm install
```

What this does: reads the list of developer dependencies in `package.json` and
downloads them into a `node_modules` folder. These are used only to run the
tests; they are **not** part of the website and are never sent to visitors.

**Step 2 — run the tests:**

```
npm test
```

What this does: runs every automated test once and prints a pass/fail summary.
`npm test` is shorthand that runs the `test` script defined in `package.json`
(which calls the Vitest test runner). A green summary means all the tool logic
behaves as expected.

**Step 3 — preview locally:**

```
python -m http.server 8080
```

What this does, piece by piece:
- `python` runs Python (any recent Python 3).
- `-m http.server` tells Python to run its built-in mini web server module.
- `8080` is the port number, so the site is served at `http://localhost:8080`.

Open that address in a browser. If you do not have Python, any static file
server works — for example `npx http-server -p 8080` (downloads a small server
the first time).

**Step 4 — publish to GitHub Pages (this part is yours to do by hand):**
1. Create a new GitHub repository and push these files to it.
2. In the repository, open **Settings → Pages**.
3. Under "Build and deployment", choose **Deploy from a branch**, pick your
   branch (usually `main`) and the `/ (root)` folder, and save.
4. After a minute, GitHub gives you a public link like
   `https://yourname.github.io/browser-toolbox/`. Share that link — it works on
   phones and desktops, and can be "installed" to a home screen.

No paid account is required. There is no app store and no developer fee — the
"install to home screen" option is offered by the browser itself.

---

## 3. Detailed guide

### Project layout

```
index.html                Home page (links to the six tools)
qr.html / exif.html / ...  One HTML page per tool
manifest.webmanifest       PWA manifest (name, icons, colors)
sw.js                      Service worker (offline caching; versioned)
assets/
  css/style.css            Shared styles (dark-first, mobile-first)
  img/                     App icons (192, 512, maskable)
  vendor/                  Vendored libraries (committed, loaded locally)
  data/eff_wordlist.js     EFF diceware wordlist as a JS module
src/
  shared/page.js           Theme toggle + service-worker registration
  qr/  exif/  passphrase/  csv/  palette/  cron/   One folder per tool
test/                      Vitest tests for every tool's logic
scripts/gen-icons.mjs      Dev-only helper to regenerate the icons
```

### Tools, options, and limits

- **QR**: types Text/URL, WiFi, vCard, Email (mailto), SMS, Map location (geo:),
  and Phone (tel:). Each input is escaped/encoded per its format (WiFi and vCard
  special characters, percent-encoded email subject/body, range-validated geo
  coordinates, sanitized phone numbers). Error-correction levels L/M/Q/H
  (default M). **Appearance:** foreground/background color pickers with a
  scannability warning for low-contrast or inverted (light-on-dark) choices, an
  adjustable quiet-zone margin, and a download size of 256/512/1024 px. A live
  readout shows the payload byte count, the QR version, and the error-correction
  level. Output as PNG, SVG, or copied straight to the clipboard. Very long input
  that cannot fit in a QR code shows a clear message.
- **EXIF**: lossless metadata stripping for JPEG and PNG — the compressed pixels
  are copied untouched (no quality loss, no re-encoding). Both formats use an
  **allowlist**: keep only what is needed to display the image, drop everything
  else.
  - JPEG keeps the decode structure (tables, frame headers, scan data, JFIF and
    Adobe color markers) and the non-identifying Orientation tag, and removes
    **EXIF, XMP, IPTC/Photoshop, ICC profile, comments, the embedded thumbnail,
    maker notes, and any trailing bytes appended after the image** (a hidden-
    payload vector). The tool lists which of these it found before removing them.
  - PNG keeps only render-critical chunks (IHDR, PLTE, IDAT, IEND, tRNS) and
    drops all text/metadata chunks — including the `eXIf` chunk and the text
    chunks that AI image generators (ComfyUI, Automatic1111) embed your prompt,
    seed, model, and node graph into — plus any trailing data after IEND.
  - Files over 25 MB are skipped with a message. HEIC/RAW are not supported.
  - **What it does NOT do:** it does not touch data hidden in the *pixels*
    themselves (LSB steganography) — that is a different problem no metadata
    remover solves; re-saving or resizing an image is what disrupts that. It
    also does not alter the JPEG quantization tables (a faint encoder
    fingerprint), which cannot be removed without re-encoding (lossy). This tool
    is a clean, lossless *metadata* strip, not a re-encoder.
- **Passphrase**: 4–8 words from the 7,776-word EFF large wordlist, chosen with
  the browser's cryptographically-secure random generator. Optional separator,
  capitalization, and an appended digit. Entropy is shown in bits. The strength
  meter estimates bits from length and character variety, with penalties for
  repeated characters, sequential runs, keyboard walks (qwerty, asdf, 1234), and
  common passwords — including disguised ones (leetspeak like `p@ssw0rd`, or a
  common word plus a trailing digit/symbol like `password1!`), which are capped
  so they can never read as "strong". It is a rough guide that errs toward
  caution, not a full password cracker.
- **CSV ⇄ JSON**: handles quoted fields, escaped quotes (`""`), embedded commas,
  and embedded newlines. Delimiters: comma, semicolon, tab, pipe. Duplicate
  column names are de-duplicated so no column is lost. The table preview shows
  the first 500 rows for responsiveness; exports include all rows.
- **Palette**: images are downscaled to 256 px on the long edge before the
  colors are read (this bounds memory and speeds things up without changing the
  result). Median-cut quantization, 2–12 colors.
- **Cron**: standard 5-field Unix cron plus the `@hourly`/`@daily`/`@weekly`/
  `@monthly`/`@yearly`/`@annually`/`@midnight` nicknames. Month and weekday
  names are accepted. Vixie "either matches" rule is applied when both
  day-of-month and day-of-week are restricted. No seconds / Quartz syntax. Run
  times are computed in UTC internally and displayed in your local timezone.

### Testing

`npm test` runs the suite once. `npx vitest` (without `run`) starts watch mode,
re-running tests as you edit. The tests cover payload formatting, QR matrix
output (against a fixed known vector), EXIF/PNG stripping (metadata removed,
transparency and dimensions preserved), passphrase generation and entropy, the
strength penalties, CSV parsing/round-tripping, median-cut quantization, and
cron parsing/description/next-runs (computed in UTC for determinism).

### Privacy and security

- **No network calls at runtime.** Every library is vendored locally; the
  service worker only caches the app's own files. Nothing is uploaded.
- Every page sends a Content-Security-Policy that blocks third-party scripts and
  connections as a backstop.
- All content from files and inputs is written to the page as text (never as
  HTML), so a malicious file cannot inject scripts.
- The app stores nothing — no cookies, no localStorage. Reloading clears
  everything, including your chosen theme.

### Updating the offline cache

When you change files and redeploy, bump `CACHE_VERSION` in `sw.js` (e.g. `v1`
→ `v2`). The service worker deletes old caches on activation, so visitors get
the new version instead of stale files.

### Troubleshooting

- **Blank page / "needs JavaScript".** Enable JavaScript and reload.
- **Pages don't load over `file://`.** Use a local server (Step 3) — module
  scripts and the service worker require `http://` or `https://`.
- **A QR code won't generate.** The input may be too large; shorten it or lower
  the error-correction level.
- **EXIF says "Not a JPEG or PNG".** Only those two formats are supported.
- **Old version keeps showing after a deploy.** Bump `CACHE_VERSION` in `sw.js`.

---

## 4. Glossary

- **Static site** — a website made only of files (HTML/CSS/JS) with no server
  program running behind it. GitHub Pages can host these for free.
- **Client-side** — code that runs in the visitor's browser, on their device,
  rather than on a server.
- **PWA (Progressive Web App)** — a website that can be "installed" to a phone
  or desktop and work offline, using a manifest and a service worker.
- **Manifest** — a small file (`manifest.webmanifest`) describing the app's
  name, icons, and colors so it can be installed.
- **Service worker** — a background script the browser keeps to serve cached
  files when offline.
- **Cache / cache version** — saved copies of the app's files. The version
  string lets a new deploy replace old saved copies.
- **CSP (Content-Security-Policy)** — a browser rule, set per page, that
  restricts what the page may load or connect to; here it blocks anything
  third-party.
- **EXIF** — hidden metadata stored inside a photo file (camera model, date,
  and often GPS coordinates of where it was taken).
- **Metadata** — data about data; here, the hidden information attached to a
  photo or file rather than the picture itself.
- **PNG chunk** — a PNG file is a series of labeled blocks ("chunks"); some hold
  the image, others hold optional text/metadata.
- **Orientation tag** — a small EXIF value saying how a photo should be rotated
  for display; kept so cleaned photos are not shown sideways.
- **Diceware** — a method of building passphrases by choosing random words from
  a numbered list, originally selected with dice.
- **EFF wordlist** — the Electronic Frontier Foundation's 7,776-word list
  designed for diceware passphrases.
- **Entropy (bits)** — a measure of unpredictability; more bits means
  exponentially harder to guess.
- **CSV** — "comma-separated values", a plain-text table format.
- **JSON** — "JavaScript Object Notation", a common structured-data text format.
- **Delimiter** — the character that separates fields in a CSV (a comma by
  default).
- **Median cut** — an algorithm that repeatedly splits a cloud of pixel colors
  into groups to find a small representative palette.
- **Quantization** — reducing many colors down to a small set.
- **Cron** — a compact text format for describing repeating schedules (used by
  the Unix `cron` scheduler).
- **UTC** — Coordinated Universal Time, a timezone-independent reference used
  internally so calculations are consistent everywhere.
- **ES modules** — the standard way modern browsers load JavaScript split across
  files using `import`/`export`.
- **Vitest** — the test runner used to check the tool logic automatically.
- **npm** — the package manager bundled with Node.js, used here to install the
  test tools and run `npm test`.
- **localhost** — your own computer, when acting as a web server you connect to
  from the same machine.
- **Port** — a numbered channel on your computer (e.g. 8080) that a local server
  listens on.
