import { describe, it, expect } from 'vitest';
import {
  generatePassphrase,
  generatorEntropyBits,
  secureRandomInt,
  WORDLIST_SIZE,
} from '../src/passphrase/generate.js';
import {
  estimateStrength,
  labelForBits,
  PENALTY_IDENTICAL,
  PENALTY_SEQUENTIAL,
  PENALTY_COMMON,
} from '../src/passphrase/strength.js';

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

describe('estimateStrength', () => {
  it('treats empty input as zero', () => {
    expect(estimateStrength('')).toEqual({ bits: 0, label: '—', length: 0, classSize: 0, penalties: [] });
  });

  it('rates a strong mixed password highly', () => {
    const r = estimateStrength('Tr0ub4d# relish9X');
    expect(r.bits).toBeGreaterThan(80);
    expect(r.label).toBe('Very strong');
  });

  it('penalizes all-identical characters', () => {
    const r = estimateStrength('aaaaaa');
    const base = 6 * Math.log2(26);
    expect(r.bits).toBeCloseTo(base - PENALTY_IDENTICAL, 1);
    expect(r.penalties).toContain('repeated character');
  });

  it('penalizes a sequential run', () => {
    const r = estimateStrength('abcdef');
    const base = 6 * Math.log2(26);
    expect(r.bits).toBeCloseTo(base - PENALTY_SEQUENTIAL, 1);
    expect(r.penalties).toContain('sequential run');
  });

  it('penalizes a common password', () => {
    const r = estimateStrength('password');
    expect(r.penalties).toContain('common password');
    expect(r.label).toBe('Very weak');
  });

  it('penalizes a keyboard walk (qwerty)', () => {
    const r = estimateStrength('qwerty');
    expect(r.penalties).toContain('keyboard pattern');
  });

  it('sees through leetspeak on a common word (w3lc0m3 -> welcome)', () => {
    const r = estimateStrength('w3lc0m3');
    expect(r.penalties).toContain('common password pattern');
    expect(['Very weak', 'Weak']).toContain(r.label);
  });

  it('still rates a literal listed leet password as a common password', () => {
    expect(estimateStrength('p@ssw0rd').penalties).toContain('common password');
  });

  it('does not let a common word + trailing digit/symbol read as strong', () => {
    const r = estimateStrength('Password1!');
    expect(r.penalties).toContain('common password pattern');
    expect(['Strong', 'Very strong']).not.toContain(r.label);
  });

  it('never returns negative bits', () => {
    expect(estimateStrength('111111').bits).toBeGreaterThanOrEqual(0);
  });

  it('maps bits to labels at the boundaries', () => {
    expect(labelForBits(0)).toBe('—');
    expect(labelForBits(20)).toBe('Very weak');
    expect(labelForBits(35)).toBe('Weak');
    expect(labelForBits(50)).toBe('Fair');
    expect(labelForBits(70)).toBe('Strong');
    expect(labelForBits(90)).toBe('Very strong');
  });
});
