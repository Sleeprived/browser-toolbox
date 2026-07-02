// Timestamp & UUID core. Pure — no DOM.
//
// parseEpoch(input)  → { ms, unit: 's'|'ms' } | { error }   (auto-detects s vs ms)
// dateToEpoch(date)  → { s, ms }
// formatBoth(ms)     → { local, utc, iso }
// generateUuid()     → RFC 4122 v4 string (crypto-random)
// parseUuid(input)   → { version, variant, timestamp? } | { error }

// Epochs below this magnitude are read as SECONDS (covers dates to year 5138);
// larger values are milliseconds. Negatives (pre-1970) use the same magnitude rule.
const SECONDS_CUTOFF = 1e11;
// Reject epochs outside JS Date's representable range (±8.64e15 ms).
const MAX_EPOCH_MS = 8.64e15;

export function parseEpoch(input) {
  const s = String(input ?? '').trim();
  if (s === '') return { error: 'Enter a Unix timestamp.' };
  if (!/^-?\d+$/.test(s)) return { error: 'Not a valid timestamp — digits only (Unix seconds or milliseconds).' };
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return { error: 'That number is too large to be a timestamp.' };
  const unit = Math.abs(n) < SECONDS_CUTOFF ? 's' : 'ms';
  const ms = unit === 's' ? n * 1000 : n;
  if (Math.abs(ms) > MAX_EPOCH_MS) return { error: 'That timestamp is outside the representable date range.' };
  return { ms, unit };
}

export function formatBoth(ms) {
  const d = new Date(ms);
  return {
    local: d.toLocaleString(undefined, { timeZoneName: 'short' }),
    utc: d.toUTCString(),
    iso: d.toISOString(),
  };
}

export function dateToEpoch(date) {
  const ms = date.getTime();
  return { s: Math.floor(ms / 1000), ms };
}

export function generateUuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('Secure randomness (Web Crypto) is not available in this browser.');
  }
  // Manual v4: 122 random bits, version/variant nibbles forced.
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Offset between the Gregorian epoch (1582-10-15, UUID v1 time zero) and the
// Unix epoch, in 100-nanosecond intervals.
const GREGORIAN_TO_UNIX_100NS = 122192928000000000n;

export function parseUuid(input) {
  // Braces are stripped only as a balanced pair — "{uuid" / "uuid}" stay invalid.
  const s = String(input ?? '').trim().toLowerCase().replace(/^urn:uuid:/, '').replace(/^\{(.*)\}$/, '$1');
  if (s === '') return { error: 'Enter a UUID.' };
  if (!UUID_RE.test(s)) return { error: 'Not a valid UUID — expected 8-4-4-4-12 hex digits.' };

  const version = parseInt(s[14], 16);
  const variantNibble = parseInt(s[19], 16);
  let variant;
  if (variantNibble < 8) variant = 'NCS (reserved)';
  else if (variantNibble < 0xc) variant = 'RFC 4122';
  else if (variantNibble < 0xe) variant = 'Microsoft (reserved)';
  else variant = 'Future (reserved)';

  const out = { uuid: s, version, variant };

  // Timestamp where applicable: v1 (Gregorian 100ns) and v7 (Unix ms).
  if (version === 1 && variant === 'RFC 4122') {
    const timeLow = s.slice(0, 8);
    const timeMid = s.slice(9, 13);
    const timeHigh = s.slice(15, 18); // version nibble removed
    const ticks = BigInt(`0x${timeHigh}${timeMid}${timeLow}`);
    // Floor (not truncate): pre-1970 tick counts must round downward.
    const diff = ticks - GREGORIAN_TO_UNIX_100NS;
    const unixMs = Number(diff / 10000n - (diff % 10000n < 0n ? 1n : 0n));
    if (Math.abs(unixMs) <= MAX_EPOCH_MS) out.timestampMs = unixMs;
  } else if (version === 7 && variant === 'RFC 4122') {
    out.timestampMs = parseInt(s.slice(0, 8) + s.slice(9, 13), 16);
  }
  return out;
}
