import { describe, it, expect, beforeAll } from 'vitest';
import qrcodeLib from 'qrcode-generator';
import jsQR from 'jsqr';
import {
  formatUrl,
  formatWifi,
  formatVcard,
  formatEmail,
  formatSms,
  formatGeo,
  formatTel,
  formatText,
} from '../src/qr/payloads.js';
import { parseQrPayload } from '../src/qr/decode.js';
import { analyzePayload } from '../src/qr/risk.js';

// Convenience: classify a level set for a decoded raw string.
const levels = (raw) => analyzePayload(parseQrPayload(raw)).map((f) => f.level);
const findText = (raw, re) =>
  analyzePayload(parseQrPayload(raw)).find((f) => re.test(f.message));

describe('decode: round-trips the generator payloads back to fields', () => {
  it('classifies a generated URL', () => {
    const p = parseQrPayload(formatUrl('example.com')); // -> https://example.com
    expect(p.kind).toBe('url');
    expect(p.fields.url).toBe('https://example.com');
  });

  it('round-trips a WPA WiFi payload, unescaping the SSID and password', () => {
    const raw = formatWifi({ ssid: 'a,b:c', password: 'x"y', encryption: 'WPA' });
    const p = parseQrPayload(raw);
    expect(p.kind).toBe('wifi');
    expect(p.fields.ssid).toBe('a,b:c');
    expect(p.fields.password).toBe('x"y');
    expect(p.fields.auth).toBe('WPA');
    expect(p.fields.hidden).toBe(false);
  });

  it('round-trips an open WiFi network (no password segment)', () => {
    const p = parseQrPayload(formatWifi({ ssid: 'Cafe', encryption: 'nopass' }));
    expect(p.kind).toBe('wifi');
    expect(p.fields.ssid).toBe('Cafe');
    expect(p.fields.auth).toBe('nopass');
    expect(p.fields.password).toBe('');
  });

  it('round-trips a hidden WiFi network', () => {
    const p = parseQrPayload(formatWifi({ ssid: 'S', password: 'P', hidden: true }));
    expect(p.fields.hidden).toBe(true);
  });

  it('unescapes an escaped semicolon inside the SSID', () => {
    const p = parseQrPayload('WIFI:T:WPA;S:my\\;net;P:p;;');
    expect(p.fields.ssid).toBe('my;net');
    expect(p.fields.password).toBe('p');
  });

  it('round-trips a vCard, unescaping comma/semicolon', () => {
    const raw = formatVcard({ name: 'John; Doe', phone: '+1 555', email: 'j@x.com', org: 'Acme, Inc' });
    const p = parseQrPayload(raw);
    expect(p.kind).toBe('vcard');
    expect(p.fields.name).toBe('John; Doe');
    expect(p.fields.org).toBe('Acme, Inc');
    expect(p.fields.phone).toBe('+1 555');
    expect(p.fields.email).toBe('j@x.com');
  });

  it('round-trips a mailto with subject and body', () => {
    const raw = formatEmail({ to: 'a@b.com', subject: 'Hi there', body: 'a & b' });
    const p = parseQrPayload(raw);
    expect(p.kind).toBe('email');
    expect(p.fields.to).toBe('a@b.com');
    expect(p.fields.subject).toBe('Hi there');
    expect(p.fields.body).toBe('a & b');
  });

  it('round-trips an SMSTO payload', () => {
    const p = parseQrPayload(formatSms({ number: '+1 (555) 123', message: 'call me' }));
    expect(p.kind).toBe('sms');
    expect(p.fields.number).toBe('+1555123');
    expect(p.fields.message).toBe('call me');
  });

  it('round-trips a geo payload', () => {
    const p = parseQrPayload(formatGeo({ lat: '40.4461', lng: '-79.9822' }));
    expect(p.kind).toBe('geo');
    expect(p.fields.lat).toBe('40.4461');
    expect(p.fields.lng).toBe('-79.9822');
  });

  it('round-trips a tel payload', () => {
    const p = parseQrPayload(formatTel({ number: '+1 (555) 867-5309' }));
    expect(p.kind).toBe('tel');
    expect(p.fields.number).toBe('+15558675309');
  });

  it('treats plain text as text', () => {
    const p = parseQrPayload(formatText('hello world'));
    expect(p.kind).toBe('text');
    expect(p.fields.text).toBe('hello world');
  });
});

describe('decode: direct classification and safety of untrusted input', () => {
  it('classifies an https URL', () => {
    expect(parseQrPayload('https://example.com/path?q=1').kind).toBe('url');
  });

  it('keeps a javascript: payload as a url WITHOUT executing or mutating it', () => {
    const p = parseQrPayload('javascript:alert(1)');
    expect(p.kind).toBe('url');
    expect(p.raw).toBe('javascript:alert(1)'); // returned verbatim, inert
  });

  it('never throws on garbage input — falls back to text', () => {
    expect(() => parseQrPayload('')).not.toThrow();
    expect(parseQrPayload('  not a code').kind).toBe('text');
    expect(parseQrPayload('WIFI:').kind).toBe('wifi'); // malformed but recognized prefix
  });
});

describe('risk: URL heuristics', () => {
  it('flags nothing dangerous for a plain https domain', () => {
    expect(levels('https://example.com')).not.toContain('danger');
    expect(levels('https://example.com')).not.toContain('caution');
  });

  it('cautions on plain http', () => {
    expect(findText('http://example.com', /http/i).level).toBe('caution');
  });

  it('marks javascript: as danger', () => {
    expect(findText('javascript:alert(1)', /scheme|javascript/i).level).toBe('danger');
  });

  it('marks an embedded-credentials URL as danger (the @ trick)', () => {
    expect(findText('https://paypal.com@evil.example/login', /@|credential|embedded/i).level)
      .toBe('danger');
  });

  it('cautions on a punycode / internationalized host', () => {
    expect(findText('https://xn--80ak6aa92e.com', /punycode|xn--|internationaliz/i).level)
      .toBe('caution');
  });

  it('cautions on a raw IP host', () => {
    expect(findText('http://192.168.1.1/admin', /IP address|192\.168/i).level).toBe('caution');
  });

  it('cautions on a known link shortener', () => {
    expect(findText('https://bit.ly/abc123', /shorten|hidden/i).level).toBe('caution');
  });
});

describe('risk: non-URL payloads', () => {
  it('warns that a WiFi password is exposed', () => {
    const f = findText(formatWifi({ ssid: 'Net', password: 'hunter2', encryption: 'WPA' }), /password/i);
    expect(f.level).toBe('caution');
  });

  it('cautions that a tel payload may dial a number', () => {
    expect(findText(formatTel({ number: '+15558675309' }), /call|dial/i).level).toBe('caution');
  });

  it('treats an SMS payload as informational', () => {
    expect(findText(formatSms({ number: '5551234', message: 'hi' }), /text message|sms/i).level)
      .toBe('info');
  });

  it('treats a mailto as informational', () => {
    expect(findText(formatEmail({ to: 'a@b.com' }), /email/i).level).toBe('info');
  });
});

describe('regression: hardening of untrusted decoded input', () => {
  it('parses a normal MATMSG email payload', () => {
    const p = parseQrPayload('MATMSG:TO:a@b.com;SUB:Hi;BODY:Hello there;;');
    expect(p.kind).toBe('email');
    expect(p.fields.to).toBe('a@b.com');
    expect(p.fields.subject).toBe('Hi');
    expect(p.fields.body).toBe('Hello there');
  });

  it('does not hang on a malicious MATMSG with unterminated backslash runs (ReDoS)', () => {
    const evil = 'MATMSG:TO:' + 'a\\'.repeat(40); // no terminating ';'
    const p = parseQrPayload(evil); // must return promptly, never hang the tab
    expect(p.kind).toBe('email');
  });

  it('still flags a danger URL hidden behind a leading control character', () => {
    // U+0001 prefix, kept as a code unit so no raw control byte lives in the source.
    const p = parseQrPayload(String.fromCharCode(1) + 'https://paypal.com@evil.example/login');
    expect(p.kind).toBe('url');
    expect(analyzePayload(p).some((f) => f.level === 'danger')).toBe(true);
  });

  it('keeps email subject/body when the address has a stray percent sign', () => {
    const p = parseQrPayload('mailto:a%b@x.com?subject=Hi&body=There');
    expect(p.kind).toBe('email');
    expect(p.fields.subject).toBe('Hi');
    expect(p.fields.body).toBe('There');
  });

  it('does not mis-split an escaped semicolon in a vCard N name (no FN line)', () => {
    const p = parseQrPayload('BEGIN:VCARD\nVERSION:3.0\nN:Doe\\;Jr;John;;;\nEND:VCARD');
    expect(p.kind).toBe('vcard');
    expect(p.fields.name).toBe('Doe;Jr John');
  });
});

// End-to-end decode: prove the REAL vendored decoder (jsQR) reads what the
// generator encodes, without a browser. The browser feeds jsQR an RGBA buffer
// from a canvas; here we build the same buffer directly from the module matrix,
// so the only untested-in-CI piece left is the canvas pixel read itself.
describe('integration: jsQR decodes what the generator encodes', () => {
  let getQrMatrix;
  beforeAll(async () => {
    globalThis.qrcode = qrcodeLib;
    ({ getQrMatrix } = await import('../src/qr/matrix.js'));
  });

  // Rasterize a module matrix to an RGBA pixel buffer with a quiet zone.
  function rasterize(matrix, scale = 8, quiet = 4) {
    const { size, modules } = matrix;
    const dim = (size + quiet * 2) * scale;
    const data = new Uint8ClampedArray(dim * dim * 4).fill(255); // white, opaque
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!modules[r][c]) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = (c + quiet) * scale + dx;
            const y = (r + quiet) * scale + dy;
            const i = (y * dim + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = 0; // black
          }
        }
      }
    }
    return { data, width: dim, height: dim };
  }

  const roundTrip = (payload, ecl = 'M') => {
    const { data, width, height } = rasterize(getQrMatrix(payload, ecl));
    const code = jsQR(data, width, height);
    return code && code.data;
  };

  it('round-trips a URL through encode → rasterize → jsQR → parse', () => {
    const payload = formatUrl('example.com'); // https://example.com
    const decoded = roundTrip(payload);
    expect(decoded).toBe(payload);
    expect(parseQrPayload(decoded).kind).toBe('url');
  });

  it('round-trips a WiFi payload and parses its fields back', () => {
    const payload = formatWifi({ ssid: 'MyNet', password: 'secret', encryption: 'WPA' });
    const decoded = roundTrip(payload);
    expect(decoded).toBe(payload);
    expect(parseQrPayload(decoded).fields.ssid).toBe('MyNet');
  });

  it('round-trips plain text', () => {
    expect(roundTrip('HELLO WORLD')).toBe('HELLO WORLD');
  });
});
