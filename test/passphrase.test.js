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

  it('penalizes all-identical characters and caps them low regardless of length', () => {
    const short = estimateStrength('aaaaaa');
    expect(short.penalties).toContain('repeated character');
    expect(short.label).toBe('Very weak');
    // audit-6 M1: a LONG identical string must NOT inflate to Strong via length.
    const long = estimateStrength('aaaaaaaaaaaaaaaaaaaaaaaa'); // 24 'a'
    expect(long.label).toBe('Very weak');
    expect(long.bits).toBeLessThan(28);
  });

  it('penalizes and caps a dominant sequential run', () => {
    // "abcdef" is a pure ascending walk — real guessing cost is tiny, so it is
    // CAPPED to low-diversity bits (not just flat-penalized) and reads Very weak.
    const r = estimateStrength('abcdef');
    expect(r.penalties).toContain('sequential run');
    expect(r.bits).toBeCloseTo(Math.log2(26) + Math.log2(6), 1);
    expect(r.label).toBe('Very weak');
  });

  it('only flat-penalizes an incidental short run in an otherwise strong password', () => {
    // A 3-char run ("abc") that does NOT dominate an otherwise high-entropy,
    // non-dictionary password must stay strong (flat penalty, no cap). The string
    // is deliberately free of dictionary words so the dictionary-composition cap
    // (audit-8) does not apply here — this test is about sequential runs.
    const r = estimateStrength('Kp7-Zq9-abc-Vm4!xR');
    expect(r.penalties).toContain('sequential run');
    expect(r.penalties).not.toContain('dictionary words');
    expect(['Strong', 'Very strong']).toContain(r.label);
  });

  it('caps a long sequential walk so it cannot pass the vault master gate (60 bits)', () => {
    for (const p of ['ABCDEFGHIJKLMNOP', 'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlk', 'Abcdefghijklmno']) {
      const r = estimateStrength(p);
      expect(r.bits).toBeLessThan(60);
      expect(['Strong', 'Very strong']).not.toContain(r.label);
    }
  });

  it('caps a multi-row keyboard walk so it cannot pass the vault master gate (60 bits)', () => {
    const r = estimateStrength('qwertyuiopasdfghjkl');
    expect(r.penalties).toContain('keyboard pattern');
    expect(r.bits).toBeLessThan(60);
    expect(['Strong', 'Very strong']).not.toContain(r.label);
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
    expect(labelForBits(0, false)).toBe('—');   // empty input
    expect(labelForBits(0)).toBe('Very weak');  // non-empty, zero bits
    expect(labelForBits(20)).toBe('Very weak');
    expect(labelForBits(35)).toBe('Weak');
    expect(labelForBits(50)).toBe('Fair');
    expect(labelForBits(70)).toBe('Strong');
    expect(labelForBits(90)).toBe('Very strong');
  });

  it('does not flag alternating patterns as a sequential run', () => {
    const r = estimateStrength('ababab');
    expect(r.penalties).not.toContain('sequential run');
  });

  it('still flags a true ascending run', () => {
    expect(estimateStrength('abcdef').penalties).toContain('sequential run');
  });

  it('penalizes a doubled dictionary word so it cannot read as Strong', () => {
    const r = estimateStrength('passwordpassword'); // "password" x2; not in common list as a whole
    expect(r.penalties).toContain('repeated word');
    expect(['Strong', 'Very strong']).not.toContain(r.label);
  });

  it('M2: flags a 2-character alternating pattern as a repeated word', () => {
    expect(estimateStrength('ababab').penalties).toContain('repeated word');
    const long = estimateStrength('ababababababab'); // 14 chars; read "Strong" before the fix
    expect(['Strong', 'Very strong']).not.toContain(long.label);
  });

  it('m3: caps a mostly-identical password with a tiny suffix', () => {
    const r = estimateStrength('aaaaaaaaaaaa12'); // 12 a's + "12"; read "Strong" before the fix
    expect(['Strong', 'Very strong']).not.toContain(r.label);
    expect(r.penalties).toContain('few unique characters');
  });

  it('BA7-1: caps a repeated multi-character unit so it cannot pass the vault gate', () => {
    // "Aa1!Aa1!Aa1!" (a 4-distinct unit repeated) read 62.8 bits "Strong" and passed
    // the vault's 60-bit master-password gate before the audit-7 cap.
    for (const p of ['Aa1!Aa1!Aa1!', 'aB2@aB2@aB2@', 'Qw9#Qw9#Qw9#', 'aA1!aA1!aA1!aA1!aA1!']) {
      const r = estimateStrength(p);
      expect(r.penalties).toContain('repeated word');
      expect(r.bits).toBeLessThan(60);
      expect(['Strong', 'Very strong']).not.toContain(r.label);
    }
  });

  it('does NOT add a repeated-word penalty to an all-identical string', () => {
    // "aaaaaa" is covered by the identical-character penalty only — the
    // repeated-word check must not double-count it.
    expect(estimateStrength('aaaaaa').penalties).not.toContain('repeated word');
  });

  it('labels a non-empty low-entropy password as Very weak, not em-dash', () => {
    const r = estimateStrength('aaaaaa'); // identical → ~10 bits
    expect(r.label).toBe('Very weak');
  });

  // audit-8: the strength meter used to score multi-word / repeated
  // dictionary-word compositions by length*log2(charset), so "password password"
  // read 100 bits and passed the vault's 60-bit master gate. They now cap to a
  // diceware-style word-count estimate and fail the gate.
  it('caps multi-word and repeated dictionary-word compositions below the 60-bit master gate', () => {
    for (const p of [
      'password password', 'passwordmonkey', 'admin99admin', 'master99master',
      'letmein letmein', 'baseballfootball', 'welcomemaster', 'monkey.monkey',
    ]) {
      const r = estimateStrength(p);
      expect(r.penalties).toContain('dictionary words');
      expect(r.bits).toBeLessThan(60);
      expect(['Strong', 'Very strong']).not.toContain(r.label);
    }
  });

  it('still passes a genuinely random 5+-word generated passphrase', () => {
    // Mimics the vault generator output: distinct EFF words, hyphen-separated,
    // capitalized. The dictionary cap must NOT push real generated output below 60.
    const five = estimateStrength('Abacus-Abdomen-Trombone-Relish-Battery');
    expect(five.bits).toBeGreaterThanOrEqual(60);
    expect(['Strong', 'Very strong']).toContain(five.label);
    const six = estimateStrength('Abacus-Abdomen-Trombone-Relish-Battery-Staple');
    expect(six.bits).toBeGreaterThanOrEqual(60);
  });

  it('does not treat a single dictionary word amid non-dictionary noise as a composition', () => {
    const r = estimateStrength('Tr0ub4d# relish9X'); // only "relish" is a dictionary word
    expect(r.penalties).not.toContain('dictionary words');
    expect(r.bits).toBeGreaterThan(80);
  });
});
