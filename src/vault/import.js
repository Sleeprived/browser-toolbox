// Pure import logic for the password vault: detect which CSV columns map to
// entry fields, and turn a parsed CSV row into entry fields. No DOM, no globals
// — unit-tested in isolation. Used to import CSV exports from other password
// managers (Chrome/Edge, Firefox, Bitwarden, LastPass, 1Password, KeePass).

export const TARGET_FIELDS = ['title', 'username', 'password', 'url', 'notes', 'totp', 'tag'];

// Header aliases per target field, in priority order. Matching is
// case-insensitive and ignores surrounding whitespace.
const ALIASES = {
  title: ['name', 'title', 'account'],
  username: ['username', 'login_username', 'user', 'login', 'email', 'user_name'],
  password: ['password', 'login_password', 'pass'],
  url: ['url', 'uri', 'login_uri', 'website', 'web site', 'site'],
  notes: ['notes', 'note', 'extra', 'comment', 'comments'],
  totp: ['totp', 'login_totp', 'otpauth', 'one-time password', 'otp', '2fa'],
  tag: ['folder', 'grouping', 'group', 'category', 'tags', 'tag'],
};

const norm = (s) => (typeof s === 'string' ? s : '').trim().toLowerCase();

// Map a CSV header (array of column names) to entry fields. Returns
// { title, username, password, url, notes, totp, tag } where each value is the
// verbatim matching header name (so it can index the row object) or null.
export function detectMapping(header) {
  const cols = Array.isArray(header) ? header : [];
  const byNorm = new Map();
  for (const c of cols) {
    const n = norm(c);
    if (n && !byNorm.has(n)) byNorm.set(n, c); // first occurrence wins
  }
  const mapping = {};
  for (const field of TARGET_FIELDS) {
    mapping[field] = null;
    for (const alias of ALIASES[field]) {
      if (byNorm.has(alias)) { mapping[field] = byNorm.get(alias); break; }
    }
  }
  return mapping;
}

// Extract a base32 secret from an otpauth:// URI; otherwise return the trimmed
// value (LastPass/Bitwarden already export bare base32). An otpauth URI with no
// usable secret yields '' (not the raw URI) so we never store a junk secret that
// the editor would reject forever. A malformed %-escape degrades to the raw
// captured value instead of throwing.
export function extractTotpSecret(value) {
  const v = (typeof value === 'string' ? value : '').trim();
  if (!v) return '';
  if (/^otpauth:\/\//i.test(v)) {
    const m = v.match(/[?&]secret=([^&]+)/i);
    if (!m) return '';
    try { return decodeURIComponent(m[1]).trim(); } catch { return m[1].trim(); }
  }
  return v;
}

// Hostname of a URL string, without scheme/path/port and without a leading
// "www.". Avoids the URL() constructor so junk input never throws, and strips
// any userinfo so a "user:pass@host" URL never leaks credentials into a title.
// Returns '' for schemes with no authority (mailto:, otpauth:) so the caller
// falls back to the username.
function hostnameOf(url) {
  const u = (typeof url === 'string' ? url : '').trim();
  if (!u) return '';
  let rest;
  const withAuth = u.match(/^[a-z][a-z0-9+.-]*:\/\/(.*)$/i);
  if (withAuth) rest = withAuth[1];
  else if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return ''; // scheme: without // => no host
  else rest = u; // bare host/path, no scheme
  let host = rest.split(/[/?#]/)[0] || '';
  const at = host.lastIndexOf('@');
  if (at !== -1) host = host.slice(at + 1); // drop userinfo
  host = host.replace(/:\d+$/, '');          // drop port
  return host.replace(/^www\./i, '');
}

const cell = (row, col) => {
  if (!col) return '';
  const v = row ? row[col] : '';
  return typeof v === 'string' ? v : v == null ? '' : String(v);
};

// Map one CSV row object to vault entry fields. Applies Title fallback
// (URL host -> username), otpauth secret extraction, and a single group tag.
export function mapRowToFields(row, mapping) {
  const m = mapping || {};
  const url = cell(row, m.url).trim();
  const username = cell(row, m.username);
  let title = cell(row, m.title).trim();
  if (!title) title = hostnameOf(url) || username.trim();

  const secret = extractTotpSecret(cell(row, m.totp));
  const tagVal = cell(row, m.tag).trim();

  return {
    title,
    username,
    password: cell(row, m.password),
    url,
    notes: cell(row, m.notes),
    tags: tagVal ? [tagVal] : [],
    totp: secret ? { secret } : null,
  };
}

// A row with no entry-bearing field is a blank export line (or a bare
// folder/group marker) — skip it. A tag alone does not make a vault entry, so
// it is deliberately excluded here.
export function isRowEmpty(f) {
  return !f.title && !f.username && !f.password && !f.url && !f.notes && !f.totp;
}

// Importing is only meaningful if at least a username or password is mapped.
export function canImport(mapping) {
  return !!(mapping && (mapping.password || mapping.username));
}
