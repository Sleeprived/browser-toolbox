// Pure helpers for the Hash & Checksum tool. The hashing itself uses the browser's
// Web Crypto (crypto.subtle.digest) in the UI; these are the testable pieces.
// No DOM, no network.

// Algorithms Web Crypto's subtle.digest supports. (MD5 is intentionally absent —
// Web Crypto does not provide it, and it is unfit for integrity anyway.)
export const HASH_ALGOS = ['SHA-256', 'SHA-1', 'SHA-384', 'SHA-512'];

export function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// Normalize a user-pasted checksum for comparison: lowercase, strip a leading
// algorithm label ("sha256:", "SHA-512:", "sha3-256:", "md5 = ", "sha256sum =",
// BSD "SHA256 (file.iso) ="), strip a leading "0x"/"0X" prefix (after any
// leading whitespace), then drop everything that is not a hex digit
// (whitespace, colons, line breaks). A whole checker line ("<digest>  file.iso")
// is cut after the digest so the filename's hex letters are not folded in.
// So "AB:CD ef", "0xABCDef", and "sha256:abcdef" all match a computed "abcdef".
export function normalizeHex(s) {
  const t = (typeof s === 'string' ? s : '')
    .toLowerCase()
    .replace(/^\s*(?:sha[0-9/-]{0,8}(?:sum)?|md-?5(?:sum)?)\s*(?:\([^)]*\))?\s*[:=]\s*/, '')
    .replace(/^\s*0x/, '')
    .trim();
  // If the first whitespace-delimited token is already a plausible digest
  // (≥32 hex chars once separators are dropped), the rest of the line is a
  // filename or annotation — ignore it. Exception: when EVERY token is
  // hex-ish, the whitespace is line-wrapping inside one digest (a long
  // SHA-512 copied from a wrapped terminal line), so rejoin instead of
  // truncating to the first fragment.
  const tokens = t.split(/\s+/);
  const first = tokens[0].replace(/[^0-9a-f]/g, '');
  if (first.length >= 32 && tokens.length > 1 && !tokens.every((tok) => /^[0-9a-f:]+$/.test(tok))) {
    return first;
  }
  return t.replace(/[^0-9a-f]/g, '');
}

// True only if both inputs normalize to the same non-empty hex string.
export function hexEquals(a, b) {
  const na = normalizeHex(a);
  const nb = normalizeHex(b);
  return na.length > 0 && na === nb;
}
