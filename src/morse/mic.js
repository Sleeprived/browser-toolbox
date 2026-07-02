// Microphone tone detection for Morse listening mode. Pure — no DOM, no audio
// objects; the UI feeds it AnalyserNode frequency frames and timestamps, and it
// emits confirmed key-down/key-up edges for the existing keyer (keyer.js).
//
// Every tuning constant lives in MIC_TUNING so the whole mode is adjustable
// from one place.

export const MIC_TUNING = {
  fftSize: 2048,    // analyser window; ~21.5 Hz per bin at 48 kHz
  bandLowHz: 350,   // tone search band — covers the tool's 400–1000 Hz tone range
  bandHighHz: 1150,
  onLevel: 120,     // byte-frequency magnitude (0–255) that confirms tone ON
  offLevel: 70,     // hysteresis: the tone must drop below this to count as OFF
  minOnMs: 25,      // shorter blips than these are noise, not keying
  minOffMs: 25,
  frameMs: 12,      // how often the UI samples the analyser
};

// Is a tone present in this frequency frame? `freqData` is the analyser's
// getByteFrequencyData output, `binHz` = sampleRate / fftSize. Hysteresis via
// `wasOn`: a playing tone only ends when it falls clearly below the ON level.
export function toneInFrame(freqData, binHz, wasOn, tuning = MIC_TUNING) {
  if (!freqData || !freqData.length || !(binHz > 0)) return false;
  const lo = Math.max(0, Math.floor(tuning.bandLowHz / binHz));
  const hi = Math.min(freqData.length - 1, Math.ceil(tuning.bandHighHz / binHz));
  let peak = 0;
  for (let i = lo; i <= hi; i++) {
    if (freqData[i] > peak) peak = freqData[i];
  }
  return peak >= (wasOn ? tuning.offLevel : tuning.onLevel);
}

// Debounced edge detector: sample(isTone, tMs) per frame, and it returns a
// confirmed edge — { type: 'down' | 'up', at } — once the new state has held
// for minOnMs / minOffMs. `at` is when the edge actually happened (the first
// frame of the new state), so the keyer sees true durations, not confirmation
// lag. Returns null while nothing changed.
export function createToneTracker(tuning = MIC_TUNING) {
  let state = false;      // confirmed tone state
  let candidate = null;   // { value, since } — unconfirmed new state
  return {
    sample(isTone, t) {
      if (isTone === state) {
        candidate = null;
        return null;
      }
      if (!candidate || candidate.value !== isTone) candidate = { value: isTone, since: t };
      if (t - candidate.since >= (isTone ? tuning.minOnMs : tuning.minOffMs)) {
        state = isTone;
        const at = candidate.since;
        candidate = null;
        return { type: isTone ? 'down' : 'up', at };
      }
      return null;
    },
    state: () => state,
  };
}
