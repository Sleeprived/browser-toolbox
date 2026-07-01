// Straight-key Morse classifier: timestamped press/release events in, dots,
// dashes, letters, and word breaks out. Pure — no DOM, no timers; the caller
// injects timestamps (ms) and drives flush() from its own scheduling.
//
// Thresholds, in units u (one dit): press < 2u = dot, otherwise dash; a gap
// >= 2u ends the letter; a gap >= 5u also starts a new word. u begins at
// 1200/wpm and adapts toward the operator's real rhythm — an exponential
// moving average of the observed dit length (a dash samples duration/3),
// clamped to 0.5x-2x of the slider base so one bad tap can't wreck it.
//
// Word breaks are decided when the NEXT letter starts (down or never), so a
// committed stream never ends in a dangling '/'.

const MIN_WPM = 1;
const MAX_WPM = 60;

export function createKeyer({ wpm = 12 } = {}) {
  const baseUnit = (w) => {
    const n = Number(w);
    const c = Number.isFinite(n) ? Math.min(MAX_WPM, Math.max(MIN_WPM, n)) : 12;
    return 1200 / c;
  };

  let base = baseUnit(wpm);
  let unit = base;
  let isDown = false;
  let downAt = 0;
  let lastUpAt = null;          // release time; null until first release / after finish
  let symbols = '';             // pending, uncommitted letter
  let letterDone = false;       // pending letter already committed by flush()
  let letterSinceBreak = false; // a letter was committed since the last word break

  const commitIfGap = (t) => {
    if (lastUpAt === null || letterDone || !symbols) return null;
    if (t - lastUpAt < 2 * unit) return null;
    const letter = symbols;
    symbols = '';
    letterDone = true;
    letterSinceBreak = true;
    return letter;
  };

  return {
    down(t) {
      if (isDown) return { committed: null, wordBreak: false };
      const committed = commitIfGap(t);
      let wordBreak = false;
      if (lastUpAt !== null && letterSinceBreak && t - lastUpAt >= 5 * unit) {
        wordBreak = true;
        letterSinceBreak = false;
      }
      isDown = true;
      downAt = t;
      return { committed, wordBreak };
    },

    up(t) {
      if (!isDown) return { symbol: null };
      isDown = false;
      const dur = Math.max(0, t - downAt);
      const symbol = dur < 2 * unit ? '.' : '-';
      const sample = symbol === '.' ? dur : dur / 3;
      unit = Math.min(2 * base, Math.max(0.5 * base, 0.7 * unit + 0.3 * sample));
      symbols += symbol;
      letterDone = false;
      lastUpAt = t;
      return { symbol };
    },

    // Timer-driven commit; idempotent, never word-breaks (see header).
    flush(t) {
      if (isDown) return { committed: null };
      return { committed: commitIfGap(t) };
    },

    // End of input (stop / blur / tab hidden): commit whatever is pending,
    // unconditionally; a press still held is discarded, not classified.
    finish() {
      isDown = false;
      const committed = symbols || null;
      if (committed) letterSinceBreak = true;
      symbols = '';
      letterDone = true;
      lastUpAt = null;
      return { committed };
    },

    pending: () => symbols,
    unitMs: () => unit,
    setWpm(w) { base = baseUnit(w); unit = base; },
  };
}
