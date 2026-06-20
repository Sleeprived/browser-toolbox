// QR payload formatters. Each builds the exact text string that goes into a QR
// code for a given content type, with the escaping each format requires.
// Pure functions — no DOM, no globals.

// WiFi: escape backslash, semicolon, comma, colon and double-quote (MeCard-style).
export function escapeWifi(value) {
  return String(value).replace(/([\\;,:"])/g, '\\$1');
}

// vCard 3.0 text-value escaping per RFC 6350: backslash, newline, comma, semicolon.
export function escapeVcard(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function formatText(text) {
  return String(text == null ? '' : text);
}

export function formatUrl(url) {
  const u = String(url || '').trim();
  if (u === '') return '';
  // Add a scheme if the user typed a bare domain.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u) || u.startsWith('mailto:') || u.startsWith('tel:')) {
    return u;
  }
  return 'https://' + u;
}

// opts: { ssid, password, encryption: 'WPA'|'WEP'|'nopass', hidden: bool }
export function formatWifi(opts) {
  const { ssid = '', password = '', encryption = 'WPA', hidden = false } = opts || {};
  const auth = encryption === 'nopass' ? 'nopass' : encryption;
  let out = `WIFI:T:${auth};S:${escapeWifi(ssid)};`;
  if (auth !== 'nopass') {
    out += `P:${escapeWifi(password)};`;
  }
  if (hidden) {
    out += 'H:true;';
  }
  out += ';';
  return out;
}

// opts: { name, phone, email, org }
export function formatVcard(opts) {
  const { name = '', phone = '', email = '', org = '' } = opts || {};
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${escapeVcard(name)};;;;`);
  lines.push(`FN:${escapeVcard(name)}`);
  if (org) lines.push(`ORG:${escapeVcard(org)}`);
  if (phone) lines.push(`TEL;TYPE=CELL:${escapeVcard(phone)}`);
  if (email) lines.push(`EMAIL:${escapeVcard(email)}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

// Email: a mailto: URI with optional, percent-encoded subject and body.
// opts: { to, subject, body }
export function formatEmail(opts) {
  const { to = '', subject = '', body = '' } = opts || {};
  const addr = String(to).trim();
  const params = [];
  if (subject) params.push('subject=' + encodeURIComponent(subject));
  if (body) params.push('body=' + encodeURIComponent(body));
  const query = params.length ? '?' + params.join('&') : '';
  if (addr === '' && query === '') return '';
  return 'mailto:' + addr + query;
}

// SMS: the SMSTO:number:message form, which is what ZXing-derived scanners (most
// phone cameras) parse to pre-fill a text. opts: { number, message }
export function formatSms(opts) {
  const { number = '', message = '' } = opts || {};
  const num = String(number).replace(/[^\d+]/g, '');
  const msg = String(message).replace(/[\r\n]+/g, ' ').trim();
  if (num === '' && msg === '') return '';
  return msg ? `SMSTO:${num}:${msg}` : `SMSTO:${num}`;
}

// Geo location: geo:lat,lng (RFC 5870). Validates ranges; throws on bad input.
// opts: { lat, lng }
export function formatGeo(opts) {
  const { lat = '', lng = '' } = opts || {};
  if (String(lat).trim() === '' || String(lng).trim() === '') return '';
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new Error('Latitude and longitude must be numbers.');
  if (la < -90 || la > 90) throw new Error('Latitude must be between -90 and 90.');
  if (lo < -180 || lo > 180) throw new Error('Longitude must be between -180 and 180.');
  return `geo:${la},${lo}`;
}

// Telephone: tel: URI, keeping only a leading + and digits. opts: { number }
export function formatTel(opts) {
  const { number = '' } = opts || {};
  const num = String(number).replace(/[^\d+]/g, '');
  if (num === '') return '';
  return 'tel:' + num;
}
