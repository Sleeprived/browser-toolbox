// @vitest-environment jsdom
// Runtime smoke tests: load each non-canvas tool page's DOM and execute its UI
// module, then drive a basic interaction. Catches wiring errors (missing
// elements, bad handlers) that static checks miss. Canvas/FileReader tools
// (QR, EXIF, palette) are verified by hand in a real browser per the spec.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
