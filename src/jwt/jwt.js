// JWT decode + inspection engine. Pure: decode (no verification), humanize the
// time claims, and surface security flags. HMAC signature verification is done in
// the UI (async crypto.subtle) and is NOT part of this pure module.

export class JwtError extends Error {}

function b64urlToString(seg) {
  let s = String(seg).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  let bin;
  try { bin = atob(s); } catch { throw new JwtError('A token segment is not valid base64url.'); }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function decodeJwt(token) {
  if (typeof token !== 'string') throw new JwtError('Token must be a string.');
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new JwtError('A JWT has three dot-separated parts (header.payload.signature).');
  let header;
  let payload;
  try { header = JSON.parse(b64urlToString(parts[0])); } catch (e) {
    throw e instanceof JwtError ? e : new JwtError('Header is not valid JSON.');
  }
  try { payload = JSON.parse(b64urlToString(parts[1])); } catch (e) {
    throw e instanceof JwtError ? e : new JwtError('Payload is not valid JSON.');
  }
  return { header, payload, signature: parts[2], signingInput: `${parts[0]}.${parts[1]}` };
}

function relativeTime(deltaMs) {
  const abs = Math.abs(deltaMs);
  const units = [['day', 86400000], ['hour', 3600000], ['minute', 60000], ['second', 1000]];
  let label = 'less than a second';
  for (const [name, ms] of units) {
    if (abs >= ms) { const n = Math.floor(abs / ms); label = `${n} ${name}${n !== 1 ? 's' : ''}`; break; }
  }
  return deltaMs >= 0 ? `in ${label}` : `${label} ago`;
}

const TIME_CLAIMS = [['exp', 'Expires'], ['iat', 'Issued at'], ['nbf', 'Not valid before'], ['auth_time', 'Authenticated at']];

export function describeClaims(payload, nowMs) {
  const out = [];
  if (!payload || typeof payload !== 'object') return out;
  for (const [claim, label] of TIME_CLAIMS) {
    const v = payload[claim];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const ms = v * 1000;
      const date = new Date(ms);
      const valid = !Number.isNaN(date.getTime());
      const iso = valid ? date.toISOString() : `epoch ${v} (out of representable date range)`;
      // Suppress the relative string for an out-of-range epoch — relativeTime would
      // otherwise emit meaningless scientific notation (e.g. "in 1.15e+25 days").
      out.push({ claim, label, epoch: v, iso, relative: valid ? relativeTime(ms - nowMs) : '' });
    }
  }
  return out;
}

export function securityFlags(header, payload) {
  const warnings = [];
  const alg = header && header.alg;
  if (typeof alg === 'string' && alg.toLowerCase() === 'none') {
    warnings.push('Algorithm is "none": this token is unsigned and trivially forgeable.');
  }
  if (!payload || payload.exp == null) {
    warnings.push('No "exp" claim: this token has no expiry.');
  }
  return warnings;
}

export function expiryStatus(payload, nowMs) {
  const nowSec = nowMs / 1000;
  if (payload && typeof payload.exp === 'number' && nowSec >= payload.exp) return 'expired';
  if (payload && typeof payload.nbf === 'number' && nowSec < payload.nbf) return 'not-yet-valid';
  return 'active';
}
