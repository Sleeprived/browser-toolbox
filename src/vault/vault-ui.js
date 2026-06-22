// Password Vault UI controller. Wires the lock / create / unlock / app screens to
// the pure crypto, model, TOTP, and generator modules. All secret-bearing values
// are rendered with textContent / createElement (never innerHTML) so a malicious
// entry title can never inject markup. The decrypted vault and derived key live
// only in memory and are wiped on lock, auto-lock, and page unload.

import {
  encryptVaultWithKey,
  decryptVault,
  deriveKey,
  DEFAULT_ITERATIONS,
  VaultCryptoError,
} from './crypto.js';
import {
  createEntry,
  updateEntry,
  deleteEntry,
  upsertEntry,
  searchEntries,
  filterByTag,
  allTags,
  makeVaultObject,
  parseVaultObject,
} from './model.js';
import { base32Decode, totp, secondsRemaining } from './totp.js';
import { generatePassword } from './passgen.js';
import { generatePassphrase } from '../passphrase/generate.js';
import { EFF_WORDLIST } from '../../assets/data/eff_wordlist.js';
import { estimateStrength } from '../passphrase/strength.js';

const $ = (id) => document.getElementById(id);
const MASTER_MIN_BITS = 60; // require a genuinely strong master password
const CLIPBOARD_CLEAR_MS = 25000;
const DEFAULT_FILENAME = 'vault.browser-toolbox.json';

// ----- in-memory state (never persisted) -----
const state = {
  unlocked: false,
  entries: [],
  key: null,
  salt: null,
  iterations: DEFAULT_ITERATIONS,
  filename: DEFAULT_FILENAME,
  pendingEnvelope: null,
  dirty: false,
  editingId: null, // null while not editing; '' for a new entry; else an entry id
};

let totpTimer = null;
let autoLockTimer = null;
let clipboardTimer = null;
let hiddenAt = null; // wall-clock time the tab was last hidden (audit-6 m6)
let editingTotp = null; // the editing entry's stored TOTP params, to preserve non-default digits/period/algorithm

// ============================================================
// Screen management
// ============================================================
function showScreen(name) {
  for (const s of ['vault-locked', 'vault-create', 'vault-unlock', 'vault-app']) {
    $(s).classList.toggle('hidden', s !== `vault-${name}`);
  }
}

function wipeMemory() {
  state.unlocked = false;
  state.entries = [];
  state.key = null;
  state.salt = null;
  state.iterations = DEFAULT_ITERATIONS;
  state.pendingEnvelope = null;
  state.dirty = false;
  state.editingId = null;
}

// Wipe every secret-bearing input in the entry editor (and its working state)
// from the DOM, so nothing readable lingers after a lock or after editing.
function clearEditorFields() {
  for (const id of ['f-title', 'f-username', 'f-password', 'f-url', 'f-notes', 'f-tags', 'f-totp', 'gen-out']) {
    const el = $(id);
    if (el) el.value = '';
  }
  customFieldsState.length = 0;
  const wrap = $('custom-fields');
  if (wrap) wrap.textContent = '';
  editingTotp = null;
  const td = $('totp-display');
  if (td) td.classList.add('hidden');
  // Blank any rendered secrets that live outside the editor inputs: prior
  // plaintext passwords in the history list and the live TOTP code/countdown.
  // (Cannot use renderHistory([]) — it early-returns before clearing the <li>s.)
  if ($('history-list')) $('history-list').textContent = '';
  if ($('history-count')) $('history-count').textContent = '0';
  if ($('history')) $('history').classList.add('hidden');
  if ($('totp-code')) $('totp-code').textContent = '';
  if ($('totp-countdown')) $('totp-countdown').textContent = '';
}

function lock() {
  stopTotp();
  stopAutoLock();
  hiddenAt = null; // audit-7 BT7-5: reset the visibility-timer state on every lock
  wipeMemory();
  // Clear sensitive master/unlock fields and the entire entry editor.
  for (const id of ['unlock-master', 'new-master', 'new-master-confirm', 'cm-new', 'cm-confirm']) {
    const el = $(id);
    if (el) el.value = '';
  }
  clearEditorFields();
  $('entry-editor').classList.add('hidden');
  showScreen('locked');
  hide($('open-error'));
}

// ============================================================
// Small DOM helpers
// ============================================================
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function setError(el, msg) { el.textContent = msg; show(el); }

const STRENGTH_COLORS = {
  '—': 'var(--text-dim)', 'Very weak': 'var(--danger)', Weak: 'var(--danger)',
  Fair: 'var(--warn)', Strong: 'var(--good)', 'Very strong': 'var(--good)',
};

function updateMeter(barEl, labelEl, pw) {
  const r = estimateStrength(pw);
  const pct = Math.max(0, Math.min(100, r.bits));
  barEl.style.width = pct + '%';
  barEl.style.background = STRENGTH_COLORS[r.label] || 'var(--text-dim)';
  barEl.setAttribute('aria-valuenow', String(Math.round(pct)));
  barEl.setAttribute('aria-valuetext', pw.length === 0 ? 'no password entered' : `${r.label}, about ${r.bits} bits`);
  if (labelEl) labelEl.textContent = pw.length === 0 ? ' ' : `${r.label} · ~${r.bits} bits`;
  return r;
}

// ============================================================
// Clipboard (best-effort auto-clear)
// ============================================================
async function copyText(text, note = 'Copied') {
  if (!text) return;
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch { ok = false; }
  const msg = $('copied-msg');
  if (msg) {
    msg.textContent = ok ? `${note} — will try to clear the clipboard in ~25s (only while this tab stays focused)` : 'Copy failed; select and press Ctrl+C';
    show(msg);
    setTimeout(() => hide(msg), 4000);
  }
  if (ok) {
    clearTimeout(clipboardTimer);
    clipboardTimer = setTimeout(() => {
      navigator.clipboard.writeText('').catch(() => {});
    }, CLIPBOARD_CLEAR_MS);
  }
}

// ============================================================
// Dirty tracking + auto-lock
// ============================================================
function markDirty(d = true) {
  state.dirty = d;
  $('dirty-badge').classList.toggle('hidden', !d);
  if (d) $('save-msg').textContent = '';
}

function resetAutoLock() {
  if (!state.unlocked) return;
  clearTimeout(autoLockTimer);
  const mins = Math.min(120, Math.max(1, Number($('autolock-min').value) || 10));
  autoLockTimer = setTimeout(lock, mins * 60 * 1000);
}
function stopAutoLock() { clearTimeout(autoLockTimer); autoLockTimer = null; }

// ============================================================
// File open / unlock / create
// ============================================================
async function onFileChosen(file) {
  hide($('open-error'));
  let envelope;
  try {
    envelope = JSON.parse(await file.text());
  } catch {
    setError($('open-error'), 'That file is not valid JSON. Choose a vault file exported by this tool.');
    return;
  }
  state.pendingEnvelope = envelope;
  state.filename = file.name || DEFAULT_FILENAME;
  $('unlock-filename').textContent = state.filename;
  $('unlock-master').value = '';
  hide($('unlock-error'));
  showScreen('unlock');
  $('unlock-master').focus();
}

async function doUnlock() {
  const pw = $('unlock-master').value;
  hide($('unlock-error'));
  if (!pw) { setError($('unlock-error'), 'Enter your master password.'); return; }
  const btn = $('unlock-confirm');
  btn.disabled = true; btn.textContent = 'Unlocking…';
  try {
    const { vault, key, salt, iterations } = await decryptVault(state.pendingEnvelope, pw);
    const entries = parseVaultObject(vault);
    state.entries = entries;
    state.key = key;
    state.salt = salt;
    state.iterations = iterations;
    state.pendingEnvelope = null;
    enterApp();
  } catch (e) {
    const msg = e instanceof VaultCryptoError ? e.message : 'Could not open this vault file.';
    setError($('unlock-error'), msg);
  } finally {
    btn.disabled = false; btn.textContent = 'Unlock';
  }
}

async function doCreate() {
  const pw = $('new-master').value;
  const confirm = $('new-master-confirm').value;
  hide($('create-error'));
  const r = estimateStrength(pw);
  if (r.bits < MASTER_MIN_BITS) {
    setError($('create-error'), `Master password is too weak (~${r.bits} bits). Use a longer passphrase — aim for "Strong".`);
    return;
  }
  if (pw !== confirm) { setError($('create-error'), 'The two master passwords do not match.'); return; }

  const btn = $('create-confirm');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(pw, salt, DEFAULT_ITERATIONS);
    state.entries = [];
    state.key = key;
    state.salt = salt;
    state.iterations = DEFAULT_ITERATIONS;
    state.filename = DEFAULT_FILENAME;
    enterApp();
    markDirty(true);
    $('save-msg').textContent = 'New vault created — add entries, then Save to write your file.';
  } catch (e) {
    setError($('create-error'), 'Could not create the vault: ' + (e && e.message ? e.message : 'unknown error'));
  } finally {
    btn.disabled = false; btn.textContent = 'Create vault';
  }
}

function enterApp() {
  state.unlocked = true;
  state.editingId = null;
  $('entry-editor').classList.add('hidden');
  markDirty(state.dirty);
  $('vault-search').value = '';
  renderList();
  showScreen('app');
  resetAutoLock();
}

// ============================================================
// Save (re-encrypt + download)
// ============================================================
async function doSave() {
  if (!state.unlocked || !state.key) return;
  const btn = $('save-vault');
  btn.disabled = true;
  try {
    const envelope = await encryptVaultWithKey(makeVaultObject(state.entries), state.key, state.salt, state.iterations);
    const json = JSON.stringify(envelope, null, 2);
    const downloaded = downloadFile(json, state.filename);
    if (downloaded) {
      markDirty(false);
      $('save-msg').textContent = `Saved (downloaded ${state.filename}). Replace your old file with it.`;
    } else {
      $('save-msg').textContent = 'Your browser blocked the download. Try again or check download settings.';
    }
  } catch (e) {
    $('save-msg').textContent = 'Save failed: ' + (e && e.message ? e.message : 'unknown error');
  } finally {
    btn.disabled = false;
  }
}

function downloadFile(text, filename) {
  if (typeof URL === 'undefined' || !URL.createObjectURL) return false;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

// ============================================================
// Entry list rendering
// ============================================================
function refreshTagFilter() {
  const sel = $('tag-filter');
  const current = sel.value;
  const tags = allTags(state.entries);
  sel.textContent = '';
  const optAll = document.createElement('option');
  optAll.value = ''; optAll.textContent = 'All tags';
  sel.appendChild(optAll);
  for (const t of tags) {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    sel.appendChild(o);
  }
  sel.value = tags.includes(current) ? current : '';
}

function visibleEntries() {
  let list = searchEntries(state.entries, $('vault-search').value);
  const tag = $('tag-filter').value;
  if (tag) list = filterByTag(list, tag);
  return list;
}

function makeRowButton(label, className, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
  return b;
}

function renderList() {
  refreshTagFilter();
  const listEl = $('entry-list');
  listEl.textContent = '';
  const list = visibleEntries();

  $('empty-state').classList.toggle('hidden', state.entries.length !== 0);
  $('no-match').classList.toggle('hidden', !(state.entries.length !== 0 && list.length === 0));

  for (const entry of list) {
    const li = document.createElement('li');
    li.className = 'entry-item';

    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = entry.title || '(untitled)';
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = entry.username || '';
    info.appendChild(title);
    info.appendChild(sub);
    if (entry.tags.length) {
      const tagWrap = document.createElement('div');
      tagWrap.className = 'tags';
      for (const t of entry.tags) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = t;
        tagWrap.appendChild(chip);
      }
      info.appendChild(tagWrap);
    }
    li.appendChild(info);

    if (entry.username) li.appendChild(makeRowButton('Copy user', 'btn secondary copy-btn', () => copyText(entry.username, 'Username copied')));
    if (entry.password) li.appendChild(makeRowButton('Copy pass', 'btn secondary copy-btn', () => copyText(entry.password, 'Password copied')));
    li.appendChild(makeRowButton('Edit', 'btn', () => openEditor(entry.id)));

    listEl.appendChild(li);
  }
}

// ============================================================
// Entry editor
// ============================================================
const customFieldsState = []; // working copy while editing: {id,label,value,hidden}
let customFieldSeq = 0; // monotonic within an editing session, so ids never collide

function openEditor(id) {
  const entry = id ? state.entries.find((e) => e.id === id) : null;
  state.editingId = entry ? entry.id : '';

  $('editor-h').textContent = entry ? 'Edit entry' : 'New entry';
  $('f-title').value = entry ? entry.title : '';
  $('f-username').value = entry ? entry.username : '';
  $('f-password').value = entry ? entry.password : '';
  $('f-url').value = entry ? entry.url : '';
  $('f-notes').value = entry ? entry.notes : '';
  $('f-tags').value = entry ? entry.tags.join(', ') : '';
  $('f-totp').value = entry && entry.totp ? entry.totp.secret : '';
  editingTotp = entry && entry.totp ? entry.totp : null;

  // password field starts hidden
  $('f-password').type = 'password';
  $('f-password-reveal').textContent = 'Show';
  $('f-password-reveal').setAttribute('aria-pressed', 'false');
  updateMeter($('f-strength-bar'), $('f-strength'), $('f-password').value);

  // custom fields
  customFieldsState.length = 0;
  if (entry) for (const cf of entry.customFields) customFieldsState.push({ ...cf });
  customFieldSeq = customFieldsState.length;
  renderCustomFields();

  // history
  renderHistory(entry ? entry.passwordHistory : []);

  // delete only for existing
  $('entry-delete').classList.toggle('hidden', !entry);

  // generator reset
  $('gen-out').value = '';
  $('gen-use').disabled = true;
  hide($('gen-error'));

  hide($('copied-msg'));
  refreshTotp();

  // show editor, hide list area
  show($('entry-editor'));
  hide($('entry-list'));
  hide($('empty-state'));
  hide($('no-match'));
  $('f-title').focus();
}

function closeEditor() {
  stopTotp();
  state.editingId = null;
  hide($('entry-editor'));
  clearEditorFields();
  show($('entry-list'));
  renderList();
}

function renderCustomFields() {
  const wrap = $('custom-fields');
  wrap.textContent = '';
  customFieldsState.forEach((cf, idx) => {
    const row = document.createElement('div');
    row.className = 'custom-field-row';

    const label = document.createElement('input');
    label.type = 'text'; label.placeholder = 'Label'; label.value = cf.label; label.className = 'cf-label';
    label.setAttribute('aria-label', 'Custom field label');
    label.addEventListener('input', () => { cf.label = label.value; });

    const value = document.createElement('input');
    value.type = cf.hidden ? 'password' : 'text';
    value.placeholder = 'Value'; value.value = cf.value; value.className = 'cf-value mono';
    value.setAttribute('aria-label', 'Custom field value');
    value.autocomplete = 'off';
    value.addEventListener('input', () => { cf.value = value.value; });

    const hideLabel = document.createElement('label');
    hideLabel.className = 'cf-hide-label';
    const hideChk = document.createElement('input');
    hideChk.type = 'checkbox'; hideChk.checked = cf.hidden;
    hideChk.addEventListener('change', () => { cf.hidden = hideChk.checked; value.type = cf.hidden ? 'password' : 'text'; });
    hideLabel.appendChild(hideChk);
    hideLabel.appendChild(document.createTextNode(' hide'));

    const copy = makeRowButton('Copy', 'btn secondary copy-btn', () => copyText(cf.value, 'Field copied'));
    const remove = makeRowButton('✕', 'btn secondary', () => { customFieldsState.splice(idx, 1); renderCustomFields(); });
    remove.setAttribute('aria-label', 'Remove custom field');

    row.append(label, value, hideLabel, copy, remove);
    wrap.appendChild(row);
  });
}

function renderHistory(history) {
  const det = $('history');
  if (!history || history.length === 0) { hide(det); return; }
  show(det);
  $('history-count').textContent = String(history.length);
  const ul = $('history-list');
  ul.textContent = '';
  for (const h of history) {
    const li = document.createElement('li');
    const when = h.changedAt ? new Date(h.changedAt).toLocaleString() : 'unknown date';
    const span = document.createElement('span');
    span.className = 'mono';
    span.textContent = h.password;
    li.appendChild(span);
    li.appendChild(document.createTextNode(`  — changed ${when}  `));
    li.appendChild(makeRowButton('Copy', 'btn secondary copy-btn', () => copyText(h.password, 'Old password copied')));
    ul.appendChild(li);
  }
}

function collectEditorFields() {
  const tags = $('f-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
  const secret = $('f-totp').value.trim();
  return {
    title: $('f-title').value,
    username: $('f-username').value,
    password: $('f-password').value,
    url: $('f-url').value,
    notes: $('f-notes').value,
    tags,
    // Preserve non-default TOTP params (digits/period/algorithm) when the secret
    // is unchanged; a new/changed secret falls back to the standard defaults.
    totp: secret
      ? (editingTotp && editingTotp.secret === secret ? { ...editingTotp, secret } : { secret })
      : null,
    customFields: customFieldsState
      .map((cf) => ({ ...cf }))
      .filter((cf) => cf.label !== '' || cf.value !== ''),
  };
}

function saveEntry() {
  const fields = collectEditorFields();
  if (state.editingId) {
    const existing = state.entries.find((e) => e.id === state.editingId);
    const updated = updateEntry(existing, fields);
    state.entries = upsertEntry(state.entries, updated);
  } else {
    state.entries = upsertEntry(state.entries, createEntry(fields));
  }
  markDirty(true);
  closeEditor();
}

function removeEntry() {
  if (!state.editingId) return;
  const entry = state.entries.find((e) => e.id === state.editingId);
  const name = entry && entry.title ? `"${entry.title}"` : 'this entry';
  if (!confirm(`Delete ${name}? This cannot be undone (until you reload without saving).`)) return;
  state.entries = deleteEntry(state.entries, state.editingId);
  markDirty(true);
  closeEditor();
}

// ============================================================
// TOTP live code in editor
// ============================================================
function stopTotp() { clearInterval(totpTimer); totpTimer = null; }

function refreshTotp() {
  stopTotp();
  const secret = $('f-totp').value.trim();
  const display = $('totp-display');
  if (!secret) { hide(display); return; }
  show(display);
  // Honor the entry's stored TOTP params when the secret matches; else defaults.
  const p = editingTotp && editingTotp.secret === secret
    ? { digits: editingTotp.digits, period: editingTotp.period, algorithm: editingTotp.algorithm }
    : { digits: 6, period: 30, algorithm: 'SHA-1' };
  const tick = async () => {
    let bytes;
    try { bytes = base32Decode(secret); } catch { $('totp-code').textContent = 'invalid secret'; $('totp-countdown').textContent = ''; return; }
    if (bytes.length === 0) { $('totp-code').textContent = 'invalid secret'; $('totp-countdown').textContent = ''; return; }
    const now = Date.now() / 1000;
    try {
      const code = await totp(bytes, { time: now, digits: p.digits, period: p.period, algorithm: p.algorithm });
      $('totp-code').textContent = p.digits === 6 ? code.replace(/(\d{3})(\d{3})/, '$1 $2') : code;
      $('totp-countdown').textContent = `${secondsRemaining(now, p.period)}s`;
    } catch {
      $('totp-code').textContent = 'invalid secret';
      $('totp-countdown').textContent = '';
    }
  };
  tick();
  totpTimer = setInterval(tick, 1000);
}

// ============================================================
// Generator
// ============================================================
function syncGenMode() {
  const mode = $('gen-mode').value;
  $('gen-words-wrap').classList.toggle('hidden', mode !== 'passphrase');
  $('gen-random-opts').classList.toggle('hidden', mode !== 'random');
  $('gen-len-wrap').classList.toggle('hidden', mode !== 'random');
}

function makeGenerated() {
  hide($('gen-error'));
  try {
    let out;
    if ($('gen-mode').value === 'passphrase') {
      out = generatePassphrase(
        { words: Number($('gen-words').value), separator: '-', capitalize: $('gen-cap').checked, appendDigit: false },
        EFF_WORDLIST,
      );
    } else {
      out = generatePassword({
        length: Number($('gen-length').value),
        lower: $('gen-lower').checked,
        upper: $('gen-upper').checked,
        digits: $('gen-digits').checked,
        symbols: $('gen-symbols').checked,
      });
    }
    $('gen-out').value = out;
    $('gen-use').disabled = false;
  } catch (e) {
    setError($('gen-error'), e && e.message ? e.message : 'Could not generate a password.');
    $('gen-use').disabled = true;
  }
}

function useGenerated() {
  const v = $('gen-out').value;
  if (!v) return;
  $('f-password').value = v;
  updateMeter($('f-strength-bar'), $('f-strength'), v);
}

// ============================================================
// Change master password
// ============================================================
function updateChangeMasterGate() {
  const pw = $('cm-new').value;
  const r = updateMeter($('cm-meter-bar'), $('cm-strength'), pw);
  $('cm-apply').disabled = !(r.bits >= MASTER_MIN_BITS && pw && pw === $('cm-confirm').value);
}

async function applyChangeMaster() {
  const pw = $('cm-new').value;
  const btn = $('cm-apply');
  btn.disabled = true; btn.textContent = 'Changing…';
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(pw, salt, DEFAULT_ITERATIONS);
    state.key = key;
    state.salt = salt;
    state.iterations = DEFAULT_ITERATIONS;
    markDirty(true);
    $('cm-new').value = '';
    $('cm-confirm').value = '';
    updateMeter($('cm-meter-bar'), $('cm-strength'), '');
    const msg = $('cm-msg');
    msg.className = 'msg ok'; // reset in case a prior attempt left it in the error state
    msg.textContent = 'Master password changed. Click Save to write it to your file.';
    show(msg);
    setTimeout(() => hide(msg), 6000);
  } catch (e) {
    const msg = $('cm-msg');
    msg.className = 'msg error';
    msg.textContent = 'Could not change master password.';
    show(msg);
  } finally {
    btn.textContent = 'Change password';
  }
}

// ============================================================
// Master-password create gate
// ============================================================
function updateCreateGate() {
  const pw = $('new-master').value;
  const r = updateMeter($('master-meter-bar'), $('master-strength'), pw);
  $('create-confirm').disabled = !(r.bits >= MASTER_MIN_BITS && pw && pw === $('new-master-confirm').value);
}

// ============================================================
// Reveal toggles
// ============================================================
function wireReveal(btnId, inputId) {
  const btn = $(btnId);
  const input = $(inputId);
  btn.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? 'Show' : 'Hide';
    btn.setAttribute('aria-pressed', String(!showing));
  });
}

// ============================================================
// Wiring (only runs in a real document)
// ============================================================
function init() {
  // Landing
  $('open-existing').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) onFileChosen(file);
    e.target.value = '';
  });
  $('create-new').addEventListener('click', () => {
    $('new-master').value = ''; $('new-master-confirm').value = '';
    updateMeter($('master-meter-bar'), $('master-strength'), '');
    $('create-confirm').disabled = true;
    hide($('create-error'));
    showScreen('create');
    $('new-master').focus();
  });

  // Create
  $('new-master').addEventListener('input', updateCreateGate);
  $('new-master-confirm').addEventListener('input', updateCreateGate);
  wireReveal('new-master-reveal', 'new-master');
  $('create-confirm').addEventListener('click', doCreate);
  $('create-cancel').addEventListener('click', lock);

  // Unlock
  wireReveal('unlock-reveal', 'unlock-master');
  $('unlock-confirm').addEventListener('click', doUnlock);
  $('unlock-cancel').addEventListener('click', lock);
  $('unlock-master').addEventListener('keydown', (e) => { if (e.key === 'Enter') doUnlock(); });

  // App toolbar
  $('vault-search').addEventListener('input', renderList);
  $('tag-filter').addEventListener('change', renderList);
  $('add-entry').addEventListener('click', () => openEditor(null));
  $('save-vault').addEventListener('click', doSave);
  $('lock-vault').addEventListener('click', lock);

  // Change master
  $('cm-new').addEventListener('input', updateChangeMasterGate);
  $('cm-confirm').addEventListener('input', updateChangeMasterGate);
  $('cm-apply').addEventListener('click', applyChangeMaster);

  // Editor
  wireReveal('f-password-reveal', 'f-password');
  $('f-password').addEventListener('input', () => updateMeter($('f-strength-bar'), $('f-strength'), $('f-password').value));
  $('f-totp').addEventListener('input', refreshTotp);
  $('add-custom').addEventListener('click', () => { customFieldsState.push({ id: `cf${customFieldSeq++}`, label: '', value: '', hidden: false }); renderCustomFields(); });
  $('entry-save').addEventListener('click', saveEntry);
  $('entry-cancel').addEventListener('click', closeEditor);
  $('entry-delete').addEventListener('click', removeEntry);
  $('copy-username').addEventListener('click', () => copyText($('f-username').value, 'Username copied'));
  $('copy-password').addEventListener('click', () => copyText($('f-password').value, 'Password copied'));
  $('copy-totp').addEventListener('click', async () => {
    const secret = $('f-totp').value.trim();
    // Use the same stored params as the on-screen code so the copy always matches.
    const p = editingTotp && editingTotp.secret === secret
      ? { digits: editingTotp.digits, period: editingTotp.period, algorithm: editingTotp.algorithm }
      : { digits: 6, period: 30, algorithm: 'SHA-1' };
    try {
      const code = await totp(base32Decode(secret), { time: Date.now() / 1000, digits: p.digits, period: p.period, algorithm: p.algorithm });
      copyText(code, 'Code copied');
    } catch { /* ignore invalid secret */ }
  });

  // Generator
  $('gen-mode').addEventListener('change', syncGenMode);
  $('gen-length').addEventListener('input', () => { $('gen-length-val').textContent = $('gen-length').value; });
  $('gen-words').addEventListener('input', () => { $('gen-words-val').textContent = $('gen-words').value; });
  $('gen-make').addEventListener('click', makeGenerated);
  $('gen-use').addEventListener('click', useGenerated);
  syncGenMode();

  // Auto-lock activity + page-life hooks
  for (const ev of ['click', 'keydown', 'input', 'touchstart']) {
    document.addEventListener(ev, resetAutoLock, { passive: true });
  }
  // audit-6 m6: background tabs throttle the setTimeout auto-lock, and a
  // tab-switch does not fire pagehide. Track hidden time and lock on return if the
  // auto-lock interval already elapsed while we were away (a robust backstop to
  // the timer, without annoying early locks on a brief tab switch).
  document.addEventListener('visibilitychange', () => {
    if (!state.unlocked) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (hiddenAt != null) {
      const mins = Math.min(120, Math.max(1, Number($('autolock-min').value) || 10));
      if (Date.now() - hiddenAt >= mins * 60 * 1000) lock();
      hiddenAt = null;
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.unlocked && state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  // On pagehide do a full DOM scrub (lock), not just wipeMemory, so the
  // decrypted list, editor fields, and master inputs do not linger; also drop
  // the rendered list so stale Copy-button closures (capturing plaintext) die.
  window.addEventListener('pagehide', () => { const el = $('entry-list'); if (el) el.textContent = ''; lock(); });
  // If the page is restored from the bfcache while logically locked, re-lock so
  // no decrypted DOM survives a back/forward restore.
  window.addEventListener('pageshow', (e) => { if (e.persisted && !state.unlocked) lock(); });

  showScreen('locked');
}

if (typeof document !== 'undefined') {
  init();
}

// Exported for tests.
export { state, collectEditorFields };
