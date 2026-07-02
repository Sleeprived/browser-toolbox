// Pure barcode DECODER for the formats the generator can produce: Code 128,
// EAN-13, and UPC-A. No DOM, no canvas — the whole pipeline is plain data in,
// plain data out, so every stage is unit-testable in jsdom:
//
//   ImageData-like {data,width,height}
//     → rowLuminance()  → per-pixel brightness of one horizontal line
//     → binarizeRow()   → booleans (true = dark), local-threshold
//     → rowToRuns()     → run lengths in pixels, bar-first, quiet zones trimmed
//     → decodeRuns()    → { format, text, ... } or null
//
// Honest failure mode by design: every stage returns null on anything it is not
// sure about, and both symbologies are checksum-verified — a low-confidence
// guess is never returned. There is no rotation/blur/perspective correction
// (out of scope); a reversed (180°-rotated) scan is handled because it is just
// the same runs backwards.

import { PATTERNS } from './code128.js';
import { L, G, R, PARITY, ean13CheckDigit } from './ean.js';

// ---------------------------------------------------------------------------
// Code 128
// ---------------------------------------------------------------------------

// Reverse lookup: run-length pattern string ('212222') → symbol value.
const PATTERN_TO_VALUE = new Map(PATTERNS.map((p, v) => [p, v]));
const STOP_PATTERN = PATTERNS[106]; // '2331112', 13 modules, 7 runs

// Normalize a group of pixel runs to a module-count pattern string, requiring
// the module counts to add up exactly (a blur/misread usually breaks the sum).
function runsToPattern(group, totalModules) {
  const total = group.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let pattern = '';
  let sum = 0;
  for (const r of group) {
    const m = Math.round((r * totalModules) / total);
    if (m < 1 || m > 4) return null;
    pattern += m;
    sum += m;
  }
  return sum === totalModules ? pattern : null;
}

// Map decoded symbol values (START..data, check excluded) to text, tracking the
// code sets used. Returns null on any sequence the tables cannot explain.
function code128ValuesToText(values) {
  const startSet = { 103: 'A', 104: 'B', 105: 'C' }[values[0]];
  if (!startSet) return null;
  let set = startSet;
  const sets = new Set([set]);
  let shift = null;
  let fnc1 = false; // GS1 separators carry no text — noted so fused fields aren't silent
  let text = '';
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    const cur = shift || set;
    shift = null;
    if (cur === 'C') {
      if (v <= 99) { text += String(v).padStart(2, '0'); continue; }
      if (v === 100) { set = 'B'; sets.add('B'); continue; }
      if (v === 101) { set = 'A'; sets.add('A'); continue; }
      if (v === 102) { fnc1 = true; continue; } // FNC1 — GS1 separator, not text
      return null;
    }
    if (v <= 95) {
      // Set B: 0..95 → ASCII 32..127. Set A: 0..63 → ASCII 32..95, 64..95 → control 0..31.
      text += String.fromCharCode(cur === 'B' ? v + 32 : v < 64 ? v + 32 : v - 64);
      continue;
    }
    if (v === 96 || v === 97) continue; // FNC3 / FNC2
    if (v === 98) { shift = cur === 'A' ? 'B' : 'A'; sets.add(shift); continue; }
    if (v === 99) { set = 'C'; sets.add('C'); continue; }
    // FNC4 (Latin-1 shift) is not supported: swallowing it would decode
    // extended-ASCII data to confidently wrong text, so refuse instead.
    if (v === 100) { if (cur !== 'A') return null; set = 'B'; sets.add('B'); continue; } // in B: FNC4
    if (v === 101) { if (cur !== 'B') return null; set = 'A'; sets.add('A'); continue; } // in A: FNC4
    if (v === 102) { fnc1 = true; continue; } // FNC1
    return null;
  }
  return { text, codeSets: [...sets], fnc1 };
}

// Decode a bar-first pixel-run array as Code 128. Null unless the geometry,
// every pattern, the STOP symbol, AND the mod-103 checksum all agree.
export function decodeCode128Runs(runs) {
  // START + ≥0 data + check = k symbols of 6 runs, then STOP's 7 runs.
  if (runs.length < 19 || (runs.length - 7) % 6 !== 0) return null;
  const symCount = (runs.length - 7) / 6;
  const values = [];
  for (let s = 0; s < symCount; s++) {
    const pattern = runsToPattern(runs.slice(s * 6, s * 6 + 6), 11);
    if (!pattern) return null;
    const v = PATTERN_TO_VALUE.get(pattern);
    if (v === undefined || v > 105) return null;
    values.push(v);
  }
  if (runsToPattern(runs.slice(symCount * 6), 13) !== STOP_PATTERN) return null;
  const check = values[values.length - 1];
  let sum = values[0];
  for (let k = 1; k < values.length - 1; k++) sum += values[k] * k;
  if (sum % 103 !== check) return null;
  const parsed = code128ValuesToText(values.slice(0, -1));
  if (!parsed) return null;
  return { format: 'code128', text: parsed.text, codeSets: parsed.codeSets, fnc1: parsed.fnc1, checkSymbol: check };
}

// ---------------------------------------------------------------------------
// EAN-13 / UPC-A
// ---------------------------------------------------------------------------

// Normalize a 4-run digit group to its 7-module bit string ('0001101' …).
function eanGroupToBits(group, startsWithBar) {
  const total = group.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let bits = '';
  let bar = startsWithBar;
  let sum = 0;
  for (const r of group) {
    const m = Math.round((r * 7) / total);
    if (m < 1 || m > 4) return null;
    bits += (bar ? '1' : '0').repeat(m);
    sum += m;
    bar = !bar;
  }
  return sum === 7 ? bits : null;
}

// Decode a bar-first pixel-run array as EAN-13 (UPC-A = first digit 0). Null
// unless guards, every digit pattern, the parity word, AND the check digit agree.
export function decodeEanRuns(runs) {
  // 3 (guard) + 6×4 (left digits) + 5 (center) + 6×4 (right digits) + 3 (guard)
  if (runs.length !== 59) return null;
  const total = runs.reduce((a, b) => a + b, 0);
  const moduleWidth = total / 95;
  // All guard/center runs are exactly 1 module wide.
  for (const idx of [0, 1, 2, 27, 28, 29, 30, 31, 56, 57, 58]) {
    if (Math.round(runs[idx] / moduleWidth) !== 1) return null;
  }
  const digits = [];
  let parity = '';
  for (let k = 0; k < 6; k++) {
    const bits = eanGroupToBits(runs.slice(3 + k * 4, 7 + k * 4), false); // space first
    if (!bits) return null;
    let d = L.indexOf(bits);
    if (d !== -1) { parity += 'L'; } else { d = G.indexOf(bits); parity += 'G'; }
    if (d === -1) return null;
    digits.push(d);
  }
  for (let k = 0; k < 6; k++) {
    const bits = eanGroupToBits(runs.slice(32 + k * 4, 36 + k * 4), true); // bar first
    if (!bits) return null;
    const d = R.indexOf(bits);
    if (d === -1) return null;
    digits.push(d);
  }
  const first = PARITY.indexOf(parity);
  if (first === -1) return null;
  const full = String(first) + digits.join('');
  if (ean13CheckDigit(full.slice(0, 12)) !== Number(full[12])) return null;
  // An EAN-13 whose implied first digit is 0 IS a UPC-A symbol; report it as
  // such (12-digit text) since that is what the generator would recreate.
  return {
    format: first === 0 ? 'upca' : 'ean13',
    text: first === 0 ? full.slice(1) : full,
    full,
    firstDigit: first,
    checkDigit: Number(full[12]),
  };
}

// ---------------------------------------------------------------------------
// Combined runs decoder
// ---------------------------------------------------------------------------

// Try every supported symbology, forwards then reversed (a 180°-rotated scan is
// the same run sequence backwards). Returns null when nothing decodes cleanly.
export function decodeRuns(runs) {
  if (!Array.isArray(runs) || runs.length < 19) return null;
  const direct = decodeEanRuns(runs) ?? decodeCode128Runs(runs);
  if (direct) return { ...direct, reversed: false };
  const rev = [...runs].reverse();
  const flipped = decodeEanRuns(rev) ?? decodeCode128Runs(rev);
  if (flipped) return { ...flipped, reversed: true };
  return null;
}

// ---------------------------------------------------------------------------
// Bitmap → runs
// ---------------------------------------------------------------------------

// Perceptual luminance of one horizontal line of an RGBA ImageData-like object.
export function rowLuminance(imageData, y) {
  const { data, width } = imageData;
  const lum = new Array(width);
  let o = y * width * 4;
  for (let x = 0; x < width; x++, o += 4) {
    lum[x] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  return lum;
}

// Binarize one luminance row with a local (moving-average) threshold, so a
// brightness gradient across the image does not smear bars into spaces.
// Returns booleans (true = dark) or null when the row has too little contrast
// to plausibly contain a barcode.
export function binarizeRow(lum) {
  const n = lum.length;
  if (n < 30) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of lum) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < 48) return null; // flat line — no bars here
  // Prefix sums make each pixel's window average O(1).
  const prefix = new Array(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + lum[i];
  const half = Math.max(8, Math.round(n / 32));
  const bits = new Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const avg = (prefix[hi] - prefix[lo]) / (hi - lo);
    // Slight bias toward "light" so paper texture does not read as bars.
    bits[i] = lum[i] < avg * 0.87;
  }
  return bits;
}

// Run-length encode a binarized row, trimming the light quiet zones so the
// result is bar-first and bar-last. Null when there are too few or absurdly
// many transitions to be one of our symbologies.
export function rowToRuns(bits) {
  if (!bits) return null;
  let start = bits.indexOf(true);
  let end = bits.lastIndexOf(true);
  if (start === -1 || end - start < 20) return null;
  const runs = [];
  let cur = true;
  let len = 0;
  for (let i = start; i <= end; i++) {
    if (bits[i] === cur) {
      len++;
    } else {
      runs.push(len);
      cur = !cur;
      len = 1;
    }
    // Longest legal symbol: Code 128 at the generator's 120-char max is
    // START + 120 data + check (122 symbols × 6 runs) + STOP (7) = 739 runs.
    if (runs.length > 750) return null; // noise, not a linear barcode
  }
  runs.push(len);
  return runs;
}

// Scan several horizontal lines of the bitmap, center-out, and return the first
// checksum-clean decode — or null (the caller shows the honest failure message).
const SCAN_FRACTIONS = [
  0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7,
  0.25, 0.75, 0.2, 0.8, 0.15, 0.85, 0.1, 0.9,
];

export function decodeImageData(imageData) {
  const { width, height } = imageData;
  if (!width || !height) return null;
  const tried = new Set();
  for (const f of SCAN_FRACTIONS) {
    const y = Math.min(height - 1, Math.round(f * height));
    if (tried.has(y)) continue;
    tried.add(y);
    const runs = rowToRuns(binarizeRow(rowLuminance(imageData, y)));
    if (!runs) continue;
    const res = decodeRuns(runs);
    if (res) return res;
  }
  return null;
}
