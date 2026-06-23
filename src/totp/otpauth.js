// Parse a TOTP configuration from either a bare base32 secret or an otpauth:// URI
// (the format authenticator-setup QR codes encode). Pure — no DOM, no network.
// Returns { type, secret, digits, period, algorithm, label, issuer } or null for
// empty input. The secret is the raw base32 (validated downstream by base32Decode);
// label/issuer are display-only. Out-of-range or malformed params fall back to the
// RFC 6238 defaults rather than throwing.

const ALGOS = {
  SHA1: 'SHA-1', 'SHA-1': 'SHA-1',
  SHA256: 'SHA-256', 'SHA-256': 'SHA-256',
  SHA512: 'SHA-512', 'SHA-512': 'SHA-512',
};

function intParam(raw, fallback, min, max) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function dec(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function parseOtpauth(value) {
  const v = (typeof value === 'string' ? value : '').trim();
  if (!v) return null;

  // Bare secret: treat the whole input as a base32 secret with RFC 6238 defaults.
  if (!/^otpauth:\/\//i.test(v)) {
    return { type: 'totp', secret: v.replace(/\s+/g, ''), digits: 6, period: 30, algorithm: 'SHA-1', label: '', issuer: '' };
  }

  const typeM = v.match(/^otpauth:\/\/([a-z]+)\//i);
  const secretM = v.match(/[?&]secret=([^&]+)/i);
  const digitsM = v.match(/[?&]digits=([^&]+)/i);
  const periodM = v.match(/[?&]period=([^&]+)/i);
  const algoM = v.match(/[?&]algorithm=([^&]+)/i);
  const issuerM = v.match(/[?&]issuer=([^&]+)/i);
  // Label is the path between "otpauth://<type>/" and the query — often "Issuer:account".
  const labelM = v.match(/^otpauth:\/\/[a-z]+\/([^?]*)/i);

  return {
    type: typeM ? typeM[1].toLowerCase() : 'totp',
    secret: (secretM ? dec(secretM[1]) : '').replace(/\s+/g, ''),
    digits: intParam(digitsM && digitsM[1], 6, 1, 10),
    period: intParam(periodM && periodM[1], 30, 1, 3600),
    algorithm: ALGOS[(algoM ? dec(algoM[1]).toUpperCase() : '')] || 'SHA-1',
    label: labelM ? dec(labelM[1]).trim() : '',
    issuer: issuerM ? dec(issuerM[1]).trim() : '',
  };
}
