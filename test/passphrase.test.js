import { describe, it, expect } from 'vitest';
import {
  generatePassphrase,
  generatorEntropyBits,
  secureRandomInt,
  WORDLIST_SIZE,
} from '../src/passphrase/generate.js';
import { estimateStrength, scoreToPercent, MASTER_MIN_SCORE, MASTER_MIN_LOG10, meetsMasterGate } from '../src/passphrase/strength.js';

const WL = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

describe('generatePassphrase', () => {
  it('uses the injected RNG deterministically', () => {
    let i = 0;
    const seq = [0, 1, 2, 3, 4, 5];
    const rng = () => seq[i++];
    const phrase = generatePassphrase({ words: 6, separator: '-' }, WL, rng);
    expect(phrase).toBe('alpha-bravo-charlie-delta-echo-foxtrot');
  });

  it('respects word count and separator', () => {
    const rng = () => 0;
    expect(generatePassphrase({ words: 3, separator: '.' }, WL, rng)).toBe('alpha.alpha.alpha');
  });

  it('capitalizes when asked', () => {
    const rng = () => 1;
    expect(generatePassphrase({ words: 2, capitalize: true }, WL, rng)).toBe('Bravo-Bravo');
  });

  it('appends a digit when asked', () => {
    let i = 0;
    const vals = [2, 2, 7]; // two words then the digit
    const rng = () => vals[i++];
    expect(generatePassphrase({ words: 2, appendDigit: true }, WL, rng)).toBe('charlie-charlie7');
  });

  it('rejects an empty wordlist', () => {
    expect(() => generatePassphrase({ words: 3 }, [], () => 0)).toThrow();
  });
});

describe('secureRandomInt', () => {
  it('stays within range and is reasonably uniform', () => {
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 6000; i++) {
      const v = secureRandomInt(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      counts[v]++;
    }
    // Each bucket should be in a sane band around 1000 (loose, just catches bias bugs).
    for (const c of counts) {
      expect(c).toBeGreaterThan(700);
      expect(c).toBeLessThan(1300);
    }
  });
});

describe('generatorEntropyBits', () => {
  it('computes word_count * log2(7776)', () => {
    expect(generatorEntropyBits({ words: 6 })).toBeCloseTo(6 * Math.log2(7776), 1);
    expect(generatorEntropyBits({ words: 4 })).toBeCloseTo(4 * Math.log2(7776), 1);
  });

  it('adds log2(10) for an appended digit', () => {
    const base = 5 * Math.log2(WORDLIST_SIZE);
    expect(generatorEntropyBits({ words: 5, appendDigit: true })).toBeCloseTo(base + Math.log2(10), 1);
  });
});

// The strength meter is now backed by zxcvbn (the vendored global, set on
// globalThis by test/setup.js). These tests assert the vault master-password GATE
// (zxcvbn score 4) and the meter shape — NOT zxcvbn's internal scoring.
describe('estimateStrength (zxcvbn-backed)', () => {
  it('treats empty input as zero with the em-dash label', () => {
    expect(estimateStrength('')).toEqual({ score: 0, guessesLog10: 0, bits: 0, label: '—', length: 0, warning: '', suggestions: [] });
  });

  it('rejects weak passwords below the vault gate (score < 4) — including the heuristic-era bypasses', () => {
    // The old hand-rolled estimator rated several of these "Very strong" and let them
    // clear the master-password gate; zxcvbn must reject them all.
    for (const p of ['password', 'hunter2', 'password1', 'AAAAaaaa1111!!!!', 'horsehorse99',
      'abcde'.repeat(52), 'qwerty123', 'aaaabbbbccccdddd']) {
      const r = estimateStrength(p);
      expect(r.score).toBeLessThan(MASTER_MIN_SCORE);
      expect(r.label).not.toBe('Very strong');
    }
  });

  it('passes a genuinely strong passphrase at the vault gate (score 4)', () => {
    for (const p of ['correct horse battery staple', 'Abacus-Abdomen-Trombone-Relish-Battery',
      'Xk9$mQ2!vR7p', 'My-Dog-Has-Fleas-2024']) {
      const r = estimateStrength(p);
      expect(r.score).toBe(4);
      expect(r.label).toBe('Very strong');
    }
  });

  it('exposes a bits readout derived from zxcvbn guesses', () => {
    const r = estimateStrength('correct horse battery staple');
    expect(typeof r.bits).toBe('number');
    expect(r.bits).toBeGreaterThan(40);
  });

  it('the vault gate threshold is zxcvbn score 4 ("strong protection from offline slow-hash")', () => {
    expect(MASTER_MIN_SCORE).toBe(4);
  });

  it('maps score to an increasing meter percentage', () => {
    expect(scoreToPercent(0)).toBe(10);
    expect(scoreToPercent(4)).toBe(100);
    expect(scoreToPercent(0)).toBeLessThan(scoreToPercent(4));
  });

  it('caps the analysed length so a huge paste cannot pass the gate or freeze the field', () => {
    const r = estimateStrength('a'.repeat(100000)); // analysed as the first 100 'a' -> very weak
    expect(r.score).toBeLessThan(MASTER_MIN_SCORE);
    expect(r.length).toBe(100000); // the TRUE length is still reported for display
  });

  it('fails CLOSED when the zxcvbn engine is unavailable (gate never passes an unrated password)', () => {
    const saved = globalThis.zxcvbn;
    try {
      delete globalThis.zxcvbn;
      const r = estimateStrength('correct horse battery staple');
      expect(r.score).toBe(0);
      expect(r.label).toBe('Very weak');
      // The vault create flow surfaces this warning so the fail-closed case is not
      // misread as a merely "weak" password — keep the exact contract string.
      expect(r.warning).toBe('Strength checker unavailable.');
    } finally {
      globalThis.zxcvbn = saved;
    }
  });
});

// The vault master gate is score 4 AND a guesses floor (~zxcvbn log10(guesses) 11),
// not score alone — so a long-but-low-entropy password that reaches score 4 (e.g.
// "correcthorsebattery") is still rejected, while every generator output (>=4-word
// passphrase / >=16-char random) clears it.
describe('meetsMasterGate (score 4 AND guesses floor)', () => {
  it('rejects a long-but-low-entropy score-4 password under the guesses floor', () => {
    const r = estimateStrength('correcthorsebattery');
    expect(r.score).toBe(4); // zxcvbn score alone would have passed it
    expect(r.guessesLog10).toBeLessThan(MASTER_MIN_LOG10);
    expect(meetsMasterGate(r)).toBe(false);
  });

  it('accepts a genuine passphrase that clears both the score and the floor', () => {
    for (const p of ['correct horse battery staple', 'My-Dog-Has-Fleas-2024', 'Xk9$mQ2!vR7p']) {
      const r = estimateStrength(p);
      expect(r.score).toBe(MASTER_MIN_SCORE);
      expect(r.guessesLog10).toBeGreaterThanOrEqual(MASTER_MIN_LOG10);
      expect(meetsMasterGate(r)).toBe(true);
    }
  });

  it('the gate floor is zxcvbn log10(guesses) >= 11 (compared on the raw value, not rounded bits)', () => {
    expect(MASTER_MIN_LOG10).toBe(11);
    // A password whose raw guesses sits just under 11 must be rejected even if its
    // rounded display "bits" would land on the old 36.5 boundary.
    const r = estimateStrength('correcthorsebattery');
    expect(r.guessesLog10).toBeLessThan(MASTER_MIN_LOG10);
    expect(meetsMasterGate(r)).toBe(false);
  });

  it('does not meet the gate when the engine is unavailable (fails closed)', () => {
    const saved = globalThis.zxcvbn;
    try {
      delete globalThis.zxcvbn;
      expect(meetsMasterGate(estimateStrength('correct horse battery staple'))).toBe(false);
    } finally {
      globalThis.zxcvbn = saved;
    }
  });
});
