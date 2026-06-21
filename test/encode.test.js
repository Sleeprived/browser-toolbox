import { describe, it, expect } from 'vitest';
import {
  toBase64, fromBase64, toHex, fromHex, toUrl, fromUrl, toHtml, fromHtml,
  convert, EncodeError,
} from '../src/encode/encode.js';

describe('base64', () => {
  it('round-trips UTF-8 text', () => {
    expect(toBase64('héllo 😀')).toBe(toBase64('héllo 😀'));
    expect(fromBase64(toBase64('héllo 😀'))).toBe('héllo 😀');
  });
  it('supports base64url (no padding, - _)', () => {
    const u = toBase64('??>>', { urlSafe: true });
    expect(u).not.toMatch(/[+/=]/);
    expect(fromBase64(u, { urlSafe: true })).toBe('??>>');
  });
  it('throws on invalid base64', () => {
    expect(() => fromBase64('not*base64')).toThrow(EncodeError);
  });
});

describe('hex', () => {
  it('round-trips and lowercases', () => {
    expect(toHex('AB')).toBe('4142');
    expect(fromHex('4142')).toBe('AB');
    expect(fromHex('48 65 6c 6c 6f')).toBe('Hello'); // tolerates whitespace
  });
  it('rejects odd length and non-hex', () => {
    expect(() => fromHex('abc')).toThrow(EncodeError);
    expect(() => fromHex('zz')).toThrow(EncodeError);
  });
});

describe('url', () => {
  it('round-trips', () => {
    expect(toUrl('a b&c')).toBe('a%20b%26c');
    expect(fromUrl('a%20b%26c')).toBe('a b&c');
  });
  it('throws on malformed percent-encoding', () => {
    expect(() => fromUrl('%zz')).toThrow(EncodeError);
  });
});

describe('html entities', () => {
  it('encodes the five special characters', () => {
    expect(toHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  it('decodes named, decimal and hex entities without innerHTML', () => {
    expect(fromHtml('&lt;b&gt;&amp;&#169;&#xA9;&nbsp;')).toBe('<b>&©© ');
  });
});

describe('convert dispatch', () => {
  it('routes by format and mode', () => {
    expect(convert('AB', 'hex', 'encode')).toBe('4142');
    expect(convert('4142', 'hex', 'decode')).toBe('AB');
  });
});
