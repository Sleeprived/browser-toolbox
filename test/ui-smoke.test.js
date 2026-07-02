// @vitest-environment jsdom
// Runtime smoke tests: load each non-canvas tool page's DOM and execute its UI
// module, then drive a basic interaction. Catches wiring errors (missing
// elements, bad handlers) that static checks miss. Canvas/FileReader tools
// (QR, EXIF, palette) are verified by hand in a real browser per the spec.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { exportStripSvg } from '../src/cipher/glyph-render.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadBody(htmlFile) {
  const html = readFileSync(path.join(root, htmlFile), 'utf8');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  // innerHTML does not execute <script> tags, so only the markup is installed.
  document.documentElement.innerHTML = `<head></head><body>${body}</body>`;
}

beforeEach(() => {
  vi.resetModules();
});

describe('cron UI', () => {
  it('renders a description and next runs for the default expression', async () => {
    loadBody('cron.html');
    await import('../src/cron/cron-ui.js');
    expect(document.getElementById('description').textContent).toContain('Monday through Friday');
    expect(document.getElementById('next-runs').children.length).toBe(5);
  });

  it('shows an error for an invalid expression', async () => {
    loadBody('cron.html');
    await import('../src/cron/cron-ui.js');
    const input = document.getElementById('expr');
    input.value = 'not a cron';
    input.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('error').classList.contains('hidden')).toBe(false);
  });
});

describe('passphrase UI', () => {
  it('generates a passphrase with entropy on load', async () => {
    loadBody('passphrase.html');
    await import('../src/passphrase/pass-ui.js');
    const out = document.getElementById('out').value;
    expect(out.split('-').length).toBe(6);
    expect(document.getElementById('entropy').textContent).toMatch(/bits/);
  });

  it('updates the strength meter when a password is typed', async () => {
    loadBody('passphrase.html');
    await import('../src/passphrase/pass-ui.js');
    const pw = document.getElementById('pw');
    pw.value = 'password';
    pw.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('strength').textContent).toMatch(/Very weak/);
  });

  it('reveal toggle flips the password field type', async () => {
    loadBody('passphrase.html');
    await import('../src/passphrase/pass-ui.js');
    const pw = document.getElementById('pw');
    expect(pw.type).toBe('password');
    document.getElementById('reveal').dispatchEvent(new window.Event('click'));
    expect(pw.type).toBe('text');
  });
});

describe('csv UI', () => {
  it('parses pasted CSV into a table', async () => {
    loadBody('csv.html');
    await import('../src/csv/csv-ui.js');
    document.getElementById('csv-in').value = 'name,age\nAda,36\nAlan,41';
    document.getElementById('parse').dispatchEvent(new window.Event('click'));
    const rows = document.querySelectorAll('#table tbody tr');
    expect(rows.length).toBe(2);
    expect(document.getElementById('table-card').classList.contains('hidden')).toBe(false);
  });

  it('converts the table to JSON', async () => {
    loadBody('csv.html');
    await import('../src/csv/csv-ui.js');
    document.getElementById('csv-in').value = 'a,b\n1,2';
    document.getElementById('parse').dispatchEvent(new window.Event('click'));
    document.getElementById('to-json').dispatchEvent(new window.Event('click'));
    expect(JSON.parse(document.getElementById('json-out').textContent)).toEqual([{ a: '1', b: '2' }]);
  });

  it('warns on ragged rows but still keeps every cell', async () => {
    loadBody('csv.html');
    await import('../src/csv/csv-ui.js');
    document.getElementById('csv-in').value = 'a,b\n1,2,3';
    document.getElementById('parse').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('warn').classList.contains('hidden')).toBe(false);
    document.getElementById('to-json').dispatchEvent(new window.Event('click'));
    expect(JSON.parse(document.getElementById('json-out').textContent))
      .toEqual([{ a: '1', b: '2', column_3: '3' }]);
  });

  it('refuses a tall file even when its rows are split by bare CR (\\r)', async () => {
    // Regression: the tall-file guard once counted only \n, but parseCsv also splits
    // rows on a lone \r — so a \r-delimited paste slipped past the guard and froze the
    // tab. The guard must trip (and NOT run parseCsv) here.
    loadBody('csv.html');
    await import('../src/csv/csv-ui.js');
    document.getElementById('csv-in').value = '\r'.repeat(1000001); // > MAX_ROWS (1,000,000)
    document.getElementById('parse').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('error').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('error').textContent).toMatch(/row limit/);
    expect(document.getElementById('table-card').classList.contains('hidden')).toBe(true);
  });
});

describe('encode UI', () => {
  it('encodes input live and decodes back', async () => {
    loadBody('encode.html');
    await import('../src/encode/encode-ui.js');
    const inEl = document.getElementById('enc-in');
    inEl.value = 'AB';
    document.getElementById('enc-format').value = 'hex';
    inEl.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('enc-out').textContent).toBe('4142');
  });

  it('shows an aria-live error for invalid hex on decode', async () => {
    loadBody('encode.html');
    await import('../src/encode/encode-ui.js');
    document.getElementById('enc-format').value = 'hex';
    document.getElementById('enc-mode').value = 'decode';
    const inEl = document.getElementById('enc-in');
    inEl.value = 'zz';
    inEl.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('enc-error').classList.contains('hidden')).toBe(false);
  });
});

describe('jwt UI', () => {
  it('decodes a pasted token into header and payload', async () => {
    loadBody('jwt.html');
    await import('../src/jwt/jwt-ui.js');
    // {"alg":"HS256","typ":"JWT"} . {"sub":"1","name":"x"} . sig
    const t = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwibmFtZSI6IngifQ.sig';
    const inEl = document.getElementById('jwt-in');
    inEl.value = t;
    inEl.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('jwt-header').textContent).toContain('HS256');
    expect(document.getElementById('jwt-payload').textContent).toContain('"sub"');
    expect(document.getElementById('jwt-result').classList.contains('hidden')).toBe(false);
  });

  it('shows an error for a non-JWT string', async () => {
    loadBody('jwt.html');
    await import('../src/jwt/jwt-ui.js');
    const inEl = document.getElementById('jwt-in');
    inEl.value = 'not a jwt';
    inEl.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('jwt-error').classList.contains('hidden')).toBe(false);
  });

  it('verifies a valid HS256 signature and rejects a wrong secret', async () => {
    loadBody('jwt.html');
    await import('../src/jwt/jwt-ui.js');
    // Precomputed: header {alg:HS256,typ:JWT}, payload {sub:"1",name:"x"}, HMAC-SHA256 key "my-secret".
    const t = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwibmFtZSI6IngifQ.zbB-YHbu5RiWZZvtkO_FbwK5ICsgD4pHuCAAvdigNEM';
    const inEl = document.getElementById('jwt-in');
    inEl.value = t;
    inEl.dispatchEvent(new window.Event('input'));

    const verdict = document.getElementById('jwt-verdict');
    const secret = document.getElementById('jwt-secret');

    // Correct secret -> VALID. The verify handler is async and not awaited by
    // dispatchEvent, so poll the verdict until it is populated.
    secret.value = 'my-secret';
    document.getElementById('jwt-verify').dispatchEvent(new window.Event('click'));
    for (let i = 0; i < 100 && !verdict.textContent; i++) await new Promise((r) => setTimeout(r, 5));
    expect(verdict.textContent).toMatch(/VALID/);
    expect(verdict.textContent).not.toMatch(/INVALID/);

    // Wrong secret -> INVALID.
    verdict.textContent = '';
    secret.value = 'wrong-secret';
    document.getElementById('jwt-verify').dispatchEvent(new window.Event('click'));
    for (let i = 0; i < 100 && !verdict.textContent; i++) await new Promise((r) => setTimeout(r, 5));
    expect(verdict.textContent).toMatch(/INVALID/);
  });
});

describe('vault UI', () => {
  it('starts on the locked screen with the app hidden', async () => {
    loadBody('vault.html');
    await import('../src/vault/vault-ui.js');
    expect(document.getElementById('vault-locked').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('vault-app').classList.contains('hidden')).toBe(true);
  });

  it('reveals the create form and gates the button on master-password strength', async () => {
    loadBody('vault.html');
    await import('../src/vault/vault-ui.js');
    document.getElementById('create-new').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('vault-create').classList.contains('hidden')).toBe(false);

    const pw = document.getElementById('new-master');
    const confirm = document.getElementById('new-master-confirm');
    const btn = document.getElementById('create-confirm');

    pw.value = 'weak';
    pw.dispatchEvent(new window.Event('input'));
    expect(btn.disabled).toBe(true);

    pw.value = 'vault-master-correct-horse-staple-9!';
    pw.dispatchEvent(new window.Event('input'));
    confirm.value = 'vault-master-correct-horse-staple-9!';
    confirm.dispatchEvent(new window.Event('input'));
    expect(btn.disabled).toBe(false);
  });

  it('keeps the create button disabled (and labels "Strong") for a score-4 master under the guesses floor', async () => {
    // "correcthorsebattery" is zxcvbn score 4 but below the ~36-bit guesses floor. The
    // two-part gate must reject it at the UI even though the two entries match, and the
    // meter must NOT read "Very strong". Guards against a future revert to a score-only gate.
    loadBody('vault.html');
    await import('../src/vault/vault-ui.js');
    document.getElementById('create-new').dispatchEvent(new window.Event('click'));

    const pw = document.getElementById('new-master');
    const confirm = document.getElementById('new-master-confirm');
    pw.value = 'correcthorsebattery';
    pw.dispatchEvent(new window.Event('input'));
    confirm.value = 'correcthorsebattery';
    confirm.dispatchEvent(new window.Event('input'));

    expect(document.getElementById('create-confirm').disabled).toBe(true);
    const label = document.getElementById('master-strength').textContent;
    expect(label).toContain('Strong');         // downgraded display label
    expect(label).not.toContain('Very strong'); // must not claim the top tier the gate refused
  });

  it('cancelling the create form returns to the locked screen', async () => {
    loadBody('vault.html');
    await import('../src/vault/vault-ui.js');
    document.getElementById('create-new').dispatchEvent(new window.Event('click'));
    document.getElementById('create-cancel').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('vault-locked').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('vault-create').classList.contains('hidden')).toBe(true);
  });

  it('auto-locks after the configured inactivity timeout', async () => {
    vi.useFakeTimers();
    try {
      loadBody('vault.html');
      const mod = await import('../src/vault/vault-ui.js');
      mod.state.unlocked = true;
      document.getElementById('autolock-min').value = '1'; // 1 minute
      document.dispatchEvent(new window.Event('click')); // activity arms the timer
      vi.advanceTimersByTime(59 * 1000);
      expect(mod.state.unlocked).toBe(true);
      vi.advanceTimersByTime(2 * 1000); // cross the 60s threshold
      expect(mod.state.unlocked).toBe(false);
      expect(document.getElementById('vault-locked').classList.contains('hidden')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('saving re-encrypts and clears the unsaved-changes flag', async () => {
    loadBody('vault.html');
    const mod = await import('../src/vault/vault-ui.js');
    const { deriveKey } = await import('../src/vault/crypto.js');

    const origCreate = global.URL.createObjectURL;
    const origRevoke = global.URL.revokeObjectURL;
    const origClick = window.HTMLAnchorElement.prototype.click;
    global.URL.createObjectURL = () => 'blob:fake';
    global.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = () => {}; // jsdom would try to navigate
    try {
      const salt = new Uint8Array(16).fill(3);
      mod.state.unlocked = true;
      mod.state.key = await deriveKey('pw', salt, 1000);
      mod.state.salt = salt;
      mod.state.iterations = 1000;
      mod.state.entries = [];
      mod.state.dirty = true;

      document.getElementById('save-vault').dispatchEvent(new window.Event('click'));
      // doSave is async (real AES-GCM); poll for the result.
      for (let i = 0; i < 100 && mod.state.dirty; i++) await new Promise((r) => setTimeout(r, 10));

      expect(mod.state.dirty).toBe(false);
      expect(document.getElementById('save-msg').textContent).toMatch(/Saved/);
    } finally {
      global.URL.createObjectURL = origCreate;
      global.URL.revokeObjectURL = origRevoke;
      window.HTMLAnchorElement.prototype.click = origClick;
    }
  });

  it('reveals a saved password from its row, then auto-hides it after 30s', async () => {
    vi.useFakeTimers();
    try {
      loadBody('vault.html');
      const mod = await import('../src/vault/vault-ui.js');
      const { createEntry } = await import('../src/vault/model.js');
      mod.state.unlocked = true;
      mod.state.entries = [createEntry({ title: 'GitHub', username: 'me', password: 'sekret-pw' }, { id: 'e1', now: 1 })];
      document.getElementById('vault-search').dispatchEvent(new window.Event('input')); // triggers renderList

      const showBtn = [...document.querySelectorAll('#entry-list button')].find((b) => b.textContent === 'Show');
      expect(showBtn).toBeTruthy();
      showBtn.dispatchEvent(new window.Event('click'));
      const pwSpan = document.querySelector('#entry-list .row-pw');
      expect(pwSpan.textContent).toBe('sekret-pw');
      expect(pwSpan.classList.contains('hidden')).toBe(false);
      expect(showBtn.textContent).toBe('Hide');

      vi.advanceTimersByTime(30 * 1000 + 100); // auto-hide fires
      expect(pwSpan.textContent).toBe('');
      expect(pwSpan.classList.contains('hidden')).toBe(true);
      expect(showBtn.textContent).toBe('Show');
    } finally {
      vi.useRealTimers();
    }
  });

  it('imports entries from a chosen CSV with auto-detected column mapping', async () => {
    loadBody('vault.html');
    const mod = await import('../src/vault/vault-ui.js');
    mod.state.unlocked = true;

    const csv = 'name,username,password\nGitHub,me,pw1\nGitLab,you,pw2\n';
    const file = new File([csv], 'export.csv', { type: 'text/csv' });
    const input = document.getElementById('csv-input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new window.Event('change'));

    // onCsvChosen is async (file.text()); poll for the panel to open.
    for (let i = 0; i < 100 && document.getElementById('import-panel').classList.contains('hidden'); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(document.getElementById('import-panel').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('map-title').value).toBe('name');
    expect(document.getElementById('map-password').value).toBe('password');
    expect(document.getElementById('import-summary').textContent).toMatch(/Will import 2 of 2/);

    document.getElementById('import-confirm').dispatchEvent(new window.Event('click'));
    expect(mod.state.entries.length).toBe(2);
    expect(mod.state.entries[0].title).toBe('GitHub');
    expect(mod.state.entries[0].password).toBe('pw1');
    expect(mod.state.dirty).toBe(true);
  });
});

describe('image UI', () => {
  it('module loads and wires controls without touching canvas at import', async () => {
    loadBody('image.html');
    await import('../src/image/image-ui.js');
    expect(document.getElementById('dropzone')).not.toBeNull();
    expect(document.getElementById('img-apply')).not.toBeNull();
    // Quality label updates on input (no canvas needed).
    const q = document.getElementById('img-quality');
    q.value = '0.5';
    q.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('img-quality-val').textContent).toBe('0.5');
  });
});

describe('morse UI', () => {
  it('imports without Web Audio / vibrate / matchMedia and encodes live', async () => {
    loadBody('morse.html');
    await import('../src/morse/morse-ui.js');
    const inEl = document.getElementById('morse-in');
    inEl.value = 'HELLO';
    inEl.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('morse-out').textContent).toBe('.... . .-.. .-.. ---');
  });

  it('decodes Morse back to text when direction is flipped', async () => {
    loadBody('morse.html');
    await import('../src/morse/morse-ui.js');
    document.getElementById('morse-dir').value = 'decode';
    const inEl = document.getElementById('morse-in');
    inEl.value = '.... ..';
    inEl.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('morse-out').textContent).toBe('HI');
  });

  it('disables vibrate when navigator.vibrate is unavailable (jsdom)', async () => {
    loadBody('morse.html');
    await import('../src/morse/morse-ui.js');
    expect(document.getElementById('morse-vibrate').disabled).toBe(true);
  });
});

describe('cipher UI', () => {
  it('encodes text live with the default Tap Code format', async () => {
    loadBody('cipher.html');
    await import('../src/cipher/cipher-ui.js');
    const inEl = document.getElementById('cipher-in');
    inEl.value = 'HELLO';
    inEl.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('cipher-out').textContent).toBe('2-3 1-5 3-1 3-1 3-4');
  });

  it('renders real glyph geometry for pigpen encode (createElementNS)', async () => {
    loadBody('cipher.html');
    await import('../src/cipher/cipher-ui.js');
    const format = document.getElementById('cipher-format');
    format.value = 'pigpen';
    format.dispatchEvent(new window.Event('change'));
    const inEl = document.getElementById('cipher-in');
    inEl.value = 'A';
    inEl.dispatchEvent(new window.Event('input'));
    const svg = document.querySelector('#cipher-visual svg');
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('line').length).toBe(2);    // A = right + bottom edges
    expect(svg.querySelectorAll('polygon').length).toBe(0); // pigpen never emits a flag
  });

  it('renders semaphore arms with flag polygons on visual encode', async () => {
    loadBody('cipher.html');
    await import('../src/cipher/cipher-ui.js');
    const format = document.getElementById('cipher-format');
    format.value = 'semaphore';
    format.dispatchEvent(new window.Event('change'));
    const inEl = document.getElementById('cipher-in');
    inEl.value = 'D';
    inEl.dispatchEvent(new window.Event('input'));
    const svg = document.querySelector('#cipher-visual svg');
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('line').length).toBe(2);    // two arms
    expect(svg.querySelectorAll('polygon').length).toBe(2); // two flags (drawSemaphore ran)
    expect(svg.querySelectorAll('circle').length).toBe(1);  // body
  });

  it('renders the dotted and X pigpen glyph branches (N, S, W)', async () => {
    loadBody('cipher.html');
    await import('../src/cipher/cipher-ui.js');
    document.getElementById('cipher-format').value = 'pigpen';
    document.getElementById('cipher-format').dispatchEvent(new window.Event('change'));
    const inEl = document.getElementById('cipher-in');
    inEl.value = 'NSW';
    inEl.dispatchEvent(new window.Event('input'));
    const svgs = document.querySelectorAll('#cipher-visual svg');
    expect(svgs.length).toBe(3);
    expect(svgs[0].querySelectorAll('line').length).toBe(4);   // N: full box (group 2)
    expect(svgs[0].querySelectorAll('circle').length).toBe(1); // N: dot
    expect(svgs[1].querySelectorAll('line').length).toBe(2);   // S: plain X chevron
    expect(svgs[1].querySelectorAll('circle').length).toBe(0);
    expect(svgs[2].querySelectorAll('line').length).toBe(2);   // W: dotted X
    expect(svgs[2].querySelectorAll('circle').length).toBe(1); // W: dot
  });

  it('renders a word-break token and supports space/backspace edits', async () => {
    loadBody('cipher.html');
    await import('../src/cipher/cipher-ui.js');
    document.getElementById('cipher-format').value = 'pigpen';
    document.getElementById('cipher-format').dispatchEvent(new window.Event('change'));
    // encode: word break emits an SR-perceivable token
    const inEl = document.getElementById('cipher-in');
    inEl.value = 'A B';
    inEl.dispatchEvent(new window.Event('input'));
    const gap = document.querySelector('#cipher-visual .word-gap span');
    expect(gap).not.toBeNull();
    expect(gap.textContent).toBe('space');
    // decode: Insert space + Delete last edit the buffer
    const dir = document.getElementById('cipher-dir');
    dir.value = 'decode';
    dir.dispatchEvent(new window.Event('change'));
    const btnFor = (label) => [...document.querySelectorAll('#cipher-palette button')]
      .find((b) => b.getAttribute('aria-label') === label);
    btnFor('Letter H').dispatchEvent(new window.Event('click'));
    btnFor('Insert space').dispatchEvent(new window.Event('click'));
    btnFor('Letter I').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('cipher-out').textContent).toBe('H I');
    btnFor('Delete last').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('cipher-out').textContent).toBe('H ');
  });

  it('uses the exact skipped/decode-loss notice strings', async () => {
    loadBody('cipher.html');
    await import('../src/cipher/cipher-ui.js');
    const inEl = document.getElementById('cipher-in');
    const skipped = document.getElementById('cipher-skipped');
    // encode skip (tapcode)
    inEl.value = 'A1';
    inEl.dispatchEvent(new window.Event('input'));
    expect(skipped.textContent).toBe('Skipped (no code): 1');
    // decode loss (baconian, one short group)
    document.getElementById('cipher-format').value = 'baconian';
    document.getElementById('cipher-format').dispatchEvent(new window.Event('change'));
    document.getElementById('cipher-dir').value = 'decode';
    document.getElementById('cipher-dir').dispatchEvent(new window.Event('change'));
    inEl.value = 'AABB';
    inEl.dispatchEvent(new window.Event('input'));
    expect(skipped.textContent).toBe('1 token(s) could not be decoded.');
  });

  it('announces skipped characters on encode and undecodable tokens on decode', async () => {
    loadBody('cipher.html');
    await import('../src/cipher/cipher-ui.js');
    const inEl = document.getElementById('cipher-in');
    const skipped = document.getElementById('cipher-skipped');
    inEl.value = 'A1';
    inEl.dispatchEvent(new window.Event('input'));
    expect(skipped.classList.contains('hidden')).toBe(false);
    expect(skipped.textContent).toContain('1');

    const dir = document.getElementById('cipher-dir');
    dir.value = 'decode';
    dir.dispatchEvent(new window.Event('change'));
    inEl.value = '0-1';
    inEl.dispatchEvent(new window.Event('input'));
    expect(skipped.textContent).toMatch(/could not be decoded/);
  });

  it('announces Clear and a destructive mode switch via the status region', async () => {
    loadBody('cipher.html');
    await import('../src/cipher/cipher-ui.js');
    document.getElementById('cipher-format').value = 'pigpen';
    document.getElementById('cipher-format').dispatchEvent(new window.Event('change'));
    const dir = document.getElementById('cipher-dir');
    dir.value = 'decode';
    dir.dispatchEvent(new window.Event('change'));
    const btnFor = (label) => [...document.querySelectorAll('#cipher-palette button')]
      .find((b) => b.getAttribute('aria-label') === label);
    const status = document.getElementById('cipher-status');

    btnFor('Letter H').dispatchEvent(new window.Event('click'));
    btnFor('Clear all').dispatchEvent(new window.Event('click'));
    expect(status.textContent).toBe('Cleared');

    btnFor('Letter H').dispatchEvent(new window.Event('click'));
    const format = document.getElementById('cipher-format');
    format.value = 'semaphore';
    format.dispatchEvent(new window.Event('change'));
    expect(status.classList.contains('hidden')).toBe(false);
    expect(status.textContent).toBe('Switched — palette cleared');
  });

  it('falls back to an SVG download when PNG rasterization fails', async () => {
    loadBody('cipher.html');
    await import('../src/cipher/cipher-ui.js');
    document.getElementById('cipher-format').value = 'pigpen';
    document.getElementById('cipher-format').dispatchEvent(new window.Event('change'));
    const inEl = document.getElementById('cipher-in');
    inEl.value = 'A';
    inEl.dispatchEvent(new window.Event('input'));

    const blobs = [];
    const origCreate = global.URL.createObjectURL;
    const origRevoke = global.URL.revokeObjectURL;
    const origClick = window.HTMLAnchorElement.prototype.click;
    const OrigImage = global.Image;
    global.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:fake'; };
    global.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = () => {};
    // Image whose src setter triggers onerror -> exercises the SVG fallback path.
    global.Image = class { set src(_v) { if (this.onerror) setTimeout(() => this.onerror(), 0); } };
    try {
      document.getElementById('cipher-download-png').dispatchEvent(new window.Event('click'));
      await new Promise((r) => setTimeout(r, 10));
      expect(document.getElementById('cipher-status').textContent).toMatch(/SVG instead/);
      expect(blobs.some((b) => b.type === 'image/svg+xml')).toBe(true);
    } finally {
      global.URL.createObjectURL = origCreate;
      global.URL.revokeObjectURL = origRevoke;
      window.HTMLAnchorElement.prototype.click = origClick;
      global.Image = OrigImage;
    }
  });

  it('builds text by clicking the decode palette (pigpen decode)', async () => {
    loadBody('cipher.html');
    await import('../src/cipher/cipher-ui.js');
    document.getElementById('cipher-format').value = 'pigpen';
    document.getElementById('cipher-format').dispatchEvent(new window.Event('change'));
    const dir = document.getElementById('cipher-dir');
    dir.value = 'decode';
    dir.dispatchEvent(new window.Event('change'));

    const btnFor = (label) => [...document.querySelectorAll('#cipher-palette button')]
      .find((b) => b.getAttribute('aria-label') === label);
    expect(btnFor('Letter H')).toBeTruthy();
    btnFor('Letter H').dispatchEvent(new window.Event('click'));
    btnFor('Letter I').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('cipher-out').textContent).toBe('HI');
  });

  it('clears the decode buffer when the mode changes', async () => {
    loadBody('cipher.html');
    await import('../src/cipher/cipher-ui.js');
    document.getElementById('cipher-format').value = 'pigpen';
    document.getElementById('cipher-format').dispatchEvent(new window.Event('change'));
    const dir = document.getElementById('cipher-dir');
    dir.value = 'decode';
    dir.dispatchEvent(new window.Event('change'));
    [...document.querySelectorAll('#cipher-palette button')]
      .find((b) => b.getAttribute('aria-label') === 'Letter H')
      .dispatchEvent(new window.Event('click'));
    expect(document.getElementById('cipher-out').textContent).toBe('H');

    // switching format discards the buffer
    const format = document.getElementById('cipher-format');
    format.value = 'semaphore';
    format.dispatchEvent(new window.Event('change'));
    expect(document.getElementById('cipher-out').textContent).toBe('');
  });
});

describe('cipher export SVG', () => {
  it('builds a self-contained, taint-free export SVG (hardcoded colors, no external refs)', () => {
    const svg = exportStripSvg('pigpen', ['A', 'B', '', 'C']);
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(0);
    expect(Number(svg.getAttribute('height'))).toBeGreaterThan(0);
    const xml = new XMLSerializer().serializeToString(svg);
    expect(xml).toContain('#ffffff');           // white background rect
    expect(xml).toContain('#15171c');           // hardcoded dark ink
    expect(xml).not.toContain('currentColor');  // must not depend on inherited color
    for (const bad of ['href', 'xlink', '<image', '<use', '@import', 'url(']) {
      expect(xml).not.toContain(bad);           // any external ref would taint the canvas
    }
    expect((xml.match(/<g[ >]/g) || []).length).toBe(3); // 3 letters; the '' word break adds no group
  });

  it('keeps the semaphore export path taint-free too (hardcoded ink, no external refs)', () => {
    const svg = exportStripSvg('semaphore', ['D', 'I']);
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(0);
    const xml = new XMLSerializer().serializeToString(svg);
    expect(xml).toContain('#15171c');
    expect(xml).not.toContain('currentColor');
    for (const bad of ['href', 'xlink', '<image', '<use', '@import', 'url(']) {
      expect(xml).not.toContain(bad);
    }
  });
});

describe('qr reader UI (non-canvas wiring)', () => {
  // The decode pipeline needs a real canvas (hand-verified in a browser per the
  // spec); here we only exercise the tab switching and module wiring, which is
  // pure DOM and would break loudly if an element id were wrong.
  it('starts on Create and switches to Read on click', async () => {
    loadBody('qr.html');
    await import('../src/qr/qr-read-ui.js');

    const tabCreate = document.getElementById('tab-create');
    const tabRead = document.getElementById('tab-read');
    const panelCreate = document.getElementById('panel-create');
    const panelRead = document.getElementById('panel-read');

    expect(tabCreate.getAttribute('aria-selected')).toBe('true');
    expect(panelRead.hidden).toBe(true);

    // Non-bubbling, matching the other smoke tests: the handler is on the button
    // itself, and bubbling to document would trip an unrelated listener leaked by
    // an earlier suite into the shared jsdom document.
    tabRead.dispatchEvent(new window.Event('click'));

    expect(tabRead.getAttribute('aria-selected')).toBe('true');
    expect(tabCreate.getAttribute('aria-selected')).toBe('false');
    expect(panelRead.hidden).toBe(false);
    expect(panelCreate.hidden).toBe(true);
  });

  it('shows an error and no results for an oversized file (no canvas needed)', async () => {
    loadBody('qr.html');
    await import('../src/qr/qr-read-ui.js');

    const dropzone = document.getElementById('read-dropzone');
    const big = new window.File([new Uint8Array(1)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });

    const dt = { files: [big] };
    const drop = new window.Event('drop');
    Object.defineProperty(drop, 'dataTransfer', { value: dt });
    dropzone.dispatchEvent(drop);

    const err = document.getElementById('read-error');
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toMatch(/25 MB limit/);
    expect(document.getElementById('read-results').children.length).toBe(0);
  });
});

describe('barcode UI (canvas draw guarded in jsdom)', () => {
  it('renders a Code 128 result for the default input on load', async () => {
    loadBody('barcode.html');
    await import('../src/barcode/barcode-ui.js');
    expect(document.getElementById('result').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('encoded').textContent).toMatch(/Code 128/);
    expect(document.getElementById('barcode-error').classList.contains('hidden')).toBe(true);
  });

  it('shows the computed check digit for a 12-digit EAN-13 input', async () => {
    loadBody('barcode.html');
    await import('../src/barcode/barcode-ui.js');
    document.getElementById('symbology').value = 'ean13';
    document.getElementById('symbology').dispatchEvent(new window.Event('change'));
    const data = document.getElementById('data');
    data.value = '590123412345';
    data.dispatchEvent(new window.Event('input'));
    const status = document.getElementById('barcode-status');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toMatch(/Check digit: 7/);
    expect(document.getElementById('encoded').textContent).toContain('5901234123457');
  });

  it('flags a mismatched supplied check digit but still renders', async () => {
    loadBody('barcode.html');
    await import('../src/barcode/barcode-ui.js');
    document.getElementById('symbology').value = 'ean13';
    document.getElementById('symbology').dispatchEvent(new window.Event('change'));
    const data = document.getElementById('data');
    data.value = '5901234123450'; // wrong check digit (should be 7)
    data.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('barcode-status').textContent).toMatch(/doesn't match/);
    expect(document.getElementById('result').classList.contains('hidden')).toBe(false);
  });

  it('shows an inline error for invalid EAN-13 input', async () => {
    loadBody('barcode.html');
    await import('../src/barcode/barcode-ui.js');
    document.getElementById('symbology').value = 'ean13';
    document.getElementById('symbology').dispatchEvent(new window.Event('change'));
    const data = document.getElementById('data');
    data.value = '12345';
    data.dispatchEvent(new window.Event('input'));
    const err = document.getElementById('barcode-error');
    expect(err.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('result').classList.contains('hidden')).toBe(true);
  });
});

describe('index tool search', () => {
  it('filters tiles case-insensitively, shows an empty state, and restores on clear', async () => {
    loadBody('index.html');
    await import('../src/shared/index-search.js');
    const input = document.getElementById('tool-search');
    const cards = [...document.querySelectorAll('.tool-card')];
    expect(cards.length).toBeGreaterThan(0);

    input.value = 'CHECKSUM';
    input.dispatchEvent(new window.Event('input'));
    const visible = cards.filter((c) => !c.classList.contains('hidden'));
    expect(visible.length).toBeGreaterThanOrEqual(1);
    expect(visible.every((c) => c.textContent.toLowerCase().includes('checksum'))).toBe(true);

    input.value = 'zzzz-no-such-tool';
    input.dispatchEvent(new window.Event('input'));
    expect(cards.every((c) => c.classList.contains('hidden'))).toBe(true);
    expect(document.getElementById('no-tools').classList.contains('hidden')).toBe(false);

    input.value = '';
    input.dispatchEvent(new window.Event('input'));
    expect(cards.every((c) => !c.classList.contains('hidden'))).toBe(true);
    expect(document.getElementById('no-tools').classList.contains('hidden')).toBe(true);
  });

  it('Escape clears an active filter', async () => {
    loadBody('index.html');
    await import('../src/shared/index-search.js');
    const input = document.getElementById('tool-search');
    input.value = 'qr';
    input.dispatchEvent(new window.Event('input'));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(input.value).toBe('');
    expect([...document.querySelectorAll('.tool-card')].every((c) => !c.classList.contains('hidden'))).toBe(true);
  });
});

describe('morse mic UI (no mediaDevices in jsdom)', () => {
  it('module loads and Start shows a support error instead of throwing', async () => {
    loadBody('morse.html');
    await import('../src/morse/mic-ui.js');
    expect(document.getElementById('mic-stop').disabled).toBe(true);
    document.getElementById('mic-start').dispatchEvent(new window.Event('click'));
    await new Promise((r) => setTimeout(r, 0));
    const err = document.getElementById('mic-error');
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toMatch(/not supported/i);
  });
});

describe('exif multi-file ordering', () => {
  it('renders results in selection order even when reads finish out of order', async () => {
    loadBody('exif.html');
    await import('../src/exif/exif-ui.js');
    const readers = [];
    const OrigFR = global.FileReader;
    global.FileReader = class {
      readAsArrayBuffer() { readers.push(this); }
    };
    try {
      const webp = new window.File([new Uint8Array(1)], 'first.webp', { type: 'image/webp' });
      const gif = new window.File([new Uint8Array(1)], 'second.gif', { type: 'image/gif' });
      const input = document.getElementById('file');
      Object.defineProperty(input, 'files', { value: [webp, gif], configurable: true });
      input.dispatchEvent(new window.Event('change'));
      expect(readers.length).toBe(2);
      // Finish the SECOND file's read first (the race the slots fix).
      readers[1].result = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).buffer; // GIF89a
      readers[1].onload();
      readers[0].result = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, // RIFF….WEBP
      ]).buffer;
      readers[0].onload();
      const cards = [...document.querySelectorAll('#results .file-item')];
      expect(cards.length).toBe(2);
      expect(cards[0].textContent).toContain('first.webp');
      expect(cards[1].textContent).toContain('second.gif');
    } finally {
      global.FileReader = OrigFR;
    }
  });
});

describe('barcode reader UI (non-canvas wiring)', () => {
  it('starts on Create and switches to Read on click', async () => {
    loadBody('barcode.html');
    await import('../src/barcode/read-ui.js');
    expect(document.getElementById('tab-create').getAttribute('aria-selected')).toBe('true');
    document.getElementById('tab-read').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('panel-read').hidden).toBe(false);
    expect(document.getElementById('panel-create').hidden).toBe(true);
  });

  it('shows an error and no results for an oversized file (no canvas needed)', async () => {
    loadBody('barcode.html');
    await import('../src/barcode/read-ui.js');
    const big = new window.File([new Uint8Array(1)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    const drop = new window.Event('drop');
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [big] } });
    document.getElementById('read-dropzone').dispatchEvent(drop);
    const err = document.getElementById('read-error');
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toMatch(/25 MB limit/);
    expect(document.getElementById('read-results').children.length).toBe(0);
  });

  it('Recreate fills the generator form with validated data and switches tabs', async () => {
    loadBody('barcode.html');
    await import('../src/barcode/barcode-ui.js');
    const mod = await import('../src/barcode/read-ui.js');
    document.getElementById('tab-read').dispatchEvent(new window.Event('click'));
    mod.showResult({ format: 'ean13', text: '5901234123457', full: '5901234123457', firstDigit: 5, checkDigit: 7, reversed: false });
    expect(document.getElementById('read-results').textContent).toContain('EAN-13 detected');
    const btn = [...document.querySelectorAll('#read-results button')]
      .find((b) => b.textContent.includes('Recreate'));
    expect(btn.disabled).toBe(false);
    btn.dispatchEvent(new window.Event('click'));
    expect(document.getElementById('symbology').value).toBe('ean13');
    expect(document.getElementById('data').value).toBe('5901234123457');
    expect(document.getElementById('panel-create').hidden).toBe(false);
    // The generator re-ran and validated the supplied check digit.
    expect(document.getElementById('barcode-status').textContent).toMatch(/Check digit: 7/);
  });

  it('disables Recreate for decoded data the generator cannot encode', async () => {
    loadBody('barcode.html');
    const mod = await import('../src/barcode/read-ui.js');
    mod.showResult({ format: 'code128', text: 'has\u0007control', codeSets: ['A'], checkSymbol: 12, reversed: false });
    const btn = [...document.querySelectorAll('#read-results button')]
      .find((b) => b.textContent.includes('Recreate'));
    expect(btn.disabled).toBe(true);
    expect(document.getElementById('read-results').textContent).toMatch(/cannot encode/);
  });
});

describe('code-review carry-over regressions', () => {
  it('Enter on the master field does not bypass a disabled Unlock button', async () => {
    loadBody('vault.html');
    await import('../src/vault/vault-ui.js');
    const master = document.getElementById('unlock-master');
    const btn = document.getElementById('unlock-confirm');
    const err = document.getElementById('unlock-error');
    // Disabled (an unlock is already in flight): Enter must be a no-op.
    btn.disabled = true;
    master.value = '';
    master.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    expect(err.classList.contains('hidden')).toBe(true);
    // Enabled: Enter still reaches doUnlock (empty password -> visible error).
    btn.disabled = false;
    master.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toMatch(/master password/i);
  });

  it('defers revoking a download blob URL instead of revoking synchronously', async () => {
    vi.useFakeTimers();
    const revoked = [];
    const origCreate = global.URL.createObjectURL;
    const origRevoke = global.URL.revokeObjectURL;
    const origClick = window.HTMLAnchorElement.prototype.click;
    global.URL.createObjectURL = () => 'blob:fake';
    global.URL.revokeObjectURL = (u) => revoked.push(u);
    window.HTMLAnchorElement.prototype.click = () => {};
    try {
      loadBody('csv.html');
      await import('../src/csv/csv-ui.js');
      document.getElementById('csv-in').value = 'a,b\n1,2';
      document.getElementById('parse').dispatchEvent(new window.Event('click'));
      document.getElementById('dl-csv').dispatchEvent(new window.Event('click'));
      expect(revoked.length).toBe(0); // a sync revoke can cancel the download
      vi.advanceTimersByTime(1100);
      expect(revoked).toEqual(['blob:fake']);
    } finally {
      global.URL.createObjectURL = origCreate;
      global.URL.revokeObjectURL = origRevoke;
      window.HTMLAnchorElement.prototype.click = origClick;
      vi.useRealTimers();
    }
  });

  it('labels the hash digest with the algorithm that computed it after a mid-compute switch', async () => {
    loadBody('hash.html');
    await import('../src/hash/hash-ui.js');
    const text = document.getElementById('hash-text');
    const algo = document.getElementById('hash-algo');
    const out = document.getElementById('hash-out');
    text.value = 'abc';
    text.dispatchEvent(new window.Event('input'));   // starts a SHA-256 digest
    algo.value = 'SHA-512';
    algo.dispatchEvent(new window.Event('change'));  // supersedes it mid-flight
    for (let i = 0; i < 200 && !out.textContent; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 50)); // give any stale write a chance to (wrongly) land
    expect(document.getElementById('hash-source').textContent).toContain('SHA-512');
    // SHA-512("abc") — the digest must match its label, not the superseded algorithm.
    expect(out.textContent).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
      '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
  });
});

describe('morse tap keyer UI', () => {
  it('a pad tap commits a dot and the decoder shows E', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      loadBody('morse.html');
      await import('../src/morse/morse-ui.js');
      await import('../src/morse/tap-ui.js');
      const pad = document.getElementById('tap-pad');
      pad.dispatchEvent(new window.Event('pointerdown'));
      vi.advanceTimersByTime(80);                    // short press = dot
      pad.dispatchEvent(new window.Event('pointerup'));
      vi.advanceTimersByTime(2000);                  // letter-gap flush timer
      expect(document.getElementById('morse-in').value.trim()).toBe('.');
      expect(document.getElementById('morse-out').textContent).toBe('E');
      expect(document.getElementById('morse-dir').value).toBe('decode');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clicking Change key again cancels an armed rebind, and Esc still cancels', async () => {
    loadBody('morse.html');
    await import('../src/morse/morse-ui.js');
    await import('../src/morse/tap-ui.js');
    const keyBtn = document.getElementById('tap-key-change');
    keyBtn.dispatchEvent(new window.Event('click'));
    expect(keyBtn.textContent).toMatch(/cancels/i);
    keyBtn.dispatchEvent(new window.Event('click')); // visible cancel affordance
    expect(keyBtn.textContent).toMatch(/now: Space/);
    keyBtn.dispatchEvent(new window.Event('click'));
    document.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape' }));
    expect(keyBtn.textContent).toMatch(/now: Space/); // Esc canceled without rebinding
  });

  it('undo removes the last committed token', async () => {
    loadBody('morse.html');
    await import('../src/morse/morse-ui.js');
    await import('../src/morse/tap-ui.js');
    const inEl = document.getElementById('morse-in');
    inEl.value = '... --- ';
    document.getElementById('tap-undo').dispatchEvent(new window.Event('click'));
    expect(inEl.value).toBe('... ');
  });

  it('Enter on the focused pad keys a dot (keyboard activation)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      loadBody('morse.html');
      await import('../src/morse/morse-ui.js');
      await import('../src/morse/tap-ui.js');
      const pad = document.getElementById('tap-pad');
      pad.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Enter' }));
      vi.advanceTimersByTime(80);                    // short press = dot
      pad.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Enter' }));
      vi.advanceTimersByTime(2000);                  // letter-gap flush timer
      expect(document.getElementById('morse-in').value.trim()).toBe('.');
      expect(document.getElementById('morse-out').textContent).toBe('E');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('diff UI', () => {
  it('compares two texts and reports changed lines', async () => {
    loadBody('diff.html');
    await import('../src/diff/diff-ui.js');
    document.getElementById('diff-a').value = 'alpha\nbeta\ngamma';
    document.getElementById('diff-b').value = 'alpha\nbeta changed\ngamma';
    document.getElementById('diff-run').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('diff-msg').textContent).toMatch(/2 changed line/);
    const out = document.getElementById('diff-out');
    expect(out.classList.contains('hidden')).toBe(false);
    expect(out.querySelectorAll('.diff-line.del').length).toBe(1);
    expect(out.querySelectorAll('.diff-line.add').length).toBe(1);
    expect(out.querySelectorAll('mark.diff-word').length).toBeGreaterThan(0);
  });

  it('side-by-side view renders a two-column grid', async () => {
    loadBody('diff.html');
    await import('../src/diff/diff-ui.js');
    document.getElementById('diff-a').value = 'one\ntwo';
    document.getElementById('diff-b').value = 'one\nthree';
    document.getElementById('diff-view').value = 'side';
    document.getElementById('diff-run').dispatchEvent(new window.Event('click'));
    expect(document.querySelector('#diff-out .diff-grid')).not.toBeNull();
  });

  it('identical texts and empty input each get an honest message', async () => {
    loadBody('diff.html');
    await import('../src/diff/diff-ui.js');
    document.getElementById('diff-run').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('diff-msg').textContent).toMatch(/Nothing to compare/);
    document.getElementById('diff-a').value = 'same';
    document.getElementById('diff-b').value = 'same';
    document.getElementById('diff-run').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('diff-msg').textContent).toMatch(/identical/);
  });
});

describe('regex UI', () => {
  // Evaluation is debounced (200 ms) so half-typed patterns never run.
  const settle = () => new Promise((r) => setTimeout(r, 250));

  it('highlights matches and lists groups live', async () => {
    loadBody('regex.html');
    await import('../src/regex/regex-ui.js');
    document.getElementById('re-pattern').value = '(\\w+)@(\\w+)';
    document.getElementById('re-text').value = 'mail me at someone@example please';
    document.getElementById('re-text').dispatchEvent(new window.Event('input'));
    await settle();
    expect(document.getElementById('re-summary').textContent).toMatch(/1 match\./);
    expect(document.querySelectorAll('#re-highlight mark.re-match').length).toBe(1);
    const dts = [...document.querySelectorAll('#re-matches dt')].map((d) => d.textContent);
    expect(dts).toContain('Group 1');
    expect(dts).toContain('Group 2');
  });

  it('shows an inline error for a bad pattern and recovers', async () => {
    loadBody('regex.html');
    await import('../src/regex/regex-ui.js');
    const pattern = document.getElementById('re-pattern');
    pattern.value = '(unclosed';
    document.getElementById('re-text').value = 'abc';
    pattern.dispatchEvent(new window.Event('input'));
    await settle();
    const err = document.getElementById('re-error');
    expect(err.classList.contains('hidden')).toBe(false);
    pattern.value = 'abc';
    pattern.dispatchEvent(new window.Event('input'));
    await settle();
    expect(err.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('re-summary').textContent).toMatch(/1 match\./);
  });

  it('rejects invalid flags with a message', async () => {
    loadBody('regex.html');
    await import('../src/regex/regex-ui.js');
    document.getElementById('re-pattern').value = 'a';
    document.getElementById('re-text').value = 'aaa';
    const flags = document.getElementById('re-flags');
    flags.value = 'gz';
    flags.dispatchEvent(new window.Event('input'));
    await settle();
    expect(document.getElementById('re-error').classList.contains('hidden')).toBe(false);
  });
});

describe('timestamp & UUID UI', () => {
  it('converts an epoch in seconds and shows all three formats', async () => {
    loadBody('timestamp.html');
    await import('../src/timestamp/timestamp-ui.js');
    const input = document.getElementById('ts-epoch');
    input.value = '0';
    input.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('ts-unit').textContent).toBe('Seconds');
    expect(document.getElementById('ts-iso').textContent).toBe('1970-01-01T00:00:00.000Z');
    expect(document.getElementById('ts-out').classList.contains('hidden')).toBe(false);
  });

  it('shows an inline error for a non-numeric timestamp', async () => {
    loadBody('timestamp.html');
    await import('../src/timestamp/timestamp-ui.js');
    const input = document.getElementById('ts-epoch');
    input.value = 'yesterday';
    input.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('ts-error').classList.contains('hidden')).toBe(false);
  });

  it('Now button fills the field and renders a result', async () => {
    loadBody('timestamp.html');
    await import('../src/timestamp/timestamp-ui.js');
    document.getElementById('ts-now').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('ts-epoch').value).toMatch(/^\d+$/);
    expect(document.getElementById('ts-out').classList.contains('hidden')).toBe(false);
  });

  it('generates a v4 UUID and inspects it', async () => {
    loadBody('timestamp.html');
    await import('../src/timestamp/timestamp-ui.js');
    document.getElementById('uuid-gen').dispatchEvent(new window.Event('click'));
    const uuid = document.getElementById('uuid-out').textContent;
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const inspect = document.getElementById('uuid-in');
    inspect.value = uuid;
    inspect.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('uuid-version').textContent).toBe('4');
    expect(document.getElementById('uuid-variant').textContent).toBe('RFC 4122');
    expect(document.getElementById('uuid-time').textContent).toMatch(/Not applicable/);
  });

  it('rejects a malformed UUID with an inline error', async () => {
    loadBody('timestamp.html');
    await import('../src/timestamp/timestamp-ui.js');
    const inspect = document.getElementById('uuid-in');
    inspect.value = 'not-a-uuid';
    inspect.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('uuid-error').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('uuid-info').classList.contains('hidden')).toBe(true);
  });
});

describe('contrast UI', () => {
  it('renders the default pair with a ratio and badges on load', async () => {
    loadBody('contrast.html');
    await import('../src/contrast/contrast-ui.js');
    expect(document.getElementById('ct-ratio').textContent).toMatch(/^\d+\.\d{2}:1$/);
    expect(document.getElementById('ct-aa-normal').textContent).toBe('Pass');
  });

  it('typing a valid hex updates ratio, badges, and the linked picker', async () => {
    loadBody('contrast.html');
    await import('../src/contrast/contrast-ui.js');
    const fg = document.getElementById('ct-fg-hex');
    fg.value = '#777777';
    fg.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('ct-ratio').textContent).toBe('4.47:1'); // floored, never overstated
    expect(document.getElementById('ct-aa-normal').textContent).toBe('Fail');
    expect(document.getElementById('ct-aa-large').textContent).toBe('Pass');
    expect(document.getElementById('ct-fg-pick').value).toBe('#777777');
  });

  it('invalid hex shows an error and keeps the last valid ratio', async () => {
    loadBody('contrast.html');
    await import('../src/contrast/contrast-ui.js');
    const before = document.getElementById('ct-ratio').textContent;
    const fg = document.getElementById('ct-fg-hex');
    fg.value = '#zzz';
    fg.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('ct-error').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('ct-ratio').textContent).toBe(before);
  });
});
