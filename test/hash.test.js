import { describe, it, expect } from 'vitest';
import { bytesToHex, normalizeHex, hexEquals, HASH_ALGOS } from '../src/hash/hash.js';

describe('bytesToHex', () => {
  it('lowercase, zero-padded, byte order preserved', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 16, 255, 171]))).toBe('000f10ffab');
  });
  it('empty input is empty string', () => {
    expect(bytesToHex(new Uint8Array(0))).toBe('');
  });
});

describe('normalizeHex', () => {
  it('lowercases and strips non-hex characters (spaces, colons, 0x)', () => {
    expect(normalizeHex('AB:CD ef')).toBe('abcdef');
    expect(normalizeHex('0xDEADbeef')).toBe('0deadbeef'); // '0x' prefix: 'x' stripped, '0' kept
    expect(normalizeHex('  d4 1d\n8c  ')).toBe('d41d8c');
  });
  it('non-string yields empty', () => {
    expect(normalizeHex(null)).toBe('');
    expect(normalizeHex(undefined)).toBe('');
  });
});

describe('hexEquals', () => {
  it('matches across case and separators', () => {
    expect(hexEquals('DA39A3EE', 'da:39:a3:ee')).toBe(true);
  });
  it('non-empty requirement: two empties are NOT equal', () => {
    expect(hexEquals('', '')).toBe(false);
    expect(hexEquals('   ', 'xyz')).toBe(false); // both normalize to ''
  });
  it('different digests do not match', () => {
    expect(hexEquals('abc123', 'abc124')).toBe(false);
  });
});

describe('HASH_ALGOS', () => {
  it('offers the Web Crypto digest algorithms and excludes MD5', () => {
    expect(HASH_ALGOS).toContain('SHA-256');
    expect(HASH_ALGOS).toContain('SHA-512');
    expect(HASH_ALGOS).not.toContain('MD5');
  });
});

// Cross-check bytesToHex against a real Web Crypto digest when available (Node 20+
// exposes globalThis.crypto.subtle), proving the UI's digest->hex path is correct.
describe('digest -> hex (Web Crypto, if available)', () => {
  it('SHA-256 of empty input is the known constant', async () => {
    if (!(globalThis.crypto && globalThis.crypto.subtle)) return; // skip where unavailable
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(0));
    expect(bytesToHex(new Uint8Array(buf))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
