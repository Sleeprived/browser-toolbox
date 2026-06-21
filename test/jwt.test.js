import { describe, it, expect } from 'vitest';
import { decodeJwt, describeClaims, securityFlags, expiryStatus, JwtError } from '../src/jwt/jwt.js';

// Helper: build a base64url JWT segment from an object (no signing).
function seg(obj) {
  const json = JSON.stringify(obj);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function token(header, payload, sig = 'sig') {
  return `${seg(header)}.${seg(payload)}.${sig}`;
}

describe('decodeJwt', () => {
  it('decodes header and payload', () => {
    const t = token({ alg: 'HS256', typ: 'JWT' }, { sub: '123', name: 'Adá' });
    const d = decodeJwt(t);
    expect(d.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(d.payload).toEqual({ sub: '123', name: 'Adá' });
    expect(d.signingInput).toBe(t.split('.').slice(0, 2).join('.'));
  });
  it('rejects malformed tokens', () => {
    expect(() => decodeJwt('only.two')).toThrow(JwtError);
    expect(() => decodeJwt('a.b.c')).toThrow(JwtError); // not valid base64url JSON
  });
});

describe('claims + flags', () => {
  const NOW = 1_700_000_000_000; // fixed ms
  it('humanizes exp relative to now', () => {
    const payload = { exp: NOW / 1000 + 3600 }; // +1h
    const claims = describeClaims(payload, NOW);
    const exp = claims.find((c) => c.claim === 'exp');
    expect(exp.relative).toMatch(/in 1 hour/);
  });
  it('flags alg:none and missing exp', () => {
    expect(securityFlags({ alg: 'none' }, {})).toEqual(expect.arrayContaining([expect.stringMatching(/none/i)]));
    expect(securityFlags({ alg: 'HS256' }, {})).toEqual(expect.arrayContaining([expect.stringMatching(/exp/i)]));
    expect(securityFlags({ alg: 'HS256' }, { exp: 1 })).toEqual([]);
  });
  it('computes expiry status', () => {
    expect(expiryStatus({ exp: NOW / 1000 - 10 }, NOW)).toBe('expired');
    expect(expiryStatus({ nbf: NOW / 1000 + 10 }, NOW)).toBe('not-yet-valid');
    expect(expiryStatus({ exp: NOW / 1000 + 10 }, NOW)).toBe('active');
  });
  it('does not throw on an out-of-range time claim and returns a fallback string', () => {
    let claims;
    expect(() => { claims = describeClaims({ exp: 99999999999999 }, NOW); }).not.toThrow();
    const exp = claims.find((c) => c.claim === 'exp');
    expect(exp.iso).toMatch(/out of representable date range/);
  });
  it('still yields an ISO date for a normal exp', () => {
    const claims = describeClaims({ exp: NOW / 1000 + 3600 }, NOW);
    const exp = claims.find((c) => c.claim === 'exp');
    expect(exp.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
