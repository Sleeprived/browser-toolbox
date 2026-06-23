// Pigpen (Freemason) cipher engine: letter <-> glyph GEOMETRY. Pure functions —
// no DOM, no network. glyph-render.js turns the geometry into SVG nodes.
//
// Standard variant, 26 = 9 + 9 + 4 + 4:
//   group 1  tic-tac-toe   A B C / D E F / G H I        (no dot)
//   group 2  tic-tac-toe   J K L / M N O / P Q R        (dot)
//   group 3  X (saltire)   S T U V                       (no dot)
//   group 4  X (saltire)   W X Y Z                       (dot)
//
// A tic-tac-toe glyph is the grid edges bordering the letter's 3x3 cell (centre =
// full box, corner = open "L", edge = "U"). An X glyph is the chevron pointing
// outward from the letter's saltire triangle. The X-limb order S/W=up, T/X=right,
// U/Y=down, V/Z=left is the CHOSEN convention for this build (reproduced charts
// vary); it yields 8 distinct X glyphs and must match the build-time reference chart.

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const CHEVRONS = ['up', 'right', 'down', 'left'];

/**
 * Geometry descriptor for a letter, in a unit square.
 * @returns {{ edges:{top,right,bottom,left}, chevron:('up'|'right'|'down'|'left'|null), dot:boolean } | null}
 *   For tic-tac-toe letters `chevron` is null and `edges` flags the drawn borders.
 *   For X letters `edges` are all false and `chevron` is the outward direction.
 *   `dot` only flags presence; the renderer derives the dot's position.
 */
export function glyphFor(letter) {
  const idx = LETTERS.indexOf(letter);
  if (idx < 0) return null;
  let edges = { top: false, right: false, bottom: false, left: false };
  let chevron = null;
  let dot = false;
  if (idx < 18) {
    // tic-tac-toe: group 1 (0–8) plain, group 2 (9–17) dotted
    dot = idx >= 9;
    const local = idx % 9;
    const r = Math.floor(local / 3);
    const c = local % 3;
    edges = { top: r > 0, right: c < 2, bottom: r < 2, left: c > 0 };
  } else {
    // X (saltire): group 3 (18–21) plain, group 4 (22–25) dotted
    dot = idx >= 22;
    chevron = CHEVRONS[(idx - 18) % 4];
  }
  return { edges, chevron, dot };
}

/**
 * Split text into encodable letters (A–Z) for the visual strip.
 * @returns {{ letters: string[], skipped: string[] }}
 *   letters – A–Z in order; '' marks a word break (whitespace runs, collapsed/trimmed)
 *   skipped – non-letters (digits/punctuation), deduped in first-seen order
 * Never throws.
 */
export function textToPigpen(text) {
  return splitLetters(text);
}

// Letter/word splitter for the visual strip. Word breaks are '' tokens;
// leading/trailing/collapsed whitespace never produces empty words.
function splitLetters(text) {
  const s = String(text).toUpperCase();
  const letters = [];
  const skipped = [];
  const seen = new Set();
  const record = (ch) => { if (!seen.has(ch)) { seen.add(ch); skipped.push(ch); } };

  let started = false;
  let pendingBreak = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (started) pendingBreak = true;
      i++;
      while (i < s.length && /\s/.test(s[i])) i++;
      continue;
    }
    if (ch >= 'A' && ch <= 'Z') {
      if (pendingBreak) { letters.push(''); pendingBreak = false; }
      letters.push(ch);
      started = true;
    } else {
      record(ch);
    }
    i++;
  }
  return { letters, skipped };
}
