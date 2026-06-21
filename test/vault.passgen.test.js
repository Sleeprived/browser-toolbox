import { describe, it, expect } from 'vitest';
import { generatePassword, CHARSETS } from '../src/vault/passgen.js';

const inUnion = (s, union) => [...s].every((c) => union.includes(c));

describe('generatePassword', () => {
  it('respects the requested length', () => {
    const all = CHARSETS.lower + CHARSETS.upper + CHARSETS.digits + CHARSETS.symbols;
    const pw = generatePassword({ length: 32 });
    expect(pw).toHaveLength(32);
    expect(inUnion(pw, all)).toBe(true);
  });

  it('uses only the selected character classes', () => {
    const pw = generatePassword({ length: 24, lower: false, upper: false, digits: true, symbols: false });
    expect(pw).toMatch(/^[0-9]{24}$/);
  });

  it('guarantees at least one character from each selected class', () => {
    // The guarantee holds for any RNG; pin one for determinism.
    const pw = generatePassword({ length: 8 }, () => 0);
    expect(pw).toHaveLength(8);
    expect(/[a-z]/.test(pw)).toBe(true);
    expect(/[A-Z]/.test(pw)).toBe(true);
    expect(/[0-9]/.test(pw)).toBe(true);
    expect([...pw].some((c) => CHARSETS.symbols.includes(c))).toBe(true);
  });

  it('throws when no character class is selected', () => {
    expect(() => generatePassword({ lower: false, upper: false, digits: false, symbols: false }))
      .toThrow(/at least one/i);
  });

  it('throws when length is too short to include each selected class', () => {
    expect(() => generatePassword({ length: 3 })).toThrow(/at least 4/i);
  });

  it('throws on a non-positive length', () => {
    expect(() => generatePassword({ length: 0, digits: true, lower: false, upper: false, symbols: false }))
      .toThrow(/positive integer/i);
  });

  it('is deterministic for a given injected RNG', () => {
    const seeded = () => { let n = 0; return (max) => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n % max; }; };
    const a = generatePassword({ length: 40 }, seeded());
    const b = generatePassword({ length: 40 }, seeded());
    expect(a).toBe(b);
  });

  it('defaults to a 20-char password using all classes', () => {
    const all = CHARSETS.lower + CHARSETS.upper + CHARSETS.digits + CHARSETS.symbols;
    const pw = generatePassword();
    expect(pw).toHaveLength(20);
    expect(inUnion(pw, all)).toBe(true);
  });
});
