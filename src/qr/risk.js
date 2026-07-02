// Local, heuristic safety analysis of a decoded QR payload. Pure — no DOM, no
// network. It NEVER claims a code is "safe"; it only surfaces warning signs.
//
// analyzePayload(parsed) -> Finding[]
//   Finding = { level: 'info' | 'caution' | 'danger', message: string }
//
// Conservative by design: it would rather stay quiet than cry wolf. The honest
// framing ("this is not a guarantee") is added by the UI, not here.

// Schemes that run code or open local resources instead of a normal web page.
const DANGER_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file']);

// Hosts whose whole purpose is to hide the real destination.
const SHORTENERS = new Set([
  'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'is.gd', 'ow.ly', 'buff.ly',
  'rebrand.ly', 'cutt.ly', 'rb.gy', 'shorturl.at', 't.ly', 'tiny.cc',
  'buff.ly', 'soo.gd', 'clck.ru', 'cli.gs', 'shorte.st', 'adf.ly',
]);

// Exported for tests. Besides the dotted quad, browsers also accept a single
// 32-bit number as an IPv4 host — decimal (http://2130706433/) or hex
// (http://0x7f000001/) — so those forms must trip the straight-to-IP warning too.
export function isIpv4(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').every((o) => Number(o) <= 255);
  }
  if (/^\d+$/.test(host)) return Number(host) <= 0xffffffff;
  if (/^0x[0-9a-f]+$/i.test(host)) return parseInt(host, 16) <= 0xffffffff;
  return false;
}

function analyzeUrl(url) {
  const out = [];
  let u;
  try {
    u = new URL(url);
  } catch {
    out.push({ level: 'caution', message: 'This could not be parsed as a standard web address.' });
    return out;
  }

  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  const host = u.hostname;

  if (DANGER_SCHEMES.has(scheme)) {
    out.push({
      level: 'danger',
      message: `This uses the "${scheme}:" scheme, which can run code or open local content instead of opening a normal web page.`,
    });
    // For non-web schemes the rest of the URL checks don't apply.
    return out;
  }

  // Allowlist, not denylist: anything that is not plain web gets a caution, so
  // app-launching schemes (intent:, market:, ms-word:, …) and schemes invented
  // after this list was written are flagged by default.
  if (scheme !== 'http' && scheme !== 'https') {
    out.push({
      level: 'caution',
      message: `This uses the uncommon "${scheme}:" scheme, which may launch an app or trigger an action instead of opening a web page.`,
    });
    return out;
  }

  if (u.username || u.password) {
    out.push({
      level: 'danger',
      message: `This link embeds a username/password before the "@", a common trick to disguise the real destination (the part after "@", "${host}", is where it actually goes).`,
    });
  }

  if (scheme === 'http') {
    out.push({
      level: 'caution',
      message: 'This link uses plain http://, so its traffic is not encrypted and can be read or altered in transit.',
    });
  }

  if (isIpv4(host) || host.startsWith('[')) {
    out.push({
      level: 'caution',
      message: `This link points straight to an IP address (${host}) rather than a named domain — unusual for a legitimate site.`,
    });
  }

  if (host.split('.').some((label) => label.toLowerCase().startsWith('xn--'))) {
    out.push({
      level: 'caution',
      message: 'The domain uses punycode/internationalized characters (xn--), which can be used to imitate a familiar site.',
    });
  }

  const registrable = host.replace(/^www\./i, '').toLowerCase();
  if (SHORTENERS.has(registrable)) {
    out.push({
      level: 'caution',
      message: `This is a link shortener (${host}); the real destination is hidden until you open it.`,
    });
  }

  if (u.port && u.port !== '80' && u.port !== '443') {
    out.push({ level: 'info', message: `This link uses a non-standard port (${u.port}).` });
  }

  return out;
}

export function analyzePayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  const { kind, fields = {} } = parsed;

  if (kind === 'url') {
    const out = analyzeUrl(fields.url || parsed.raw || '');
    // decode.js strips embedded tab/newline to classify the payload as a URL;
    // when it had to, the characters were hiding the link's true shape.
    if (fields.url && parsed.raw && parsed.raw !== fields.url) {
      out.unshift({
        level: 'caution',
        message: 'This link contains hidden tab/newline characters — a trick used to make a link look like harmless text.',
      });
    }
    return out;
  }

  if (kind === 'wifi') {
    const out = [];
    if (fields.auth && fields.auth !== 'nopass' && fields.password) {
      out.push({
        level: 'caution',
        message: 'Anyone who scans this code gets the Wi-Fi password — it is stored in plain text, not encrypted.',
      });
    } else if (fields.auth === 'nopass') {
      out.push({ level: 'info', message: 'This is an open (unencrypted) Wi-Fi network.' });
    }
    return out;
  }

  if (kind === 'tel') {
    return [{
      level: 'caution',
      message: `Scanning this in a phone camera may offer to call ${fields.number || 'a number'}.`,
    }];
  }

  if (kind === 'sms') {
    return [{
      level: 'info',
      message: `This would pre-fill a text message (SMS) to ${fields.number || 'a number'}.`,
    }];
  }

  if (kind === 'email') {
    return [{
      level: 'info',
      message: `This would start an email to ${fields.to || 'an address'}.`,
    }];
  }

  if (kind === 'geo') {
    return [{ level: 'info', message: 'This points to a map location.' }];
  }

  if (kind === 'vcard') {
    const out = [{ level: 'info', message: 'This is a contact card; scanning it may offer to add a contact.' }];
    if (/https?:\/\//i.test(parsed.raw || '')) {
      out.push({ level: 'caution', message: 'This contact card contains a web link — check where it goes before opening it.' });
    }
    return out;
  }

  // text
  const text = fields.text || '';
  if (/\bhttps?:\/\/\S+/i.test(text)) {
    return [{ level: 'caution', message: 'This text contains a web link — treat it with the same caution as any link.' }];
  }
  return [{ level: 'info', message: 'This is plain text.' }];
}
