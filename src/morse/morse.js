// International Morse Code engine: text <-> Morse. Pure functions — no DOM, no
// timing, no audio, no network. Output is always plain text the UI writes with
// textContent (XSS-safe).
//
// Display format: dits as '.', dahs as '-', a single space between letters, and
// ' / ' between words. Prosigns are an ENCODE-ONLY convenience via the <XX>
// notation (e.g. <SOS> -> ...---... with no inter-letter gaps); see textToMorse.

export class MorseError extends Error {}

// char -> code. International (ITU) set: A–Z, 0–9, and common punctuation.
export const CODE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.',
  H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.',
  O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-',
  V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', $: '...-..-', '@': '.--.-.',
};

// code -> char, built once. Every code in CODE is unique, so this is lossless.
const DECODE = Object.fromEntries(Object.entries(CODE).map(([ch, c]) => [c, ch]));

const REPLACEMENT = '�';

/**
 * Encode text to Morse.
 * @returns {{ code: string, skipped: string[] }}
 *   code    – the Morse string (letters joined by ' ', words by ' / ')
 *   skipped – characters with no Morse equivalent, deduped in first-seen order
 * Never throws on content. Whitespace runs collapse to a single word break.
 * `<LETTERS>` (angle brackets, A–Z/0–9 only) is sent as a prosign: the codes
 * are concatenated with NO inter-letter gap. Any other '<'/'>' is unsupported.
 */
export function textToMorse(text) {
  const s = String(text).toUpperCase();
  const skipped = [];
  const seen = new Set();
  const record = (ch) => { if (!seen.has(ch)) { seen.add(ch); skipped.push(ch); } };

  // Sequence of letter-codes, with null marking a word break.
  const items = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      items.push(null);
      i++;
      while (i < s.length && /\s/.test(s[i])) i++;
      continue;
    }
    if (ch === '<') {
      const m = /^<([A-Z0-9]+)>/.exec(s.slice(i));
      if (m) {
        let joined = '';
        for (const c of m[1]) {
          const code = CODE[c];
          if (code) joined += code;
          else record(c);
        }
        if (joined) items.push(joined);
        i += m[0].length;
        continue;
      }
      record('<');
      i++;
      continue;
    }
    const code = CODE[ch];
    if (code) items.push(code);
    else record(ch);
    i++;
  }

  // Group codes into words on the null separators; drop empty words so leading,
  // trailing, or repeated breaks never produce stray slashes.
  const words = [];
  let cur = [];
  for (const item of items) {
    if (item === null) { if (cur.length) { words.push(cur); cur = []; } }
    else cur.push(item);
  }
  if (cur.length) words.push(cur);

  const code = words.map((w) => w.join(' ')).join(' / ');
  return { code, skipped };
}

/**
 * Decode Morse to uppercase text. Tolerant of input:
 *  - dit variants  · •      -> '.'
 *  - dah variants  − – — _  -> '-'
 *  - words separated by '/' (any surrounding spaces) or by 3+ spaces
 *  - letters separated by any run of whitespace
 * Unknown tokens become U+FFFD so a single bad token never blanks the rest.
 * Never throws on content.
 */
export function morseToText(morse) {
  const normalized = String(morse)
    .replace(/[·•]/g, '.')
    .replace(/[−–—_]/g, '-'); // − (minus) – — _ -> dah

  const out = [];
  // Split on explicit '/' word breaks first, then on 3+ space word breaks.
  for (const chunk of normalized.split(/\s*\/\s*/)) {
    for (const word of chunk.split(/ {3,}/)) {
      const letters = word.trim().split(/\s+/).filter(Boolean);
      if (!letters.length) continue;
      out.push(letters.map((tok) => DECODE[tok] ?? REPLACEMENT).join(''));
    }
  }
  return out.join(' ');
}
