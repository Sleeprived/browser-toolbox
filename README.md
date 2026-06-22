# Browser Toolbox

**▶ Use it live: https://sleeprived.github.io/browser-toolbox/**

Eleven handy tools that run entirely in your web browser — no upload, no account,
no server, works offline. Open the link on a phone or desktop, or **Add to Home
Screen** to install it like an app.

## Tools
- **QR Code Studio** — QR codes for text, links, WiFi, contacts, email, SMS, map
  locations, and phone numbers; custom colors, sizes, PNG/SVG, or copy to clipboard.
  Also **reads** a QR code from an image and runs a local safety check that flags
  suspicious links (decoded in your browser, no upload, no guarantees).
- **EXIF Cleaner** — strip GPS, camera, and timestamp metadata (plus XMP, IPTC,
  and hidden trailing data) from JPEG and PNG photos.
- **Passphrase Generator** — strong diceware passphrases, plus an offline password
  strength meter.
- **Password Vault** — a private, offline password manager. Your entries live in
  one file you keep, encrypted with AES-256-GCM and a PBKDF2-stretched master
  password. Includes offline TOTP/2FA codes, tags, custom fields, password
  history, a built-in generator, reveal-in-place for saved passwords, and CSV
  import from other managers (Chrome, Firefox, Bitwarden, LastPass, 1Password,
  KeePass). There is no cloud and **no password reset** — you own and back up the
  file.
- **CSV ⇄ JSON Workbench** — view a CSV as a table, sort/rename/drop columns, and
  convert to JSON and back.
- **Color Palette Extractor** — pull the dominant colors from an image; export as
  hex, CSS variables, or JSON.
- **Cron Explainer** — translate a cron schedule into plain English and preview
  its next run times.
- **Encode / Decode Multitool** — convert text to and from Base64, Hex, URL
  encoding, and HTML entities.
- **JWT Decoder** — decode and inspect JSON Web Tokens, with optional HS256/384/512
  signature verification.
- **Image Resizer** — resize and compress JPEG, PNG, and WebP images, with
  automatic photo-rotation correction.
- **Morse Code Studio** — translate text to and from International Morse Code,
  then play it as audio, download it as a WAV, flash it on screen, or vibrate it
  on supported phones. Adjustable speed (with Farnsworth) and tone.

## Privacy
Everything runs on your device. Nothing you type or drop is ever uploaded — no
accounts, no tracking — and it works offline once loaded.

## Security & trust — Password Vault
The vault is encrypted with AES-256-GCM under a key stretched from your master
password with PBKDF2-HMAC-SHA256 (600,000 iterations). The cryptography is
standard; its real strength is **your master password**. Two things are worth
understanding before you rely on it:

- **Use a strong, unique master password — ideally the built-in generator.**
  Anyone who obtains your vault file can guess passwords against it offline, as
  fast as their hardware allows, with no rate limit. A generated passphrase (5+
  words) or a long random password is effectively uncrackable; a short or
  human-guessable one is not. The strength meter is a guide, not a guarantee.
- **You are trusting this site to serve honest code on every load.** Like any
  web-delivered tool, the page's JavaScript decrypts your vault in your browser,
  so a compromise of the hosting could in principle ship tampered code. For the
  strongest trust model, download a release and open `vault.html` from your own
  disk (or install the PWA) so the code is frozen at a version you control, and
  always keep backups of your encrypted file — there is no password reset.

## Updates / Troubleshooting
The app installs as a PWA and serves the cached build for offline use. After a
new version is deployed, the cached build is shown first and the update is fetched
in the background; you get the latest on the **next** load. If something looks
out of date, just refresh once more.

## Credits
Passphrase wordlist: [EFF Large Wordlist](https://www.eff.org/dice)
(CC BY 3.0 US).
