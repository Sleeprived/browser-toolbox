// Offline TOTP/HOTP per RFC 6238 / RFC 4226, plus an RFC 4648 base32 decoder for
// the secrets that authenticator setup screens hand out. HMAC is computed with
// the browser's native Web Crypto. Pure logic — no DOM, no network, no storage.

export class TotpError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TotpError';
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Decode a base32 string to bytes. Tolerant of lowercase, spaces, and missing
// padding (authenticator QR/secret fields vary wildly). Throws on bad chars.
export function base32Decode(input) {
  if (typeof input !== 'string') throw new TotpError('base32 input must be a string.');
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (clean === '') return new Uint8Array(0);

  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new TotpError(`Invalid base32 character: "${ch}".`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

const HASH_NAMES = { 'SHA-1': 'SHA-1', SHA1: 'SHA-1', 'SHA-256': 'SHA-256', SHA256: 'SHA-256', 'SHA-512': 'SHA-512', SHA512: 'SHA-512' };

function getSubtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new TotpError('Web Crypto is not available in this environment.');
  return c.subtle;
}

// 8-byte big-endian counter. Handles values up to 2^53 without bitwise overflow.
function counterBytes(counter) {
  const buf = new Uint8Array(8);
  let c = Math.floor(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  return buf;
}

// RFC 4226 HOTP. keyBytes: Uint8Array, counter: integer, digits: 1-10.
export async function hotp(keyBytes, counter, digits = 6, algorithm = 'SHA-1') {
  const hash = HASH_NAMES[algorithm];
  if (!hash) throw new TotpError(`Unsupported HMAC algorithm: ${algorithm}.`);
  if (!Number.isInteger(digits) || digits < 1 || digits > 10) {
    throw new TotpError('digits must be an integer between 1 and 10.');
  }
  const subtle = getSubtle();
  // `hash` is a plain string ('SHA-1'|'SHA-256'|'SHA-512'); a string is a valid
  // AlgorithmIdentifier, matching how crypto.js passes the PBKDF2 hash.
  const key = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['sign']);
  const mac = new Uint8Array(await subtle.sign('HMAC', key, counterBytes(counter)));

  // Dynamic truncation (RFC 4226 §5.3).
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  const otp = binary % 10 ** digits;
  return String(otp).padStart(digits, '0');
}

// RFC 6238 TOTP. keyBytes: Uint8Array. opts: { time (Unix seconds), period=30,
// digits=6, algorithm='SHA-1' }.
export async function totp(keyBytes, opts = {}) {
  const { time, period = 30, digits = 6, algorithm = 'SHA-1' } = opts;
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) throw new TotpError('time (Unix seconds) must be a non-negative number.');
  if (!Number.isInteger(period) || period < 1) throw new TotpError('period must be a positive integer.');
  const counter = Math.floor(time / period);
  return hotp(keyBytes, counter, digits, algorithm);
}

// Seconds left in the current time-step, for the countdown UI.
export function secondsRemaining(time, period = 30) {
  return period - (Math.floor(time) % period);
}
