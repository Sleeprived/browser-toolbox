// Tap Code (POW knock code) engine: text <-> tap pairs. Pure functions — no DOM,
// no network. Output is always plain text the UI writes with textContent (XSS-safe).
//
// Classic 5x5 grid with K dropped (sent as C), so only 25 cells are needed:
//
//      c1 c2 c3 c4 c5
//  r1  A  B  C  D  E
//  r2  F  G  H  I  J
//  r3  L  M  N  O  P
//  r4  Q  R  S  T  U
//  r5  V  W  X  Y  Z
//
// Encode: each letter -> "row-col"; letters joined by ' ', words by ' / '.
// Decode is digit-only and unambiguous: within a word, every digit is collected
// in order and paired (row,col); see tapsToText. Because K shares C's cell, a
// decoded (1,3) is always C — K is unrecoverable (inherent to the code).

export const GRID = [
  ['A', 'B', 'C', 'D', 'E'],
  ['F', 'G', 'H', 'I', 'J'],
  ['L', 'M', 'N', 'O', 'P'],
  ['Q', 'R', 'S', 'T', 'U'],
  ['V', 'W', 'X', 'Y', 'Z'],
];

// letter -> [row, col], 1-indexed. K is mapped onto C's cell.
const ENCODE = {};
for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) ENCODE[GRID[r][c]] = [r + 1, c + 1];
ENCODE.K = ENCODE.C;

const REPLACEMENT = '�';

/**
 * Encode text to tap pairs.
 * @returns {{ code: string, skipped: string[] }}
 *   code    – tap pairs ("r-c"), letters joined by ' ', words by ' / '
 *   skipped – characters with no tap form (digits/punctuation), deduped in order
 * Never throws on content. Whitespace runs collapse to a single word break.
 */
export function textToTaps(text) {
  const s = String(text).toUpperCase();
  const skipped = [];
  const seen = new Set();
  const record = (ch) => { if (!seen.has(ch)) { seen.add(ch); skipped.push(ch); } };

  const words = [];
  let cur = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (cur.length) { words.push(cur); cur = []; }
      i++;
      while (i < s.length && /\s/.test(s[i])) i++;
      continue;
    }
    const cell = ENCODE[ch];
    if (cell) cur.push(`${cell[0]}-${cell[1]}`);
    else record(ch);
    i++;
  }
  if (cur.length) words.push(cur);

  return { code: words.map((w) => w.join(' ')).join(' / '), skipped };
}

/**
 * Decode tap pairs to uppercase text. Digit-notation only and unambiguous:
 *  - words are split on '/' (any surrounding spaces) or 3+ spaces;
 *  - within a word EVERY digit is collected in order (so '2-3', '23', '2 3' all
 *    give the digits 2,3) and paired: 1st+2nd = letter, 3rd+4th = letter, …
 *  - a pair with a digit outside 1..5, or a leftover odd trailing digit, -> U+FFFD,
 *    so one bad pair never blanks the rest. Never throws on content.
 */
export function tapsToText(input) {
  const words = [];
  for (const chunk of String(input).split(/\s*\/\s*/)) {
    for (const word of chunk.split(/\s{3,}/)) {
      const digits = word.match(/\d/g);
      if (!digits) continue;
      let out = '';
      for (let k = 0; k < digits.length; k += 2) {
        const r = Number(digits[k]);
        const c = k + 1 < digits.length ? Number(digits[k + 1]) : NaN;
        out += (r >= 1 && r <= 5 && c >= 1 && c <= 5) ? GRID[r - 1][c - 1] : REPLACEMENT;
      }
      words.push(out);
    }
  }
  return words.join(' ');
}
