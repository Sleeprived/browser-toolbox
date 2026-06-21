// @vitest-environment jsdom
// Regression tests for the vault's lock-time DOM scrub. Loading the page body
// (as ui-smoke does) and importing the UI module wires the real handlers, so we
// can drive lock / pagehide / pageshow and assert that no decrypted secrets
// (history passwords, live TOTP code, rendered entry list) linger in the DOM.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadBody(htmlFile) {
  const html = readFileSync(path.join(root, htmlFile), 'utf8');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  document.documentElement.innerHTML = `<head></head><body>${body}</body>`;
}

beforeEach(() => {
  vi.resetModules();
});

describe('vault lock DOM scrub', () => {
  it('clearing the editor blanks the history list, count, and live TOTP code', async () => {
    loadBody('vault.html');
    await import('../src/vault/vault-ui.js');

    // Simulate a decrypted editor: a prior plaintext password in history and a
    // live OTP rendered into the TOTP nodes.
    const li = document.createElement('li');
    li.textContent = 'hunter2 — changed yesterday';
    document.getElementById('history-list').appendChild(li);
    document.getElementById('history-count').textContent = '1';
    document.getElementById('history').classList.remove('hidden');
    document.getElementById('totp-code').textContent = '123 456';
    document.getElementById('totp-countdown').textContent = '12s';

    // Lock via the wired toolbar button (lock() is not exported).
    document.getElementById('lock-vault').dispatchEvent(new window.Event('click'));

    expect(document.getElementById('history-list').textContent).toBe('');
    expect(document.getElementById('history-list').children.length).toBe(0);
    expect(document.getElementById('history-count').textContent).toBe('0');
    expect(document.getElementById('history').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('totp-code').textContent).toBe('');
    expect(document.getElementById('totp-countdown').textContent).toBe('');
  });

  it('pagehide locks: scrubs the entry list, editor, master inputs, and shows the locked screen', async () => {
    loadBody('vault.html');
    const mod = await import('../src/vault/vault-ui.js');

    // Simulate a decrypted, unlocked state with rendered DOM.
    mod.state.unlocked = true;
    const row = document.createElement('li');
    row.textContent = 'secret entry';
    document.getElementById('entry-list').appendChild(row);
    document.getElementById('unlock-master').value = 'master-pw';
    document.getElementById('f-password').value = 'entry-pw';

    window.dispatchEvent(new window.Event('pagehide'));

    expect(document.getElementById('entry-list').textContent).toBe('');
    expect(document.getElementById('unlock-master').value).toBe('');
    expect(document.getElementById('f-password').value).toBe('');
    expect(mod.state.unlocked).toBe(false);
    expect(document.getElementById('vault-locked').classList.contains('hidden')).toBe(false);
  });

  it('pageshow from bfcache while locked re-locks (scrubs leftover decrypted DOM)', async () => {
    loadBody('vault.html');
    const mod = await import('../src/vault/vault-ui.js');

    // Logically locked, but a stale decrypted row survived the restore.
    mod.state.unlocked = false;
    const row = document.createElement('li');
    row.textContent = 'stale secret';
    document.getElementById('entry-list').appendChild(row);
    document.getElementById('f-password').value = 'stale-pw';

    const ev = new window.Event('pageshow');
    Object.defineProperty(ev, 'persisted', { value: true });
    window.dispatchEvent(ev);

    expect(document.getElementById('f-password').value).toBe('');
    expect(document.getElementById('vault-locked').classList.contains('hidden')).toBe(false);
  });
});
