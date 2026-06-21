import { describe, it, expect } from 'vitest';
import { base32Decode, hotp, totp, secondsRemaining } from '../src/vault/totp.js';

const enc = (s) => new TextEncoder().encode(s);

// RFC 6238 Appendix B seeds.
const SEED_SHA1 = enc('12345678901234567890'); // 20 bytes
const SEED_SHA256 = enc('12345678901234567890123456789012'); // 32 bytes
const SEED_SHA512 = enc('1234567890123456789012345678901234567890123456789012345678901234'); // 64 bytes

describe('base32Decode (RFC 4648 vectors)', () => {
  const dec = (s) => new TextDecoder().decode(base32Decode(s));
  it('decodes the canonical vectors', () => {
    expect(dec('')).toBe('');
    expect(dec('MY======')).toBe('f');
    expect(dec('MZXQ====')).toBe('fo');
    expect(dec('MZXW6===')).toBe('foo');
    expect(dec('MZXW6YQ=')).toBe('foob');
    expect(dec('MZXW6YTB')).toBe('fooba');
    expect(dec('MZXW6YTBOI======')).toBe('foobar');
  });
  it('tolerates lowercase, spaces, and missing padding', () => {
    expect(dec('mzxw6ytboi')).toBe('foobar');
    expect(dec('MZXW 6YTB OI')).toBe('foobar');
  });
  it('throws on an invalid base32 character', () => {
    expect(() => base32Decode('M8======')).toThrow(); // 8 and 1/0 are not base32
  });
  it('throws on non-ASCII input (corrupted/auto-formatted secret)', () => {
    expect(() => base32Decode('MZXW6YTBOI😀')).toThrow(/Invalid base32/);
  });
});

describe('totp (RFC 6238 test vectors, SHA-1)', () => {
  const cases8 = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [time, code] of cases8) {
    it(`t=${time} -> ${code} (8 digits)`, async () => {
      expect(await totp(SEED_SHA1, { time, digits: 8 })).toBe(code);
    });
  }
  it('produces the 6-digit code (default) for t=59', async () => {
    expect(await totp(SEED_SHA1, { time: 59 })).toBe('287082');
  });
});

describe('totp algorithm switching (RFC 6238 vectors at t=59)', () => {
  it('SHA-256', async () => {
    expect(await totp(SEED_SHA256, { time: 59, digits: 8, algorithm: 'SHA-256' })).toBe('46119246');
  });
  it('SHA-512', async () => {
    expect(await totp(SEED_SHA512, { time: 59, digits: 8, algorithm: 'SHA-512' })).toBe('90693936');
  });
});

describe('hotp', () => {
  // RFC 4226 Appendix D vectors (same SHA-1 seed).
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676'];
  for (let i = 0; i < expected.length; i++) {
    it(`counter=${i} -> ${expected[i]}`, async () => {
      expect(await hotp(SEED_SHA1, i, 6)).toBe(expected[i]);
    });
  }
});

describe('hotp digit bounds', () => {
  it('accepts the 1- and 10-digit boundaries', async () => {
    expect(await hotp(SEED_SHA1, 0, 1)).toHaveLength(1);
    expect(await hotp(SEED_SHA1, 0, 10)).toHaveLength(10);
  });
  it('rejects out-of-range or non-integer digit counts', async () => {
    await expect(hotp(SEED_SHA1, 0, 0)).rejects.toThrow(/between 1 and 10/);
    await expect(hotp(SEED_SHA1, 0, 11)).rejects.toThrow(/between 1 and 10/);
    await expect(hotp(SEED_SHA1, 0, -1)).rejects.toThrow(/between 1 and 10/);
  });
});

describe('secondsRemaining', () => {
  it('counts down within the period', () => {
    expect(secondsRemaining(0, 30)).toBe(30);
    expect(secondsRemaining(1, 30)).toBe(29);
    expect(secondsRemaining(29, 30)).toBe(1);
    expect(secondsRemaining(30, 30)).toBe(30);
  });
});
