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
    ['morse.html', ['id="morse-error"', 'role="alert"'], ['id="morse-out"', 'aria-live="polite"']],
  ];
  for (const [file, ...pairs] of cases) {
    it(`${file} has announced regions`, () => {
      const html = read(file);
      for (const pair of pairs) {
        // each listed token must appear somewhere in the file
        for (const token of pair) expect(html).toContain(token);
      }
    });
  }

  it('every page has a skip link', () => {
    for (const f of ['index.html', 'qr.html', 'exif.html', 'passphrase.html', 'csv.html', 'palette.html', 'cron.html', 'vault.html', 'morse.html']) {
      expect(read(f)).toContain('class="skip-link"');
    }
  });
});
