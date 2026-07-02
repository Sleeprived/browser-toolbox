import { describe, it, expect } from 'vitest';
import { MIC_TUNING, toneInFrame, createToneTracker } from '../src/morse/mic.js';
import { createKeyer } from '../src/morse/keyer.js';
import { textToMorse, morseToText } from '../src/morse/morse.js';
import { buildTimeline } from '../src/morse/timing.js';

const BIN_HZ = 48000 / MIC_TUNING.fftSize; // ~23.4 Hz per bin
const BINS = MIC_TUNING.fftSize / 2;

function frameWithPeak(freqHz, level) {
  const data = new Uint8Array(BINS);
  if (freqHz != null) data[Math.round(freqHz / BIN_HZ)] = level;
  return data;
}

describe('toneInFrame', () => {
  it('detects a loud tone inside the band and ignores one outside it', () => {
    expect(toneInFrame(frameWithPeak(600, 200), BIN_HZ, false)).toBe(true);
    expect(toneInFrame(frameWithPeak(3000, 255), BIN_HZ, false)).toBe(false);
    expect(toneInFrame(frameWithPeak(null, 0), BIN_HZ, false)).toBe(false);
  });

  it('applies hysteresis: a fading tone stays ON until it drops below offLevel', () => {
    const between = (MIC_TUNING.offLevel + MIC_TUNING.onLevel) >> 1;
    expect(toneInFrame(frameWithPeak(600, between), BIN_HZ, false)).toBe(false); // not loud enough to start
    expect(toneInFrame(frameWithPeak(600, between), BIN_HZ, true)).toBe(true);   // loud enough to continue
    expect(toneInFrame(frameWithPeak(600, MIC_TUNING.offLevel - 1), BIN_HZ, true)).toBe(false);
  });

  it('covers the whole tone slider range (400–1000 Hz)', () => {
    for (const hz of [400, 600, 800, 1000]) {
      expect(toneInFrame(frameWithPeak(hz, 200), BIN_HZ, false)).toBe(true);
    }
  });

  it('is defensive about empty input', () => {
    expect(toneInFrame(null, BIN_HZ, false)).toBe(false);
    expect(toneInFrame(new Uint8Array(0), BIN_HZ, false)).toBe(false);
    expect(toneInFrame(frameWithPeak(600, 200), 0, false)).toBe(false);
  });
});

describe('createToneTracker (debounced edges)', () => {
  it('confirms a sustained tone with the ORIGINAL edge time, not the confirmation time', () => {
    const tr = createToneTracker();
    expect(tr.sample(true, 0)).toBeNull(); // not held long enough yet
    const edge = tr.sample(true, MIC_TUNING.minOnMs + 5);
    expect(edge).toEqual({ type: 'down', at: 0 });
    expect(tr.state()).toBe(true);
  });

  it('ignores blips shorter than minOnMs / dropouts shorter than minOffMs', () => {
    const tr = createToneTracker();
    tr.sample(true, 0);
    expect(tr.sample(false, 10)).toBeNull(); // 10ms blip → discarded
    expect(tr.state()).toBe(false);
    // sustained tone, then a sub-threshold dropout mid-tone
    tr.sample(true, 100);
    tr.sample(true, 140); // down confirmed
    expect(tr.state()).toBe(true);
    tr.sample(false, 200);
    expect(tr.sample(true, 210)).toBeNull(); // dropout ended before minOffMs
    expect(tr.state()).toBe(true);
  });

  it('emits an up edge after a sustained silence', () => {
    const tr = createToneTracker();
    tr.sample(true, 0);
    tr.sample(true, 30);
    tr.sample(false, 100);
    const edge = tr.sample(false, 100 + MIC_TUNING.minOffMs);
    expect(edge).toEqual({ type: 'up', at: 100 });
    expect(tr.state()).toBe(false);
  });
});

// End-to-end: the toolbox's own timeline (what the Play button renders as audio)
// simulated as tone-state frames → tracker → keyer → decoded text. This is the
// jsdom-testable core of the acceptance criterion; only the acoustic capture
// itself needs the manual speaker test.
function simulateListening(text, { wpm = 20, frameMs = 10 } = {}) {
  const { code } = textToMorse(text);
  const tl = buildTimeline(code, { wpm });
  const spans = [];
  let t0 = 0;
  for (const seg of tl.segments) {
    spans.push({ start: t0, end: t0 + seg.ms, on: seg.on });
    t0 += seg.ms;
  }
  const stateAt = (t) => {
    const s = spans.find((x) => t >= x.start && t < x.end);
    return s ? s.on : false;
  };

  const tracker = createToneTracker();
  const keyer = createKeyer({ wpm: 20 });
  let heard = '';
  const commit = ({ committed, wordBreak = false }) => {
    if (wordBreak) heard += '/ ';
    if (committed) heard += `${committed} `;
  };
  for (let now = 0; now <= t0 + 2000; now += frameMs) {
    const edge = tracker.sample(stateAt(now), now);
    if (edge) {
      if (edge.type === 'down') commit(keyer.down(edge.at));
      else keyer.up(edge.at);
    } else if (!tracker.state()) {
      commit(keyer.flush(now));
    }
  }
  commit(keyer.finish());
  return { heard: heard.trim(), decoded: morseToText(heard) };
}

describe('mic pipeline end-to-end (timeline frames → tracker → keyer → text)', () => {
  it('decodes the toolbox\'s own timeline at the default 20 WPM', () => {
    expect(simulateListening('HELLO WORLD').decoded).toBe('HELLO WORLD');
  });

  it('decodes SOS with digits and punctuation-free text at other speeds', () => {
    expect(simulateListening('SOS 911', { wpm: 15 }).decoded).toBe('SOS 911');
    expect(simulateListening('CQ CQ DE N0CALL', { wpm: 25 }).decoded).toBe('CQ CQ DE N0CALL');
  });

  it('produces clean Morse tokens, not fragments', () => {
    const { heard } = simulateListening('ET');
    expect(heard).toBe('. -');
  });
});
