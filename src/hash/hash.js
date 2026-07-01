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
// "0x"/"0X" prefix (after any leading whitespace), then drop everything that is not a
// hex digit (whitespace, colons, line breaks). So a checksum copied as "AB:CD ef",
// "0xABCDef", or "  0xABCDef" all match a computed "abcdef".
export function normalizeHex(s) {
  return (typeof s === 'string' ? s : '').toLowerCase().replace(/^\s*0x/, '').replace(/[^0-9a-f]/g, '');
}

// True only if both inputs normalize to the same non-empty hex string.
export function hexEquals(a, b) {
  const na = normalizeHex(a);
  const nb = normalizeHex(b);
  return na.length > 0 && na === nb;
}
