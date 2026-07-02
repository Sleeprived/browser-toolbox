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
    expect(normalizeHex('0xDEADbeef')).toBe('deadbeef'); // leading '0x' prefix is stripped whole
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

describe('normalizeHex algorithm-label prefixes (checksum paste tolerance)', () => {
  it('strips sha256:/SHA-512:/md5:-style prefixes', () => {
    expect(normalizeHex('sha256:DEADbeef')).toBe('deadbeef');
    expect(normalizeHex('SHA-512: dead beef')).toBe('deadbeef');
    expect(normalizeHex('  sha1 = deadbeef')).toBe('deadbeef');
    expect(normalizeHex('md5:d41d8cd9')).toBe('d41d8cd9');
    expect(normalizeHex('sha256:0xDEADBEEF')).toBe('deadbeef');
  });
  it('does not eat leading hex that merely looks label-ish', () => {
    expect(normalizeHex('abc123')).toBe('abc123');
    expect(normalizeHex('5abc123')).toBe('5abc123');
  });
  it('hexEquals matches a labeled checksum against a computed digest', () => {
    expect(hexEquals('deadbeef', 'sha256:DE:AD:BE:EF')).toBe(true);
  });
  it('strips sha3-256:, sha512/256:, sha256sum =, and BSD-style labels', () => {
    expect(normalizeHex('sha3-256: deadbeef')).toBe('deadbeef');
    expect(normalizeHex('sha512/256:deadbeef')).toBe('deadbeef');
    expect(normalizeHex('sha256sum = deadbeef')).toBe('deadbeef');
    expect(normalizeHex('SHA256 (file.iso) = deadbeef')).toBe('deadbeef');
  });
  it('cuts a pasted checker line after the digest instead of folding in the filename', () => {
    const digest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(normalizeHex(`${digest}  fedora.iso`)).toBe(digest);
    expect(normalizeHex(`${digest} *disc-image.bin`)).toBe(digest);
    expect(hexEquals(digest, `${digest}  fedora.iso`)).toBe(true);
  });
  it('rejoins a digest wrapped across whitespace instead of truncating it', () => {
    const half1 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const half2 = 'a3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b850';
    expect(normalizeHex(`${half1}\n${half2}`)).toBe(half1 + half2); // wrapped SHA-512
    expect(normalizeHex(`${half1} ${half2} fedora.iso`)).toBe(half1); // filename still cuts
  });
});
