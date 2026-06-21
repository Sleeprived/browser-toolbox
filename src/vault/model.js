// Vault data model: entry shape, CRUD, search/tag helpers, and the
// serialize/parse boundary for the JSON that gets encrypted. Pure — IDs and the
// clock are injected so behaviour is deterministic under test. Parsing normalizes
// every entry to a known shape and drops unknown fields, so a hand-edited or
// older file loads predictably.

export class VaultModelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultModelError';
  }
}

export const VAULT_VERSION = 1;
const TOTP_ALGOS = ['SHA-1', 'SHA-256', 'SHA-512'];

function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback (should not be hit in supported browsers / Node 24).
  return 'e-' + Math.abs(Date.now()).toString(36) + Math.floor(Math.random() * 1e9).toString(36);
}

const asString = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const asInt = (v, fallback) => (Number.isInteger(v) ? v : fallback);
const asTime = (v) => (Number.isFinite(v) ? v : 0);

function normalizeTotp(t) {
  if (!t || typeof t !== 'object') return null;
  const secret = asString(t.secret).trim();
  if (secret === '') return null;
  return {
    secret,
    digits: asInt(t.digits, 6),
    period: asInt(t.period, 30),
    algorithm: TOTP_ALGOS.includes(t.algorithm) ? t.algorithm : 'SHA-1',
  };
}

function normalizeCustomFields(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((f) => f && typeof f === 'object')
    .map((f, i) => ({ id: asString(f.id) || `cf${i}`, label: asString(f.label), value: asString(f.value), hidden: !!f.hidden }));
}

function normalizeHistory(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((h) => h && typeof h === 'object' && typeof h.password === 'string')
    .map((h) => ({ password: h.password, changedAt: asTime(h.changedAt) }));
}

function normalizeTags(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(asString).filter((t) => t !== '');
}

// Coerce an arbitrary object into the canonical entry shape. Throws if it lacks
// an id (a sign of corruption — better to surface than to silently lose data).
function normalize(entry) {
  if (!entry || typeof entry !== 'object') throw new VaultModelError('Entry must be an object.');
  if (typeof entry.id !== 'string' || entry.id === '') throw new VaultModelError('Entry is missing an id.');
  return {
    id: entry.id,
    title: asString(entry.title),
    username: asString(entry.username),
    password: asString(entry.password),
    url: asString(entry.url),
    notes: asString(entry.notes),
    tags: normalizeTags(entry.tags),
    totp: normalizeTotp(entry.totp),
    customFields: normalizeCustomFields(entry.customFields),
    passwordHistory: normalizeHistory(entry.passwordHistory),
    createdAt: asTime(entry.createdAt),
    updatedAt: asTime(entry.updatedAt),
  };
}

export function createEntry(fields = {}, deps = {}) {
  const id = deps.id ?? newId();
  const now = deps.now ?? Date.now();
  return normalize({
    id,
    title: fields.title,
    username: fields.username,
    password: fields.password,
    url: fields.url,
    notes: fields.notes,
    tags: fields.tags ?? [],
    totp: fields.totp ?? null,
    customFields: fields.customFields ?? [],
    passwordHistory: fields.passwordHistory ?? [],
    createdAt: now,
    updatedAt: now,
  });
}

export function updateEntry(entry, changes = {}, deps = {}) {
  const now = deps.now ?? Date.now();
  const history = [...(entry.passwordHistory ?? [])];
  const changingPassword =
    Object.prototype.hasOwnProperty.call(changes, 'password') &&
    changes.password != null &&
    changes.password !== entry.password &&
    entry.password !== '';
  if (changingPassword) history.unshift({ password: entry.password, changedAt: now });

  return normalize({
    ...entry,
    ...changes,
    id: entry.id, // immutable
    createdAt: entry.createdAt,
    passwordHistory: history,
    updatedAt: now,
  });
}

export function deleteEntry(entries, id) {
  return entries.filter((e) => e.id !== id);
}

export function upsertEntry(entries, entry) {
  const idx = entries.findIndex((e) => e.id === entry.id);
  if (idx === -1) return [...entries, normalize(entry)];
  const copy = entries.slice();
  copy[idx] = normalize(entry);
  return copy;
}

export function searchEntries(entries, query) {
  const q = asString(query).trim().toLowerCase();
  if (q === '') return [...entries];
  return entries.filter(
    (e) => e.title.toLowerCase().includes(q) || e.username.toLowerCase().includes(q),
  );
}

export function filterByTag(entries, tag) {
  return entries.filter((e) => e.tags.includes(tag));
}

export function allTags(entries) {
  const set = new Set();
  for (const e of entries) for (const t of e.tags) set.add(t);
  return [...set].sort();
}

// The object that gets JSON-stringified and encrypted.
export function makeVaultObject(entries) {
  return { version: VAULT_VERSION, entries: entries.map(normalize) };
}

// Validate + normalize a decrypted vault object into an entries array.
// `version` is intentionally NOT enforced: older/newer files still load, and
// per-entry normalization is the real safety net against malformed data.
export function parseVaultObject(obj) {
  if (!obj || typeof obj !== 'object') throw new VaultModelError('Vault data is not an object.');
  if (!Array.isArray(obj.entries)) throw new VaultModelError('Vault data has no entries array.');
  return obj.entries.map(normalize);
}
