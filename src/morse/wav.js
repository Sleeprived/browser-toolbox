// Render a Morse timeline to a WAV file, entirely in-browser. Pure — returns
// the raw bytes (Uint8Array); the UI wraps them in a Blob and downloads them.
// 16-bit signed PCM, mono. A short raised edge (attack/release ramp) on each
// ON segment suppresses the key-clicks a hard gate would produce.

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/**
 * @param {{segments: Array<{on: boolean, ms: number}>}|Array} timeline
 * @param {{freq?: number, sampleRate?: number, rampMs?: number, amplitude?: number}} opts
 * @returns {Uint8Array} a complete WAV file
 */
export function timelineToWav(timeline, { freq = 600, sampleRate = 8000, rampMs = 5, amplitude = 0.7 } = {}) {
  const segments = Array.isArray(timeline) ? timeline : (timeline.segments ?? []);
  const totalMs = segments.reduce((a, s) => a + s.ms, 0);
  const numSamples = Math.round((totalMs / 1000) * sampleRate);
  // Defensive cap: never allocate an unbounded buffer for an enormous timeline
  // (a long paste at low WPM). 30 minutes at the given rate is far beyond any real
  // use; the Morse UI caps output well below this, so from there this never fires.
  if (numSamples > 30 * 60 * sampleRate) throw new Error('Audio is too long to render — shorten the text or raise the speed.');
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF / WAVE header (canonical 44-byte PCM header).
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                       // fmt chunk size
  view.setUint16(20, 1, true);                        // audio format = PCM
  view.setUint16(22, 1, true);                        // channels = mono
  view.setUint32(24, sampleRate, true);               // sample rate
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true);           // block align
  view.setUint16(34, 16, true);                       // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const rampSamples = Math.max(1, Math.round((rampMs / 1000) * sampleRate));
  let offset = 44;
  let written = 0; // running sample count, used for continuous phase + edge timing
  let cumMs = 0;

  for (const seg of segments) {
    // Derive each segment's sample boundary from the cumulative time (in ms) so
    // per-segment rounding sums exactly to numSamples — no drift, no overflow.
    cumMs += seg.ms;
    const endSample = Math.round((cumMs / 1000) * sampleRate);
    const segLen = endSample - written;
    for (let n = 0; n < segLen; n++) {
      let val = 0;
      if (seg.on) {
        const t = (written + n) / sampleRate;
        let env = amplitude;
        if (n < rampSamples) env *= n / rampSamples;                 // attack: 0 -> full
        else if (n >= segLen - rampSamples) env *= Math.max(0, (segLen - 1 - n) / rampSamples); // release: full -> 0
        val = Math.sin(2 * Math.PI * freq * t) * env;
      }
      const clamped = Math.max(-1, Math.min(1, val));
      view.setInt16(offset, Math.round(clamped * 0x7fff), true);
      offset += 2;
    }
    written = endSample;
  }

  return new Uint8Array(buffer);
}
