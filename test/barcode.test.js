import { describe, it, expect } from 'vitest';
import {
  encodeToValues, valuesToModules, encodeCode128, BarcodeError,
} from '../src/barcode/code128.js';
import {
  ean13CheckDigit, upcaCheckDigit, normalize, encodeEan13Modules, encodeEan,
} from '../src/barcode/ean.js';
import { barRuns, totalModules, renderSvg } from '../src/barcode/render.js';

describe('Code 128 encoder', () => {
  it('encodes "Wikipedia" in subset B with the documented check symbol 88', () => {
    // Classic worked example: Start-B, 9 chars, mod-103 check = 88, Stop.
    expect(encodeToValues('Wikipedia')).toEqual(
      [104, 55, 73, 75, 73, 80, 69, 68, 73, 65, 88, 106],
    );
  });

  it('starts in subset C for an even all-digit string and pairs the digits', () => {
    expect(encodeToValues('123456')).toEqual([105, 12, 34, 56, 44, 106]);
  });

  it('switches B→C→B across a mixed alpha+digit string (odd cases aside)', () => {
    // A | switch-C | 12 34 | switch-B | B | check 78 | stop
    expect(encodeToValues('A1234B')).toEqual([104, 33, 99, 12, 34, 100, 34, 78, 106]);
  });

  it('keeps a lone trailing digit in subset B (no wasteful switch to C)', () => {
    // "A1": a single trailing digit can't fill a Code C pair, so it stays in B
    // (value 49-32 = 17) with no switch symbol (99).
    const values = encodeToValues('A1');
    expect(values).not.toContain(99);
    expect(values).toEqual([104, 33, 17, 68, 106]); // Start-B, A, 1, check 68, Stop
  });

  it('packs an even digit pair into Code C while a preceding odd digit stays in B', () => {
    // "A123": leading "1" stays in B, the trailing even pair "23" switches to C.
    const values = encodeToValues('A123');
    expect(values.slice(0, 4)).toEqual([104, 33, 17, 99]); // Start-B, A, 1, switch→C
    expect(values).toContain(23); // the "23" pair encoded in Code C
  });

  it('rejects characters outside printable ASCII', () => {
    expect(() => encodeToValues('café')).toThrow(BarcodeError);
    expect(() => encodeToValues('tab\there')).toThrow(BarcodeError);
  });

  it('expands to modules that begin with a dark bar and have the right length', () => {
    const modules = valuesToModules([105, 12, 34, 56, 44, 106]);
    expect(modules[0]).toBe(true);
    // 5 symbols × 11 modules + Stop's 13 modules = 68.
    expect(modules.length).toBe(68);
    expect(modules[modules.length - 1]).toBe(true); // Stop ends on a bar
  });

  it('encodeCode128 returns values, modules and the original text', () => {
    const r = encodeCode128('ABC');
    expect(r.text).toBe('ABC');
    expect(r.values[0]).toBe(104);
    expect(Array.isArray(r.modules)).toBe(true);
  });
});

describe('EAN-13 / UPC-A check digits', () => {
  it('computes the EAN-13 check digit (5901234123457 → 7)', () => {
    expect(ean13CheckDigit('590123412345')).toBe(7);
  });
  it('computes the UPC-A check digit (036000291452 → 2)', () => {
    expect(upcaCheckDigit('03600029145')).toBe(2);
  });
});

describe('normalize', () => {
  it('appends the check digit when given the 12-digit EAN-13 body', () => {
    expect(normalize('ean13', '590123412345')).toEqual(
      { full: '5901234123457', checkDigit: 7, supplied: false, mismatch: false },
    );
  });
  it('validates a supplied EAN-13 check digit and flags a mismatch', () => {
    expect(normalize('ean13', '5901234123457').mismatch).toBe(false);
    expect(normalize('ean13', '5901234123450').mismatch).toBe(true);
  });
  it('handles UPC-A 11 and 12 digit input', () => {
    expect(normalize('upca', '03600029145').full).toBe('036000291452');
    expect(normalize('upca', '036000291452').supplied).toBe(true);
  });
  it('tolerates spaces in the input', () => {
    expect(normalize('ean13', '590 1234 12345').full).toBe('5901234123457');
  });
  it('rejects non-digits and wrong lengths', () => {
    expect(() => normalize('ean13', '59012a412345')).toThrow(BarcodeError);
    expect(() => normalize('ean13', '12345')).toThrow(BarcodeError);
    expect(() => normalize('upca', '123456789012345')).toThrow(BarcodeError);
  });
});

describe('EAN-13 module layout', () => {
  it('produces 95 modules with correct guard and centre patterns', () => {
    const m = encodeEan13Modules('5901234123457');
    expect(m.length).toBe(95);
    expect(m.slice(0, 3)).toEqual([true, false, true]);       // start guard 101
    expect(m.slice(45, 50)).toEqual([false, true, false, true, false]); // centre 01010
    expect(m.slice(92, 95)).toEqual([true, false, true]);     // end guard 101
  });
  it('reproduces the canonical bit pattern for 5901234123457 (pins the L/G/R tables)', () => {
    // Independent oracle: per-digit codes transcribed straight from the EAN-13
    // standard for this specific number (first digit 5 → parity L G G L L G on the
    // left group, all-R on the right). A typo in any table entry breaks this.
    const expected = [
      '101',                                              // start guard
      '0001011', '0100111', '0110011', '0010011', '0111101', '0011101', // 9 0 1 2 3 4
      '01010',                                            // centre guard
      '1100110', '1101100', '1000010', '1011100', '1001110', '1000100', // 1 2 3 4 5 7
      '101',                                              // end guard
    ].join('');
    const bits = encodeEan13Modules('5901234123457').map((b) => (b ? '1' : '0')).join('');
    expect(bits).toBe(expected);
  });

  it('encodeEan maps UPC-A onto a 95-module EAN with a leading zero, keeping 12-digit text', () => {
    const r = encodeEan('upca', '03600029145');
    expect(r.modules.length).toBe(95);
    expect(r.text).toBe('036000291452');
    expect(r.checkDigit).toBe(2);
  });
});

describe('render geometry & SVG', () => {
  it('merges consecutive dark modules into runs offset by the quiet zone', () => {
    expect(barRuns([true, true, false, true], 0)).toEqual(
      [{ x: 0, width: 2 }, { x: 3, width: 1 }],
    );
    expect(barRuns([true], 5)).toEqual([{ x: 5, width: 1 }]);
  });

  it('totalModules adds both quiet zones', () => {
    expect(totalModules(95, 10)).toBe(115);
  });

  it('renders an SVG sized to the modules and includes the human-readable text', () => {
    const modules = encodeEan13Modules('5901234123457');
    const svg = renderSvg(modules, {
      moduleWidth: 2, barHeight: 100, quiet: 10, showText: true, text: '5901234123457',
      fg: '#000000', bg: '#ffffff',
    });
    expect(svg).toContain(`width="${(95 + 20) * 2}"`); // (modules + 2·quiet) × moduleWidth
    expect(svg).toContain('<text');
    expect(svg).toContain('5901234123457');
    // one <rect> per merged dark run, plus the background rect.
    const runCount = barRuns(modules, 10).length;
    expect((svg.match(/<rect /g) || []).length).toBe(runCount + 1);
  });

  it('omits the text element when human-readable text is off', () => {
    const svg = renderSvg([true, false, true], { showText: false, text: 'x' });
    expect(svg).not.toContain('<text');
  });

  it('defangs a malformed color instead of injecting it into the SVG', () => {
    const svg = renderSvg([true], { fg: '"/><script>', bg: '#ffffff' });
    expect(svg).not.toContain('<script');
    expect(svg).toContain('#000000'); // fell back to the safe default
  });
});
