// Parse a decoded QR string into a structured payload. The inverse of
// payloads.js. Pure functions — no DOM, no globals, no network.
//
// parseQrPayload(raw) -> { kind, fields, raw }
//   kind: 'url' | 'wifi' | 'vcard' | 'email' | 'sms' | 'geo' | 'tel' | 'text'
//
// Decoded QR content is UNTRUSTED input. This module only reads strings and
// returns plain data; it never evaluates, fetches, or renders anything. It must
// never throw — malformed input falls back to { kind: 'text' }.

// Split on an UNescaped delimiter, where '\' escapes the next character.
function splitEscaped(str, delim) {
  const out = [];
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\') {
      // Keep the backslash + next char together so it survives the split.
      cur += ch + (i + 1 < str.length ? str[i + 1] : '');
      i++;
      continue;
    }
    if (ch === delim) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// Remove one level of '\' escaping (used by both WiFi and vCard values).
function unescape(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      // vCard uses \n for newline; everything else is a literal next char.
      out += next === 'n' ? '\n' : next;
      i++;
    } else {
      out += value[i];
    }
  }
  return out;
}

// Whitespace, control, and zero-width code points to strip from the ENDS of a
// payload before classifying. A QR can carry e.g. a leading U+0001 that a browser
// or camera silently strips before navigating; without removing it here, such a
// payload fails the scheme test and is wrongly demoted to plain "text", skipping
// every URL danger check. Only the ends are trimmed; interior characters and the
// verbatim original string are preserved.
function isEdgeNoise(code) {
  return (
    code <= 0x20 || // C0 controls + space
    (code >= 0x7f && code <= 0xa0) || // DEL, C1 controls, NBSP
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200f) || // en/em spaces … zero-width chars
    code === 0x2028 || code === 0x2029 || // line / paragraph separators
    code === 0x202f || code === 0x205f || code === 0x2060 ||
    code === 0x3000 || code === 0xfeff // ideographic space, BOM / word-joiner
  );
}

function stripEdges(s) {
  let start = 0;
  let end = s.length;
  while (start < end && isEdgeNoise(s.charCodeAt(start))) start++;
  while (end > start && isEdgeNoise(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

function parseWifi(raw) {
  const body = raw.slice(raw.indexOf(':') + 1); // drop the leading "WIFI:"
  const fields = { ssid: '', password: '', auth: 'nopass', hidden: false };
  for (const seg of splitEscaped(body, ';')) {
    if (seg === '') continue;
    const c = seg.indexOf(':');
    if (c === -1) continue;
    const key = seg.slice(0, c).toUpperCase();
    const val = seg.slice(c + 1);
    if (key === 'S') fields.ssid = unescape(val);
    else if (key === 'P') fields.password = unescape(val);
    else if (key === 'T') fields.auth = unescape(val) || 'nopass';
    else if (key === 'H') fields.hidden = /^true$/i.test(unescape(val).trim());
  }
  return { kind: 'wifi', fields, raw };
}

function parseVcard(raw) {
  const fields = { name: '', org: '', phone: '', email: '' };
  for (const line of raw.split(/\r\n|\r|\n/)) {
    const c = line.indexOf(':');
    if (c === -1) continue;
    const key = line.slice(0, c).toUpperCase(); // may carry params, e.g. TEL;TYPE=CELL
    const rawVal = line.slice(c + 1);
    const val = unescape(rawVal);
    if (key === 'FN') fields.name = val;
    else if (key.startsWith('N') && key !== 'NOTE' && !fields.name) {
      // Fallback when FN is absent: N is "Family;Given;...". Split on the UNescaped
      // ';' so an escaped semicolon inside a component is kept, not split apart.
      fields.name = splitEscaped(rawVal, ';').map(unescape).filter(Boolean).join(' ').trim();
    } else if (key.startsWith('ORG')) fields.org = val;
    else if (key.startsWith('TEL') && !fields.phone) fields.phone = val;
    else if (key.startsWith('EMAIL') && !fields.email) fields.email = val;
  }
  return { kind: 'vcard', fields, raw };
}

function parseEmail(raw) {
  const fields = { to: '', subject: '', body: '' };
  // Decode each part defensively: a stray '%' in the address must not abort the
  // whole parse (which would silently drop subject/body).
  const dec = (v) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  try {
    const u = new URL(raw);
    fields.to = dec(u.pathname);
    fields.subject = u.searchParams.get('subject') || ''; // already decoded, never throws
    fields.body = u.searchParams.get('body') || '';
  } catch {
    fields.to = raw.slice(raw.indexOf(':') + 1).split('?')[0];
  }
  return { kind: 'email', fields, raw };
}

function parseSms(raw) {
  // Generator form: SMSTO:number:message. Also accept sms:/SMS: and a ?body= query.
  const afterScheme = raw.slice(raw.indexOf(':') + 1);
  let number = afterScheme;
  let message = '';
  const colon = afterScheme.indexOf(':');
  const q = afterScheme.indexOf('?');
  if (colon !== -1 && (q === -1 || colon < q)) {
    number = afterScheme.slice(0, colon);
    message = afterScheme.slice(colon + 1);
  } else if (q !== -1) {
    number = afterScheme.slice(0, q);
    try {
      message = new URLSearchParams(afterScheme.slice(q + 1)).get('body') || '';
    } catch {
      message = '';
    }
  }
  return { kind: 'sms', fields: { number: number.trim(), message: message.trim() }, raw };
}

function parseGeo(raw) {
  const body = raw.slice(raw.indexOf(':') + 1).split(';')[0]; // drop ;u= etc.
  const [lat = '', lng = ''] = body.split(',');
  return { kind: 'geo', fields: { lat: lat.trim(), lng: lng.trim() }, raw };
}

function parseTel(raw) {
  return { kind: 'tel', fields: { number: raw.slice(raw.indexOf(':') + 1).trim() }, raw };
}

function parseMatmsg(raw) {
  // Alt email form: MATMSG:TO:a@b.com;SUB:x;BODY:y;;  (MeCard-style \-escaping).
  // Tokenized like WiFi rather than with a regex — a regex with an ambiguous
  // `(?:\\.|[^;])*` over attacker-controlled input backtracks catastrophically.
  const fields = { to: '', subject: '', body: '' };
  for (const seg of splitEscaped(raw.slice(raw.indexOf(':') + 1), ';')) {
    const c = seg.indexOf(':');
    if (c === -1) continue;
    const key = seg.slice(0, c).toUpperCase();
    const val = unescape(seg.slice(c + 1));
    if (key === 'TO') fields.to = val;
    else if (key === 'SUB') fields.subject = val;
    else if (key === 'BODY') fields.body = val;
  }
  return { kind: 'email', fields, raw };
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function parseQrPayload(raw) {
  const s = String(raw == null ? '' : raw);
  const trimmed = stripEdges(s);
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('wifi:')) return parseWifi(trimmed);
  if (lower.startsWith('begin:vcard')) return parseVcard(trimmed);
  if (lower.startsWith('mailto:')) return parseEmail(trimmed);
  if (lower.startsWith('matmsg:')) return parseMatmsg(trimmed);
  if (lower.startsWith('smsto:') || lower.startsWith('sms:')) return parseSms(trimmed);
  if (lower.startsWith('tel:')) return parseTel(trimmed);
  if (lower.startsWith('geo:')) return parseGeo(trimmed);

  // Any remaining explicit scheme (http, https, ftp, javascript, data, file, ...)
  // is treated as a URL so risk.js can inspect the scheme. The URL spec strips
  // embedded tab/newline before parsing, so "ht\tp://x" still navigates to
  // http://x and "https://good.com\t.evil.com" really goes to good.com.evil.com
  // — strip them UNCONDITIONALLY (not only when the scheme itself is broken),
  // or an intact-scheme payload could disguise its true host and skip the
  // hidden-character caution in risk.js, which fires on raw !== fields.url.
  const stripped = trimmed.replace(/[\t\n\r]/g, '');
  if (SCHEME_RE.test(stripped)) {
    return { kind: 'url', fields: { url: stripped }, raw: trimmed };
  }

  return { kind: 'text', fields: { text: s }, raw: s };
}
