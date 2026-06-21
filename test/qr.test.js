import { describe, it, expect, beforeAll } from 'vitest';
import qrcodeLib from 'qrcode-generator';
import {
  formatText,
  formatUrl,
  formatWifi,
  formatVcard,
  formatEmail,
  formatSms,
  formatGeo,
  formatTel,
  escapeWifi,
  escapeVcard,
} from '../src/qr/payloads.js';
import {
  utf8ByteLength,
  qrVersionFromSize,
  contrastRatio,
  colorWarning,
} from '../src/qr/quality.js';

let getQrMatrix;
let matrixToBitString;

beforeAll(async () => {
  // The browser loads qrcode-generator as a global <script>; mirror that here.
  globalThis.qrcode = qrcodeLib;
  ({ getQrMatrix, matrixToBitString } = await import('../src/qr/matrix.js'));
});

describe('payload formatters', () => {
  it('formats plain text passthrough', () => {
    expect(formatText('hello')).toBe('hello');
  });

  it('adds https:// to a bare domain but respects existing schemes', () => {
    expect(formatUrl('example.com')).toBe('https://example.com');
    expect(formatUrl('http://x.com')).toBe('http://x.com');
    expect(formatUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
  });

  it('formats a WPA WiFi payload', () => {
    expect(formatWifi({ ssid: 'MyNet', password: 'secret', encryption: 'WPA' }))
      .toBe('WIFI:T:WPA;S:MyNet;P:secret;;');
  });

  it('escapes WiFi special characters', () => {
    expect(escapeWifi('p@ss;word')).toBe('p@ss\\;word');
    expect(formatWifi({ ssid: 'a,b:c', password: 'x"y', encryption: 'WPA' }))
      .toBe('WIFI:T:WPA;S:a\\,b\\:c;P:x\\"y;;');
  });

  it('omits the password for open networks', () => {
    expect(formatWifi({ ssid: 'Cafe', encryption: 'nopass' }))
      .toBe('WIFI:T:nopass;S:Cafe;;');
  });

  it('marks hidden networks', () => {
    expect(formatWifi({ ssid: 'S', password: 'P', hidden: true }))
      .toBe('WIFI:T:WPA;S:S;P:P;H:true;;');
  });

  it('escapes carriage returns in vCard values (no raw CR)', () => {
    const out = escapeVcard('a\r\nb');
    expect(out).not.toContain('\r');
    expect(out).toBe('a\\nb');
    expect(escapeVcard('a\rb')).toBe('a\\nb');
  });

  it('falls back to nopass for an unknown WiFi encryption value', () => {
    expect(formatWifi({ ssid: 'X', password: 'p', encryption: 'evil;injected' }))
      .toBe('WIFI:T:nopass;S:X;;');
    expect(formatWifi({ ssid: 'X', password: 'p', encryption: 'WEP' }))
      .toBe('WIFI:T:WEP;S:X;P:p;;');
  });

  it('strips whitespace from the email address', () => {
    expect(formatEmail({ to: ' a@b.com ' })).toBe('mailto:a@b.com');
    expect(formatEmail({ to: 'a @ b.com' })).toBe('mailto:a@b.com');
  });

  it('keeps only a leading + in SMS and tel numbers (drops interior +)', () => {
    expect(formatSms({ number: '+1+555', message: 'hi' })).toBe('SMSTO:+1555:hi');
    expect(formatTel({ number: '+1+555+123' })).toBe('tel:+1555123');
    expect(formatTel({ number: '1+555' })).toBe('tel:1555');
  });

  it('escapes vCard special characters', () => {
    expect(escapeVcard('Acme, Inc; HQ')).toBe('Acme\\, Inc\\; HQ');
    const v = formatVcard({ name: 'John; Doe', phone: '+1 555', email: 'j@x.com', org: 'Acme, Inc' });
    expect(v).toContain('FN:John\\; Doe');
    expect(v).toContain('ORG:Acme\\, Inc');
    expect(v).toContain('TEL;TYPE=CELL:+1 555');
    expect(v).toContain('EMAIL:j@x.com');
    expect(v.startsWith('BEGIN:VCARD\nVERSION:3.0')).toBe(true);
    expect(v.endsWith('END:VCARD')).toBe(true);
  });
});

describe('extended payload formatters (email / SMS / geo / tel)', () => {
  it('builds a mailto with percent-encoded subject and body', () => {
    expect(formatEmail({ to: 'a@b.com' })).toBe('mailto:a@b.com');
    expect(formatEmail({ to: 'a@b.com', subject: 'Hi there', body: 'a & b' }))
      .toBe('mailto:a@b.com?subject=Hi%20there&body=a%20%26%20b');
    expect(formatEmail({})).toBe('');
  });

  it('builds an SMSTO payload and strips non-dial characters from the number', () => {
    expect(formatSms({ number: '+1 (555) 123', message: 'call me' })).toBe('SMSTO:+1555123:call me');
    expect(formatSms({ number: '5551234' })).toBe('SMSTO:5551234');
    expect(formatSms({})).toBe('');
    expect(() => formatSms({ message: 'no number here' })).toThrow(/number/i);
  });

  it('builds geo: payloads and validates ranges', () => {
    expect(formatGeo({ lat: '40.4461', lng: '-79.9822' })).toBe('geo:40.4461,-79.9822');
    expect(formatGeo({ lat: '', lng: '' })).toBe('');
    expect(() => formatGeo({ lat: '91', lng: '0' })).toThrow(/Latitude/);
    expect(() => formatGeo({ lat: '0', lng: '200' })).toThrow(/Longitude/);
    expect(() => formatGeo({ lat: 'x', lng: '0' })).toThrow(/numbers/);
  });

  it('builds tel: payloads keeping only + and digits', () => {
    expect(formatTel({ number: '+1 (555) 867-5309' })).toBe('tel:+15558675309');
    expect(formatTel({})).toBe('');
  });
});

describe('QR quality helpers', () => {
  it('counts UTF-8 bytes (not characters)', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);       // 2-byte
    expect(utf8ByteLength('☃')).toBe(3);       // 3-byte
    expect(utf8ByteLength('😀')).toBe(4);       // surrogate pair → 4 bytes
  });

  it('derives the QR version from module count', () => {
    expect(qrVersionFromSize(21)).toBe(1);   // version 1 = 21×21
    expect(qrVersionFromSize(25)).toBe(2);
    expect(qrVersionFromSize(177)).toBe(40); // version 40 = 177×177
  });

  it('matrix output reports its version', () => {
    expect(getQrMatrix('HI', 'M').version).toBe(1);
  });

  it('computes contrast and flags risky color choices', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(colorWarning('#000000', '#ffffff')).toBeNull();      // ideal
    expect(colorWarning('#ffffff', '#000000')).toMatch(/inverted/i); // light-on-dark
    expect(colorWarning('#777777', '#888888')).toMatch(/contrast/i); // too low
  });
});

describe('QR matrix', () => {
  // Regression vector: the exact module matrix for "HELLO WORLD" at level M.
  const HELLO_WORLD_M = [
    '111111101000101111111',
    '100000101000101000001',
    '101110100000001011101',
    '101110101010101011101',
    '101110100111001011101',
    '100000100011101000001',
    '111111101010101111111',
    '000000001111100000000',
    '101101110101101001011',
    '011000010111111101100',
    '000001111101010100011',
    '101011011001000101010',
    '100010110110110000101',
    '000000001011001100101',
    '111111101011111110000',
    '100000101110010101111',
    '101110100100101001000',
    '101110101110001001110',
    '101110101100100100100',
    '100000100111011110001',
    '111111101101010100000',
  ].join('\n');

  it('produces a 21×21 matrix for a short string', () => {
    expect(getQrMatrix('HI', 'M').size).toBe(21);
  });

  it('matches the known vector for "HELLO WORLD" at level M', () => {
    expect(matrixToBitString(getQrMatrix('HELLO WORLD', 'M'))).toBe(HELLO_WORLD_M);
  });

  it('is deterministic', () => {
    expect(matrixToBitString(getQrMatrix('abc123', 'Q')))
      .toBe(matrixToBitString(getQrMatrix('abc123', 'Q')));
  });

  it('has the three finder patterns (dark 7×7 ring in three corners)', () => {
    const { modules, size } = getQrMatrix('finder test', 'M');
    const finderTopLeft = (r0, c0) => {
      // Outer ring dark, inner 3×3 dark core at center.
      for (let i = 0; i < 7; i++) {
        expect(modules[r0 + 0][c0 + i]).toBe(true); // top edge
        expect(modules[r0 + 6][c0 + i]).toBe(true); // bottom edge
        expect(modules[r0 + i][c0 + 0]).toBe(true); // left edge
        expect(modules[r0 + i][c0 + 6]).toBe(true); // right edge
      }
      expect(modules[r0 + 3][c0 + 3]).toBe(true); // center of core
    };
    finderTopLeft(0, 0);
    finderTopLeft(0, size - 7);
    finderTopLeft(size - 7, 0);
  });

  it('rejects an invalid error-correction level and empty input', () => {
    expect(() => getQrMatrix('x', 'Z')).toThrow();
    expect(() => getQrMatrix('', 'M')).toThrow();
  });

  it('throws a real Error with a helpful message when data overflows', () => {
    // qrcode-generator throws a bare string on overflow; getQrMatrix must
    // normalize it to an Error so the UI never shows "undefined".
    let caught;
    try {
      getQrMatrix('x'.repeat(5000), 'H');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/too much data/i);
  });

  it('encodes non-ASCII as UTF-8 (no Latin-1 corruption)', () => {
    // "café" UTF-8 = 63 61 66 c3 a9 (5 bytes) → version-1 (21×21) at level M.
    // This vector is pinned against the UTF-8 encoder; a Latin-1 encoder produces
    // a different byte sequence (63 61 66 e9 = 4 bytes) and therefore a different
    // matrix — so removing the UTF-8 switch in matrix.js will break this test.
    const CAFE_M = [
      '111111100100001111111',
      '100000100010001000001',
      '101110101100101011101',
      '101110101100001011101',
      '101110101111101011101',
      '100000101000101000001',
      '111111101010101111111',
      '000000001011100000000',
      '101111100010101111100',
      '111010011110100100101',
      '010000101011010011110',
      '100010010110000111111',
      '001001100011010010000',
      '000000001001111001101',
      '111111100100101100010',
      '100000101001111001000',
      '101110101000100100010',
      '101110101010100100000',
      '101110101011010011100',
      '100000100110000110100',
      '111111101001010010110',
    ].join('\n');
    expect(matrixToBitString(getQrMatrix('café', 'M'))).toBe(CAFE_M);
    // An emoji (4-byte UTF-8) must encode without throwing and differ from the
    // accented build (different payload bytes → different matrix).
    const emoji = matrixToBitString(getQrMatrix('café 😀', 'M'));
    expect(emoji).not.toBe(CAFE_M);
  });

  it('ASCII matrices are unchanged by the UTF-8 switch (regression guard)', () => {
    // "HI" still version 1; the HELLO WORLD vector above still holds because
    // ASCII UTF-8 bytes equal Latin-1 bytes.
    expect(getQrMatrix('HI', 'M').size).toBe(21);
  });
});
