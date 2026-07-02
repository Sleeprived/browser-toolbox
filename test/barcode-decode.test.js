import { describe, it, expect } from 'vitest';
import { encodeCode128, encodeToValues, valuesToModules } from '../src/barcode/code128.js';
import { encodeEan, encodeEan13Modules } from '../src/barcode/ean.js';
import {
  decodeRuns,
  decodeCode128Runs,
  decodeEanRuns,
  rowLuminance,
  binarizeRow,
  rowToRuns,
  decodeImageData,
} from '../src/barcode/decode.js';

// ---------------------------------------------------------------------------
// Helpers: synthesize decoder input straight from the generator's own output,
// so every test is a true generator → decoder round-trip (no canvas needed).
// ---------------------------------------------------------------------------

// boolean modules → bar-first pixel runs at `scale` px per module.
function modulesToRuns(modules, scale = 3) {
  const runs = [];
  let cur = modules[0];
  let len = 0;
  for (const m of modules) {
    if (m === cur) {
      len++;
    } else {
      runs.push(len * scale);
      cur = m;
      len = 1;
    }
  }
  runs.push(len * scale);
  return runs;
}

// boolean modules → RGBA ImageData-like bitmap with quiet zones and uneven
// lighting (a mild horizontal brightness gradient), to exercise the local
// threshold rather than a trivial global one.
function modulesToImageData(modules, { scale = 3, quiet = 24, height = 20, gradient = 30 } = {}) {
  const width = modules.length * scale + quiet * 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const m = Math.floor((x - quiet) / scale);
      const dark = x >= quiet && m >= 0 && m < modules.length && modules[m];
      const shade = (dark ? 40 : 225) - Math.round((x / width) * gradient);
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = shade;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

// ---------------------------------------------------------------------------
// Code 128 round-trips
// ---------------------------------------------------------------------------

describe('decode: Code 128 runs round-trip', () => {
  const CASES = ['Hello 128!', 'A', 'code-128 text', 'ABC1234567xy', '1234567890', '0042'];
  for (const text of CASES) {
    it(`round-trips ${JSON.stringify(text)}`, () => {
      const { modules } = encodeCode128(text);
      const res = decodeRuns(modulesToRuns(modules));
      expect(res).not.toBeNull();
      expect(res.format).toBe('code128');
      expect(res.text).toBe(text);
      expect(res.reversed).toBe(false);
    });
  }

  it('reports the code sets used (B only, C only, and a B→C switch)', () => {
    const onlyB = decodeRuns(modulesToRuns(encodeCode128('abc').modules));
    expect(onlyB.codeSets).toEqual(['B']);
    const onlyC = decodeRuns(modulesToRuns(encodeCode128('123456').modules));
    expect(onlyC.codeSets).toEqual(['C']);
    const mixed = decodeRuns(modulesToRuns(encodeCode128('x12345678').modules));
    expect(mixed.codeSets).toContain('B');
    expect(mixed.codeSets).toContain('C');
  });

  it('decodes at different module scales, including scale 1', () => {
    const { modules } = encodeCode128('scale test 99');
    for (const scale of [1, 2, 5]) {
      expect(decodeRuns(modulesToRuns(modules, scale)).text).toBe('scale test 99');
    }
  });

  it('decodes a reversed (180°-rotated) scan and flags it', () => {
    const runs = modulesToRuns(encodeCode128('REV42').modules).reverse();
    const res = decodeRuns(runs);
    expect(res.text).toBe('REV42');
    expect(res.reversed).toBe(true);
  });
});

describe('decode: Code 128 negative cases', () => {
  const goodRuns = () => modulesToRuns(encodeCode128('Hello 128!').modules);

  it('rejects a corrupted run (one bar smeared wider)', () => {
    const runs = goodRuns();
    runs[8] += runs[8] * 2; // smear one bar well past a plausible module count
    expect(decodeCode128Runs(runs)).toBeNull();
  });

  it('rejects a wrong check symbol even when every pattern is valid', () => {
    const values = encodeToValues('Hello 128!');
    const tampered = [...values];
    tampered[tampered.length - 2] = (tampered[tampered.length - 2] + 1) % 103;
    expect(decodeCode128Runs(modulesToRuns(valuesToModules(tampered)))).toBeNull();
  });

  it('rejects truncated rows', () => {
    const runs = goodRuns();
    expect(decodeCode128Runs(runs.slice(0, runs.length - 3))).toBeNull();
    expect(decodeRuns(runs.slice(0, 10))).toBeNull();
    expect(decodeRuns([])).toBeNull();
    expect(decodeRuns(null)).toBeNull();
  });

  it('rejects a run sequence with no STOP pattern', () => {
    const values = encodeToValues('Hi');
    const noStop = values.slice(0, -1); // drop STOP → run count no longer ≡ 7 (mod 6)
    expect(decodeCode128Runs(modulesToRuns(valuesToModules(noStop)))).toBeNull();
  });

  it('refuses FNC4 (extended ASCII) instead of decoding wrong text', () => {
    // START-B, FNC4, 'A' really means 'Á'; swallowing FNC4 would return "A".
    const withCheck = (values) => {
      let sum = values[0];
      for (let k = 1; k < values.length; k++) sum += values[k] * k;
      return [...values, sum % 103, 106];
    };
    expect(decodeCode128Runs(modulesToRuns(valuesToModules(withCheck([104, 100, 33]))))).toBeNull(); // FNC4 in set B
    expect(decodeCode128Runs(modulesToRuns(valuesToModules(withCheck([103, 101, 33]))))).toBeNull(); // FNC4 in set A
  });
});

// ---------------------------------------------------------------------------
// EAN-13 / UPC-A round-trips
// ---------------------------------------------------------------------------

describe('decode: EAN-13 / UPC-A runs round-trip', () => {
  it('round-trips an EAN-13 and reports the implied first digit + check digit', () => {
    const enc = encodeEan('ean13', '590123412345'); // check digit 7
    const res = decodeRuns(modulesToRuns(enc.modules));
    expect(res.format).toBe('ean13');
    expect(res.text).toBe('5901234123457');
    expect(res.firstDigit).toBe(5);
    expect(res.checkDigit).toBe(7);
  });

  it('round-trips every parity table row (first digits 0–9)', () => {
    for (let first = 0; first <= 9; first++) {
      const data12 = `${first}01234567890`;
      const enc = encodeEan('ean13', data12);
      const res = decodeRuns(modulesToRuns(enc.modules, 2));
      expect(res).not.toBeNull();
      expect(res.full).toBe(enc.text.length === 13 ? enc.text : '0' + enc.text);
      expect(res.firstDigit).toBe(first);
    }
  });

  it('reports a UPC-A (leading-zero EAN-13) as UPC-A with 12-digit text', () => {
    const enc = encodeEan('upca', '03600029145'); // check digit 2
    const res = decodeRuns(modulesToRuns(enc.modules));
    expect(res.format).toBe('upca');
    expect(res.text).toBe('036000291452');
    expect(res.full).toBe('0036000291452');
    expect(res.firstDigit).toBe(0);
  });

  it('decodes a reversed EAN-13 scan and flags it', () => {
    const enc = encodeEan('ean13', '590123412345');
    const res = decodeRuns(modulesToRuns(enc.modules).reverse());
    expect(res.text).toBe('5901234123457');
    expect(res.reversed).toBe(true);
  });
});

describe('decode: EAN negative cases', () => {
  it('rejects a wrong check digit even when every pattern is valid', () => {
    // Build the 95-module pattern for a full code whose last digit is wrong.
    const runs = modulesToRuns(encodeEan13Modules('5901234123450')); // should be 7
    expect(decodeEanRuns(runs)).toBeNull();
    expect(decodeRuns(runs)).toBeNull();
  });

  it('rejects corrupted guard bars', () => {
    const runs = modulesToRuns(encodeEan('ean13', '590123412345').modules);
    runs[0] *= 4; // left guard bar smeared
    expect(decodeEanRuns(runs)).toBeNull();
  });

  it('rejects a truncated symbol', () => {
    const runs = modulesToRuns(encodeEan('ean13', '590123412345').modules);
    expect(decodeEanRuns(runs.slice(0, 40))).toBeNull();
  });

  it('rejects a corrupted digit group', () => {
    const runs = modulesToRuns(encodeEan('ean13', '590123412345').modules, 3);
    runs[4] += 6; // widen one left-digit bar by 2 modules
    expect(decodeEanRuns(runs)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bitmap stage: luminance → binarize → runs (no canvas — synthetic pixels)
// ---------------------------------------------------------------------------

describe('decode: bitmap pipeline on synthetic pixels', () => {
  it('decodes a Code 128 bitmap with a brightness gradient (local threshold)', () => {
    const img = modulesToImageData(encodeCode128('Bitmap OK 7').modules, { gradient: 60 });
    const res = decodeImageData(img);
    expect(res).not.toBeNull();
    expect(res.format).toBe('code128');
    expect(res.text).toBe('Bitmap OK 7');
  });

  it('decodes an EAN-13 bitmap', () => {
    const img = modulesToImageData(encodeEan('ean13', '400638133393').modules);
    const res = decodeImageData(img);
    expect(res.format).toBe('ean13');
    expect(res.text).toBe('4006381333931');
  });

  it('decodes a UPC-A bitmap at a larger module scale', () => {
    const img = modulesToImageData(encodeEan('upca', '03600029145').modules, { scale: 4 });
    const res = decodeImageData(img);
    expect(res.format).toBe('upca');
    expect(res.text).toBe('036000291452');
  });

  it('round-trips the generator maximum (120 chars, 739 runs) through the bitmap pipeline', () => {
    const text = 'Aa0Bb1Cc2Dd3'.repeat(10); // 120 chars — the generator's MAX_CODE128
    const img = modulesToImageData(encodeCode128(text).modules, { scale: 2 });
    const res = decodeImageData(img);
    expect(res).not.toBeNull();
    expect(res.text).toBe(text);
  });

  it('returns null for a blank image (honest failure, no guess)', () => {
    const width = 200;
    const height = 20;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    expect(decodeImageData({ data, width, height })).toBeNull();
  });

  it('returns null for random noise (honest failure, no guess)', () => {
    const width = 300;
    const height = 24;
    const data = new Uint8ClampedArray(width * height * 4);
    let seed = 42; // deterministic LCG so the test cannot flake
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.floor(rnd() * 256);
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
    expect(decodeImageData({ data, width, height })).toBeNull();
  });

  it('binarizeRow refuses a low-contrast row; rowToRuns refuses a bitless row', () => {
    expect(binarizeRow(new Array(100).fill(128))).toBeNull();
    expect(rowToRuns(null)).toBeNull();
    expect(rowToRuns(new Array(100).fill(false))).toBeNull();
  });

  it('rowLuminance weights channels perceptually', () => {
    // one pixel: pure green should read brighter than pure blue
    const g = rowLuminance({ data: new Uint8ClampedArray([0, 255, 0, 255]), width: 1 }, 0)[0];
    const b = rowLuminance({ data: new Uint8ClampedArray([0, 0, 255, 255]), width: 1 }, 0)[0];
    expect(g).toBeGreaterThan(b);
  });
});
