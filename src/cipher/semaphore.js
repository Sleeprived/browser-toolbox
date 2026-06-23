// Flag semaphore engine: letter <-> two arm angles. Pure functions — no DOM, no
// network. glyph-render.js turns the angles into an SVG figure.
//
// Angles are degrees measured CLOCKWISE FROM STRAIGHT UP (0=up, 90=right,
// 180=down, 270=left), as the figure is SEEN BY THE OBSERVER facing the signaler.
//
// The table is the standard semaphore alphabet, derived from its canonical "circle"
// construction: there are 8 arm positions, position i pointing at (180 + 45*i)°
// (so 0=down, 1=down-left, … going clockwise), and the 28 unordered position-pairs
// {i<j} map in circle order to the 26 letters plus the numeric and annul signs:
//   circle 1 {0,·}: A B C D E F G      circle 2 {1,·}: H I K L M N
//   circle 3 {2,·}: O P Q R S          circle 4 {3,·}: T U Y (annul)
//   circle 5 {4,·}: (numeric) J V      circle 6 {5,·}: W X      circle 7 {6,7}: Z
// This reproduces every distinctive figure (R = horizontal line, U = up-V,
// N = down-V, D = vertical). The two arms are drawn identically from a central
// pivot, so `left`/`right` are simply the two angle slots (the larger and smaller);
// swapping them cannot change the rendered figure.

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// letter -> { left, right } arm angles in degrees (see convention above).
const ANGLES = {
  A: { left: 225, right: 180 }, B: { left: 270, right: 180 }, C: { left: 315, right: 180 },
  D: { left: 180, right: 0 }, E: { left: 180, right: 45 }, F: { left: 180, right: 90 },
  G: { left: 180, right: 135 }, H: { left: 270, right: 225 }, I: { left: 315, right: 225 },
  J: { left: 90, right: 0 }, K: { left: 225, right: 0 }, L: { left: 225, right: 45 },
  M: { left: 225, right: 90 }, N: { left: 225, right: 135 }, O: { left: 315, right: 270 },
  P: { left: 270, right: 0 }, Q: { left: 270, right: 45 }, R: { left: 270, right: 90 },
  S: { left: 270, right: 135 }, T: { left: 315, right: 0 }, U: { left: 315, right: 45 },
  V: { left: 135, right: 0 }, W: { left: 90, right: 45 }, X: { left: 135, right: 45 },
  Y: { left: 315, right: 90 }, Z: { left: 135, right: 90 },
};

/**
 * Arm angles for a letter, or null if it is not A–Z.
 * @returns {{ left:number, right:number } | null}
 */
export function anglesFor(letter) {
  return ANGLES[letter] || null;
}

/**
 * Split text into encodable letters (A–Z) for the visual strip.
 * @returns {{ letters: string[], skipped: string[] }}
 *   letters – A–Z in order; '' marks a word break (whitespace runs, collapsed/trimmed)
 *   skipped – non-letters (digits/punctuation), deduped in first-seen order
 * Never throws.
 */
export function textToSemaphore(text) {
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
