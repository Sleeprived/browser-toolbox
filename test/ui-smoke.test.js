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
  document.documentElement.removeAttribute('data-theme');
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
