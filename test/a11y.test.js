import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(root, f), 'utf8');

describe('accessibility: dynamic regions are announced', () => {
  const cases = [
    ['cron.html', ['id="error"', 'role="alert"'], ['id="description"', 'aria-live="polite"']],
    ['csv.html', ['id="error"', 'role="alert"']],
    ['qr.html', ['id="error"', 'role="alert"']],
    ['exif.html', ['id="results"', 'aria-live="polite"']],
    ['palette.html', ['id="error"', 'role="alert"']],
    ['vault.html', ['id="unlock-error"', 'role="alert"'], ['id="save-msg"', 'aria-live="polite"']],
    // morse-out is an editable textarea now (aria-live is ineffective on
    // field value changes), so it is no longer in this list.
    ['morse.html', ['id="morse-error"', 'role="alert"'], ['id="tap-morse"', 'aria-live="polite"'], ['id="tap-out"', 'aria-live="polite"']],
    ['encode.html', ['id="enc-error"', 'role="alert"'], ['id="enc-out"', 'aria-live="polite"']],
    ['jwt.html', ['id="jwt-error"', 'role="alert"'], ['id="jwt-payload"', 'aria-live="polite"']],
    ['image.html', ['id="image-error"', 'role="alert"'], ['id="img-stats"', 'aria-live="polite"']],
    ['cipher.html', ['id="cipher-error"', 'role="alert"'], ['id="cipher-out"', 'aria-live="polite"'], ['id="cipher-skipped"', 'aria-live="polite"'], ['id="cipher-status"', 'aria-live="polite"']],
    ['barcode.html', ['id="barcode-error"', 'role="alert"'], ['id="barcode-status"', 'aria-live="polite"'], ['id="encoded"', 'aria-live="polite"']],
  ];
  // The id and its role/aria-live must sit on the SAME element (no '>' between them),
  // not merely both appear somewhere in the file — otherwise the region is identified
  // but never actually announced to a screen reader.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [file, ...pairs] of cases) {
    it(`${file} has announced regions (id + role co-located)`, () => {
      const html = read(file);
      for (const [idTok, roleTok] of pairs) {
        const re = new RegExp(`${esc(idTok)}[^>]*${esc(roleTok)}|${esc(roleTok)}[^>]*${esc(idTok)}`);
        expect(html).toMatch(re);
      }
    });
  }

  it('every page has a skip link', () => {
    for (const f of ['index.html', 'qr.html', 'exif.html', 'passphrase.html', 'csv.html', 'palette.html', 'cron.html', 'vault.html', 'morse.html', 'encode.html', 'jwt.html', 'image.html', 'cipher.html', 'barcode.html']) {
      expect(read(f)).toContain('class="skip-link"');
    }
  });
});
