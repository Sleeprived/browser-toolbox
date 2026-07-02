// Pure Code 128 (subset B baseline + subset C for digit pairs) encoder.
// No DOM, no globals — testable in isolation. Returns the symbol VALUES (for
// tests) and a flat boolean `modules` array (true = dark bar) ready to render.

export class BarcodeError extends Error {}

// The 108 Code 128 element patterns, indexed by symbol value 0..106.
// Each string is the bar/space run-length sequence (bar first). Values 0..102 are
// data, 103/104/105 are START A/B/C, 106 is STOP (its 7 runs include the final
// bar). Sum of runs is 11 modules for data/start symbols and 13 for STOP.
// Exported so the decoder can reverse the same table.
export const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const STOP = 106;
const SWITCH_TO_B = 100; // used from within code C
const SWITCH_TO_C = 99;  // used from within code B

const isDigit = (ch) => ch >= '0' && ch <= '9';

// Count consecutive digits in `data` starting at index `i`.
function leadingDigits(data, i) {
  let n = 0;
  while (i + n < data.length && isDigit(data[i + n])) n++;
  return n;
}

// Choose the start subset. Code C (digit pairs) is worth it up front when the
// data is an even-length all-digit string, or opens with a run of 4+ digits.
function chooseStart(data) {
  const n = data.length;
  if (n >= 2) {
    const lead = leadingDigits(data, 0);
    if (lead >= 4 || (lead === n && n % 2 === 0)) return 'C';
  }
  return 'B';
}

// Encode `data` (printable ASCII 32..126) into Code 128 symbol values, including
// the START symbol, the mod-103 check symbol, and STOP. Subset C encodes pairs of
// digits within any digit run; an odd leftover digit falls back to subset B.
export function encodeToValues(data) {
  if (typeof data !== 'string') throw new BarcodeError('Code 128 input must be text.');
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (code < 32 || code > 126) {
      throw new BarcodeError('Code 128 here supports printable ASCII characters (32–126) only.');
    }
  }

  let mode = chooseStart(data);
  const values = [mode === 'C' ? START_C : START_B];
  let i = 0;
  const n = data.length;

  while (i < n) {
    if (mode === 'C') {
      if (i + 1 < n && isDigit(data[i]) && isDigit(data[i + 1])) {
        values.push(Number(data.slice(i, i + 2)));
        i += 2;
      } else {
        values.push(SWITCH_TO_B);
        mode = 'B';
      }
    } else {
      const run = leadingDigits(data, i);
      const atEnd = i + run === n;
      const worthC = run >= 4 || (atEnd && run >= 2 && run % 2 === 0);
      if (worthC && run >= 2) {
        values.push(SWITCH_TO_C);
        mode = 'C';
      } else {
        values.push(data.charCodeAt(i) - 32);
        i += 1;
      }
    }
  }

  // Mod-103 checksum: start value + Σ(value·position), position 1-based over the
  // symbols that follow START.
  let sum = values[0];
  for (let k = 1; k < values.length; k++) sum += values[k] * k;
  values.push(sum % 103);
  values.push(STOP);
  return values;
}

// Expand a symbol-value sequence into a flat boolean module array (true = bar).
export function valuesToModules(values) {
  const modules = [];
  for (const v of values) {
    const pattern = PATTERNS[v];
    let bar = true;
    for (const runCh of pattern) {
      const run = Number(runCh);
      for (let k = 0; k < run; k++) modules.push(bar);
      bar = !bar;
    }
  }
  return modules;
}

// Full pipeline: text → { values, modules, text }. `text` is the human-readable
// string (the original data).
export function encodeCode128(data) {
  const values = encodeToValues(data);
  return { values, modules: valuesToModules(values), text: data };
}
