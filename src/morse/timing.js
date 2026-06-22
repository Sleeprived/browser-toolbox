// Morse timing: turn a Morse string into a timeline of on/off segments (ms).
// Pure — no DOM, no audio. The audio player, WAV encoder, flasher, and vibrator
// all consume this one timeline so every output channel stays identical.
//
// Standard PARIS timing. One dit = the time unit:
//   dit = 1u ON, dah = 3u ON, intra-character gap = 1u OFF,
//   inter-character gap = 3u OFF, inter-word gap = 7u OFF.
// At W words per minute, u = 1200 / W milliseconds.
//
// Farnsworth: characters are keyed at `charWpm` (>= overall `wpm`) while the
// gaps between characters and words are stretched so the overall speed is
// `wpm`. Uses the ARRL/Finley standard: the PARIS word is 50 units = 31
// character-units + 19 spacing-units, and the word must last 60/wpm seconds.

/**
 * @param {string} morse  dits/dashes; ' ' between letters, '/' between words.
 * @param {{wpm?: number, charWpm?: number}} opts
 * @returns {{segments: Array<{on: boolean, ms: number}>, totalMs: number, unitMs: number}}
 */
export function buildTimeline(morse, { wpm = 20, charWpm } = {}) {
  // Coerce to finite numbers first (NaN slips past Math.max), then clamp.
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const wpmN = num(wpm, 20);
  const c = Math.max(1, num(charWpm, wpmN));        // character speed
  const s = Math.min(c, Math.max(1, wpmN));         // overall speed (<= char speed)
  const u = 1200 / c;                                // element unit (ms) at char speed

  // Per-unit spacing delay (ms). When c === s this is exactly u, so the standard
  // 1u/3u/7u spacing falls out; when c > s the gaps stretch.
  let td = (((60 / s) - (37.2 / c)) / 19) * 1000;
  if (!(td >= u)) td = u; // guard rounding / s===c

  const dit = u;
  const dah = 3 * u;
  const intra = u;          // gap between elements of the same character
  const interChar = 3 * td; // gap between characters
  const interWord = 7 * td; // gap between words

  const normalized = String(morse)
    .replace(/[·•]/g, '.')
    .replace(/[−–—_]/g, '-');

  const segments = [];
  const push = (on, ms) => { if (ms > 0) segments.push({ on, ms }); };

  // Words: split on '/' (any spacing) or 3+ spaces.
  const words = [];
  for (const chunk of normalized.split(/\s*\/\s*/)) {
    for (const word of chunk.split(/\s{3,}/)) {
      const letters = word.trim().split(/\s+/).filter(Boolean);
      if (letters.length) words.push(letters);
    }
  }

  for (let w = 0; w < words.length; w++) {
    if (w > 0) push(false, interWord);
    const letters = words[w];
    for (let l = 0; l < letters.length; l++) {
      if (l > 0) push(false, interChar);
      const elements = letters[l];
      let first = true;
      for (const el of elements) {
        if (el !== '.' && el !== '-') continue; // ignore stray chars
        if (!first) push(false, intra);
        push(true, el === '-' ? dah : dit);
        first = false;
      }
    }
  }

  // Normalize so the stream strictly alternates and starts/ends ON — the vibrate
  // and flash channels depend on this. Merges adjacent same-state segments (which
  // arise when a token has no dits/dashes, e.g. stray decode input) and trims any
  // leading/trailing silence. A no-op for well-formed Morse.
  const merged = [];
  for (const seg of segments) {
    if (!(seg.ms > 0)) continue;
    const last = merged[merged.length - 1];
    if (last && last.on === seg.on) last.ms += seg.ms;
    else merged.push({ on: seg.on, ms: seg.ms });
  }
  while (merged.length && !merged[0].on) merged.shift();
  while (merged.length && !merged[merged.length - 1].on) merged.pop();

  const totalMs = merged.reduce((a, seg) => a + seg.ms, 0);
  return { segments: merged, totalMs, unitMs: u };
}
