// Baconian cipher engine: text <-> 5-character A/B groups. Pure functions — no
// DOM, no network. Output is always plain text the UI writes with textContent.
//
// This is the DISTINCT 26-letter variant: each letter is its own code (its 0-based
// alphabet index written in 5 bits, A-bit=0/B-bit=1), so encode->decode round-trips
// losslessly. It differs from the historically common 24-letter Baconian (where
// I/J share a code and U/V share a code) for letters K–Z — e.g. here K=ABABA,
// classic K=ABABB. Chosen deliberately for clean round-trip.

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// letter -> 5-char A/B code, built from the index as 5 bits.
export const CODE = {};
for (let i = 0; i < 26; i++) {
  CODE[ALPHA[i]] = i.toString(2).padStart(5, '0').replace(/0/g, 'A').replace(/1/g, 'B');
}

// code -> letter (every code is distinct, so this is lossless).
const DECODE = {};
for (const [ch, code] of Object.entries(CODE)) DECODE[code] = ch;

const REPLACEMENT = '�';

/**
 * Encode text to Baconian.
 * @returns {{ code: string, skipped: string[] }}
 *   code    – 5-char A/B groups, letters joined by ' ', words by ' / '
 *   skipped – non-letters (digits/punctuation), deduped in first-seen order
 * Never throws on content. Whitespace runs collapse to a single word break.
 */
export function textToBacon(text) {
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
    const code = CODE[ch];
    if (code) cur.push(code);
    else record(ch);
    i++;
  }
  if (cur.length) words.push(cur);

  return { code: words.map((w) => w.join(' ')).join(' / '), skipped };
}

/**
 * Decode Baconian to uppercase text. Tolerant of input:
 *  - words split on '/' (any surrounding spaces) or 3+ spaces;
 *  - within a word every symbol is normalized (0/a/A -> A, 1/b/B -> B) and all
 *    other characters dropped, then grouped into 5s;
 *  - an incomplete trailing group, or a 5-group that is not a valid code, -> U+FFFD.
 * Never throws on content.
 */
export function baconToText(input) {
  const words = [];
  for (const chunk of String(input).split(/\s*\/\s*/)) {
    for (const word of chunk.split(/\s{3,}/)) {
      let bits = '';
      for (const c of word) {
        if (c === '0' || c === 'a' || c === 'A') bits += 'A';
        else if (c === '1' || c === 'b' || c === 'B') bits += 'B';
      }
      if (!bits) continue;
      let out = '';
      for (let k = 0; k < bits.length; k += 5) {
        const grp = bits.slice(k, k + 5);
        out += (grp.length === 5 && DECODE[grp]) ? DECODE[grp] : REPLACEMENT;
      }
      words.push(out);
    }
  }
  return words.join(' ');
}
