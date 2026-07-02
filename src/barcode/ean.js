// Pure EAN-13 / UPC-A encoders. No DOM, no globals — testable in isolation.
// Returns a flat boolean `modules` array (true = dark bar) plus the normalized
// full code and check-digit metadata for the UI.

import { BarcodeError } from './code128.js';

// 7-module digit patterns as bit strings (1 = bar). L = left-odd, G = left-even,
// R = right. G is the reverse of R; R is the bitwise complement of L.
// Exported so the decoder can reverse the same tables.
export const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
export const G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
export const R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];

// Which left-hand digits use L vs G, indexed by the EAN-13 first digit.
// Exported so the decoder can recover the implied first digit.
export const PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

const GUARD = '101';
const CENTER = '01010';

const toDigits = (s) => Array.from(s, (c) => c.charCodeAt(0) - 48);
const strToModules = (bits) => Array.from(bits, (c) => c === '1');

// EAN-13 check digit from the first 12 digits: odd positions ×1, even ×3.
export function ean13CheckDigit(first12) {
  const d = toDigits(first12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += d[i] * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

// UPC-A check digit from the first 11 digits: odd positions ×3, even ×1.
export function upcaCheckDigit(first11) {
  const d = toDigits(first11);
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += d[i] * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

// Normalize user input for a symbology. Accepts either the data-only length
// (12 for EAN-13, 11 for UPC-A → check digit computed) or the full length
// (13 / 12 → supplied check digit validated). Strips spaces.
// Returns { full, checkDigit, supplied, mismatch }.
export function normalize(symbology, input) {
  const digits = String(input).replace(/\s+/g, '');
  const dataLen = symbology === 'ean13' ? 12 : 11;
  const fullLen = dataLen + 1;
  const check = symbology === 'ean13' ? ean13CheckDigit : upcaCheckDigit;

  if (!/^[0-9]+$/.test(digits)) {
    throw new BarcodeError('Digits only (0–9).');
  }
  if (digits.length === dataLen) {
    const cd = check(digits);
    return { full: digits + cd, checkDigit: cd, supplied: false, mismatch: false };
  }
  if (digits.length === fullLen) {
    const cd = check(digits.slice(0, dataLen));
    const given = Number(digits[dataLen]);
    return { full: digits.slice(0, dataLen) + cd, checkDigit: cd, supplied: true, mismatch: given !== cd };
  }
  throw new BarcodeError(
    `${symbology === 'ean13' ? 'EAN-13' : 'UPC-A'} needs ${dataLen} digits ` +
    `(or ${fullLen} including the check digit).`,
  );
}

// Build the 95-module pattern for a full 13-digit EAN-13 code.
export function encodeEan13Modules(full13) {
  const d = toDigits(full13);
  const parity = PARITY[d[0]];
  let mods = [...strToModules(GUARD)];
  for (let k = 0; k < 6; k++) {
    const table = parity[k] === 'L' ? L : G;
    mods = mods.concat(strToModules(table[d[1 + k]]));
  }
  mods = mods.concat(strToModules(CENTER));
  for (let k = 0; k < 6; k++) mods = mods.concat(strToModules(R[d[7 + k]]));
  mods = mods.concat(strToModules(GUARD));
  return mods;
}

// Encode a symbology + user input into { modules, text, checkDigit, supplied,
// mismatch }. UPC-A is EAN-13 with an implicit leading zero (same 95 modules);
// its human-readable text stays the 12-digit UPC form.
export function encodeEan(symbology, input) {
  const norm = normalize(symbology, input);
  if (symbology === 'ean13') {
    return { modules: encodeEan13Modules(norm.full), text: norm.full, ...norm };
  }
  // upca
  return { modules: encodeEan13Modules('0' + norm.full), text: norm.full, ...norm };
}
