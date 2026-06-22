import { describe, it, expect } from 'vitest';
import { textToMorse, morseToText, CODE } from '../src/morse/morse.js';
import { buildTimeline } from '../src/morse/timing.js';
import { timelineToWav } from '../src/morse/wav.js';

describe('textToMorse', () => {
  it('encodes letters with spaces and words with / ', () => {
    expect(textToMorse('HELLO').code).toBe('.... . .-.. .-.. ---');
    expect(textToMorse('HELLO WORLD').code).toBe('.... . .-.. .-.. --- / .-- --- .-. .-.. -..');
  });

  it('is case-insensitive', () => {
    expect(textToMorse('hello').code).toBe(textToMorse('HELLO').code);
  });

  it('encodes digits and punctuation', () => {
    expect(textToMorse('SOS!').code).toBe('... --- ... -.-.--');
    expect(textToMorse('2 + 2').code).toBe('..--- / .-.-. / ..---');
  });

  it('collapses whitespace runs and trims to clean word breaks', () => {
    expect(textToMorse('  A   B  ').code).toBe('.- / -...');
  });

  it('joins a <prosign> with no inter-letter gap', () => {
    expect(textToMorse('<SOS>').code).toBe('...---...');
    expect(textToMorse('<AR>').code).toBe('.-.-.'); // A + R, joined
  });

  it('reports unsupported characters in skipped (deduped, in order)', () => {
    const r = textToMorse('A€B€');
    expect(r.code).toBe('.- -...');
    expect(r.skipped).toEqual(['€']);
  });

  it('never throws and returns empty for blank input', () => {
    expect(textToMorse('').code).toBe('');
    expect(textToMorse('   ').code).toBe('');
  });
});

describe('morseToText', () => {
  it('decodes letters and words', () => {
    expect(morseToText('.... ..')).toBe('HI');
    expect(morseToText('.... . .-.. .-.. --- / .-- --- .-. .-.. -..')).toBe('HELLO WORLD');
  });

  it('round-trips with textToMorse', () => {
    const text = 'THE QUICK BROWN FOX 123';
    expect(morseToText(textToMorse(text).code)).toBe(text);
  });

  it('tolerates unicode dit/dah variants', () => {
    expect(morseToText('•••• ••')).toBe('HI');   // bullets as dits
    expect(morseToText('−−−')).toBe('O');         // U+2212 minus as dahs
  });

  it('accepts 3+ spaces as a word break', () => {
    expect(morseToText('.-   -...')).toBe('A B');
  });

  it('maps an unknown token to U+FFFD without blanking neighbors', () => {
    expect(morseToText('.- ........ -...')).toBe('A�B');
  });

  it('returns empty for blank input', () => {
    expect(morseToText('')).toBe('');
  });
});

describe('CODE table', () => {
  it('has unique codes (lossless reverse map)', () => {
    const codes = Object.values(CODE);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('buildTimeline (standard PARIS timing)', () => {
  it('uses u = 1200/wpm for a dit', () => {
    const { segments, totalMs, unitMs } = buildTimeline('.', { wpm: 20 });
    expect(unitMs).toBe(60);
    expect(segments).toEqual([{ on: true, ms: 60 }]);
    expect(totalMs).toBe(60);
  });

  it('uses dit=1u, intra=1u off, dah=3u for a single character', () => {
    expect(buildTimeline('.-', { wpm: 20 }).segments).toEqual([
      { on: true, ms: 60 },
      { on: false, ms: 60 },
      { on: true, ms: 180 },
    ]);
  });

  it('puts a 3u gap between characters', () => {
    expect(buildTimeline('. .', { wpm: 20 }).segments).toEqual([
      { on: true, ms: 60 },
      { on: false, ms: 180 },
      { on: true, ms: 60 },
    ]);
  });

  it('puts a 7u gap between words', () => {
    expect(buildTimeline('. / .', { wpm: 20 }).segments).toEqual([
      { on: true, ms: 60 },
      { on: false, ms: 420 },
      { on: true, ms: 60 },
    ]);
  });

  it('starts and ends ON and strictly alternates (valid vibrate pattern)', () => {
    const segs = buildTimeline('.... . .-.. .-.. ---', { wpm: 20 }).segments;
    expect(segs[0].on).toBe(true);
    expect(segs[segs.length - 1].on).toBe(true);
    for (let i = 1; i < segs.length; i++) expect(segs[i].on).toBe(!segs[i - 1].on);
  });

  it('normalizes stray (non dot/dash) tokens to a strictly alternating, ON-bounded stream', () => {
    // Reachable from decode-mode input like ".- ! -..." where '!' has no elements;
    // without merging this would emit two adjacent OFFs and corrupt vibrate/flash.
    for (const input of ['.- ! -...', 'x .-', '.- y']) {
      const segs = buildTimeline(input, { wpm: 20 }).segments;
      expect(segs[0].on).toBe(true);
      expect(segs[segs.length - 1].on).toBe(true);
      for (let i = 1; i < segs.length; i++) expect(segs[i].on).toBe(!segs[i - 1].on);
    }
  });

  it('clamps non-finite speeds instead of returning an empty timeline', () => {
    const tl = buildTimeline('.', { wpm: NaN, charWpm: NaN });
    expect(tl.segments.length).toBeGreaterThan(0);
    expect(Number.isFinite(tl.totalMs)).toBe(true);
    expect(Number.isFinite(tl.unitMs)).toBe(true);
  });
});

describe('buildTimeline (Farnsworth)', () => {
  it('charWpm === wpm reproduces standard 3u inter-character spacing', () => {
    const segs = buildTimeline('. .', { wpm: 18, charWpm: 18 }).segments;
    const u = 1200 / 18;
    expect(segs[0].ms).toBeCloseTo(u, 6);
    expect(segs[1].ms).toBeCloseTo(3 * u, 6); // inter-character gap
  });

  it('keeps elements at character speed but stretches the gaps', () => {
    const farns = buildTimeline('. .', { wpm: 5, charWpm: 18 }).segments;
    const stdSlow = buildTimeline('. .', { wpm: 5, charWpm: 5 }).segments;
    // element stays at the fast (character) speed...
    expect(farns[0].ms).toBeCloseTo(1200 / 18, 6);
    // ...while the inter-character gap is much larger than the un-Farnsworthed gap.
    expect(farns[1].ms).toBeGreaterThan(stdSlow[1].ms);
  });

  it('clamps overall speed to never exceed character speed', () => {
    // wpm 30 > charWpm 10 -> overall treated as 10; gaps must not go below 3u.
    const segs = buildTimeline('. .', { wpm: 30, charWpm: 10 }).segments;
    const u = 1200 / 10;
    expect(segs[1].ms).toBeGreaterThanOrEqual(3 * u - 1e-6);
  });
});

describe('timelineToWav', () => {
  const ascii = (bytes, off, len) =>
    String.fromCharCode(...bytes.slice(off, off + len));
  const u32 = (bytes, off) =>
    bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24);
  const u16 = (bytes, off) => bytes[off] | (bytes[off + 1] << 8);

  it('writes a canonical PCM WAV header', () => {
    const tl = buildTimeline('.', { wpm: 20 }); // 60 ms
    const bytes = timelineToWav(tl, { sampleRate: 8000 });
    expect(ascii(bytes, 0, 4)).toBe('RIFF');
    expect(ascii(bytes, 8, 4)).toBe('WAVE');
    expect(ascii(bytes, 12, 4)).toBe('fmt ');
    expect(ascii(bytes, 36, 4)).toBe('data');
    expect(u16(bytes, 20)).toBe(1);     // PCM
    expect(u16(bytes, 22)).toBe(1);     // mono
    expect(u32(bytes, 24)).toBe(8000);  // sample rate
    expect(u16(bytes, 34)).toBe(16);    // bits per sample
  });

  it('sizes the buffer to 44 + numSamples*2', () => {
    const tl = buildTimeline('.', { wpm: 20 }); // 60 ms -> 480 samples @ 8 kHz
    const bytes = timelineToWav(tl, { sampleRate: 8000 });
    const numSamples = Math.round((tl.totalMs / 1000) * 8000);
    expect(numSamples).toBe(480);
    expect(bytes.length).toBe(44 + numSamples * 2);
    expect(u32(bytes, 40)).toBe(numSamples * 2);     // data chunk size
    expect(u32(bytes, 4)).toBe(36 + numSamples * 2); // RIFF chunk size
  });

  it('produces a header-only file for an empty timeline', () => {
    const bytes = timelineToWav({ segments: [], totalMs: 0 }, { sampleRate: 8000 });
    expect(bytes.length).toBe(44);
  });

  it('writes audible (non-zero) samples for an ON segment', () => {
    const bytes = timelineToWav(buildTimeline('-', { wpm: 20 }), { sampleRate: 8000 });
    const anyNonZero = bytes.slice(44).some((b) => b !== 0);
    expect(anyNonZero).toBe(true);
  });

  it('ramps each ON segment down to ~zero at its end (no trailing click)', () => {
    const bytes = timelineToWav(buildTimeline('-', { wpm: 20 }), { sampleRate: 8000 });
    let v = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);
    if (v >= 0x8000) v -= 0x10000;
    expect(Math.abs(v)).toBeLessThan(50); // release reaches zero, not 1/rampSamples
  });
});
