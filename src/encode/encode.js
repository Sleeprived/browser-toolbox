// Encode/Decode Multitool engine: Base64 (+ base64url), Hex, URL, and HTML
// entities. UTF-8 safe (TextEncoder/TextDecoder). HTML decode uses an explicit
// entity map — NEVER innerHTML — so it is safe under CSP and cannot execute markup.
// Pure functions, no DOM, no network.

export class EncodeError extends Error {}

const te = new TextEncoder();
const td = new TextDecoder('utf-8', { fatal: true });

function bytesToBinary(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
function binaryToBytes(bin) {
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i) & 0xff;
  return b;
}

export function toBase64(str, { urlSafe = false } = {}) {
  let b64 = btoa(bytesToBinary(te.encode(String(str))));
  if (urlSafe) b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64;
}

export function fromBase64(input, { urlSafe = false } = {}) {
  let s = String(input).trim();
  if (urlSafe) s = s.replace(/-/g, '+').replace(/_/g, '/');
  s = s.replace(/\s+/g, '');
  if (urlSafe) while (s.length % 4) s += '=';
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new EncodeError('Not valid Base64.');
  let bin;
  try { bin = atob(s); } catch { throw new EncodeError('Not valid Base64.'); }
  try { return td.decode(binaryToBytes(bin)); } catch { throw new EncodeError('Decoded bytes are not valid UTF-8 text.'); }
}

export function toHex(str) {
  const bytes = te.encode(String(str));
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function fromHex(input) {
  const s = String(input).replace(/\s+/g, '');
  if (s.length % 2 !== 0) throw new EncodeError('Hex must have an even number of digits.');
  if (!/^[0-9a-fA-F]*$/.test(s)) throw new EncodeError('Hex contains non-hex characters.');
  const bytes = new Uint8Array(s.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(s.substr(i * 2, 2), 16);
  try { return td.decode(bytes); } catch { throw new EncodeError('Decoded bytes are not valid UTF-8 text.'); }
}

export function toUrl(str) {
  // encodeURIComponent throws a URIError on a lone (unpaired) surrogate; wrap it
  // so the failure surfaces as a precise EncodeError like every other codec here.
  try { return encodeURIComponent(String(str)); }
  catch { throw new EncodeError('Input contains an unpaired surrogate and cannot be URL-encoded.'); }
}
export function fromUrl(input) {
  try { return decodeURIComponent(String(input)); } catch { throw new EncodeError('Not valid percent-encoding.'); }
}

const HTML_ENCODE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function toHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => HTML_ENCODE[c]);
}

const HTML_NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–',
  hellip: '…', deg: '°', euro: '€', pound: '£', cent: '¢',
};
export function fromHtml(input) {
  return String(input).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp)) return m;
      if (cp === 0 || (cp >= 0xD800 && cp <= 0xDFFF)) return '\uFFFD';
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return Object.prototype.hasOwnProperty.call(HTML_NAMED, body) ? HTML_NAMED[body] : m;
  });
}

// Binary: UTF-8 bytes as space-separated 8-bit groups. Decode is tolerant of any
// whitespace grouping but requires a whole number of bytes.
export function toBinary(str) {
  const bytes = te.encode(String(str));
  const out = [];
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i].toString(2).padStart(8, '0'));
  return out.join(' ');
}

export function fromBinary(input) {
  const s = String(input).replace(/\s+/g, '');
  if (s === '') return '';
  if (!/^[01]+$/.test(s)) throw new EncodeError('Binary must contain only 0 and 1.');
  if (s.length % 8 !== 0) throw new EncodeError('Binary length must be a multiple of 8 bits.');
  const bytes = new Uint8Array(s.length / 8);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(s.substr(i * 8, 8), 2);
  try { return td.decode(bytes); } catch { throw new EncodeError('Decoded bytes are not valid UTF-8 text.'); }
}

const TABLE = {
  base64: [(s) => toBase64(s), (s) => fromBase64(s)],
  base64url: [(s) => toBase64(s, { urlSafe: true }), (s) => fromBase64(s, { urlSafe: true })],
  hex: [toHex, fromHex],
  url: [toUrl, fromUrl],
  html: [toHtml, fromHtml],
  binary: [toBinary, fromBinary],
};
export function convert(text, format, mode) {
  const pair = TABLE[format];
  if (!pair) throw new EncodeError(`Unknown format: ${format}`);
  if (mode !== 'encode' && mode !== 'decode') throw new EncodeError('Unknown mode: ' + mode);
  return (mode === 'decode' ? pair[1] : pair[0])(String(text));
}
