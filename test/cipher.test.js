import { describe, it, expect } from 'vitest';
import { GRID, textToTaps, tapsToText } from '../src/cipher/tapcode.js';
import { CODE, textToBacon, baconToText } from '../src/cipher/baconian.js';
import { LETTERS as PIG_LETTERS, glyphFor, textToPigpen } from '../src/cipher/pigpen.js';
import { LETTERS as SEM_LETTERS, anglesFor, textToSemaphore } from '../src/cipher/semaphore.js';

describe('tapcode', () => {
  it('encodes letters as row-col pairs, words with / ', () => {
    expect(textToTaps('HELLO').code).toBe('2-3 1-5 3-1 3-1 3-4');
    expect(textToTaps('HI THERE').code).toBe('2-3 2-4 / 4-4 2-3 1-5 4-2 1-5');
  });

  it('is case-insensitive', () => {
    expect(textToTaps('hello').code).toBe(textToTaps('HELLO').code);
  });

  it('sends K as C (1-3) on encode and cannot recover it on decode', () => {
    expect(textToTaps('K').code).toBe('1-3');
    expect(textToTaps('MILK').code).toBe('3-2 2-4 3-1 1-3');
    expect(tapsToText('3-2 2-4 3-1 1-3')).toBe('MILC'); // K -> C, unrecoverable
  });

  it('round-trips K-free text', () => {
    const text = 'SECRET MESSAGE AT NOON';
    expect(tapsToText(textToTaps(text).code)).toBe(text);
  });

  it('decodes dash, run-together, and bare-space digit forms identically', () => {
    expect(tapsToText('2-3 1-5')).toBe('HE');
    expect(tapsToText('23 15')).toBe('HE');
    expect(tapsToText('2 3 1 5')).toBe('HE');
  });

  it('maps an out-of-range pair or odd trailing digit to U+FFFD without blanking', () => {
    expect(tapsToText('0-1')).toBe('�');
    expect(tapsToText('6-3')).toBe('�');
    expect(tapsToText('2-3 1')).toBe('H�');
    expect(tapsToText('2-3 9-9 3-4')).toBe('H�O');
  });

  it('splits decoded words on / and on 3+ spaces, joining with a single space', () => {
    expect(tapsToText('2-3 1-5 / 3-1')).toBe('HE L');
    expect(tapsToText('2-3 1-5   3-1')).toBe('HE L'); // 3+ spaces = word break
  });

  it('rejects a bad second digit and drops a digit-less word', () => {
    expect(tapsToText('3-6')).toBe('�');        // column out of range (second digit)
    expect(tapsToText('xx / 1-1')).toBe('A');   // a word with no digits is dropped, not blank
  });

  it('reports unsupported characters in skipped (deduped, in order)', () => {
    const r = textToTaps('A1B1');
    expect(r.code).toBe('1-1 1-2');
    expect(r.skipped).toEqual(['1']);
  });

  it('returns empty for blank input and never throws', () => {
    expect(textToTaps('').code).toBe('');
    expect(textToTaps('   ').code).toBe('');
    expect(tapsToText('')).toBe('');
  });

  it('GRID is 5x5 with 25 unique letters and no K', () => {
    const flat = GRID.flat();
    expect(flat.length).toBe(25);
    expect(new Set(flat).size).toBe(25);
    expect(flat).not.toContain('K');
  });
});

describe('baconian', () => {
  it('has 26 distinct 5-char A/B codes', () => {
    const codes = Object.values(CODE);
    expect(codes.length).toBe(26);
    expect(new Set(codes).size).toBe(26);
    for (const c of codes) expect(c).toMatch(/^[AB]{5}$/);
  });

  it('matches known anchor codes', () => {
    expect(CODE.A).toBe('AAAAA');
    expect(CODE.H).toBe('AABBB');
    expect(CODE.I).toBe('ABAAA');
    expect(CODE.K).toBe('ABABA'); // distinct-26 variant (classic 24-letter is ABABB)
    expect(CODE.Z).toBe('BBAAB');
  });

  it('encodes letters and words', () => {
    expect(textToBacon('HI').code).toBe('AABBB ABAAA');
    expect(textToBacon('HI YOU').code).toBe('AABBB ABAAA / BBAAA ABBBA BABAA');
  });

  it('round-trips the whole alphabet', () => {
    const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    expect(baconToText(textToBacon(text).code)).toBe(text);
  });

  it('decodes lower-case, the 0/1 variant, and a mixed group', () => {
    expect(baconToText('aabbb abaaa')).toBe('HI');
    expect(baconToText('00111 01000')).toBe('HI');
    expect(baconToText('A1AAB')).toBe('J'); // A,1->B,A,A,B = ABAAB
  });

  it('maps a short or invalid group to U+FFFD', () => {
    expect(baconToText('AABB')).toBe('�');       // only 4 symbols
    expect(baconToText('AABBB AAB')).toBe('H�');  // second group short
  });

  it('reports non-letters in skipped and never throws', () => {
    const r = textToBacon('A!B!');
    expect(r.code).toBe('AAAAA AAAAB');
    expect(r.skipped).toEqual(['!']);
    expect(baconToText('')).toBe('');
  });
});

const key = (g) => `${g.edges.top}${g.edges.right}${g.edges.bottom}${g.edges.left}|${g.chevron}|${g.dot}`;

describe('pigpen', () => {
  it('has a glyph for every A–Z and 26 distinct descriptors', () => {
    expect(PIG_LETTERS).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    const seen = new Set();
    for (const ch of PIG_LETTERS) {
      const g = glyphFor(ch);
      expect(g).not.toBeNull();
      seen.add(key(g));
    }
    expect(seen.size).toBe(26);
  });

  it('assigns groups and dots per the standard variant', () => {
    // group 1 (A–I) plain tic-tac-toe; group 2 (J–R) dotted; group 3 (S–V) plain X; group 4 (W–Z) dotted X
    expect(glyphFor('A')).toEqual({ edges: { top: false, right: true, bottom: true, left: false }, chevron: null, dot: false });
    expect(glyphFor('E')).toEqual({ edges: { top: true, right: true, bottom: true, left: true }, chevron: null, dot: false });
    expect(glyphFor('N').dot).toBe(true);   // group 2
    expect(glyphFor('N').chevron).toBe(null);
    expect(glyphFor('S')).toEqual({ edges: { top: false, right: false, bottom: false, left: false }, chevron: 'up', dot: false });
    expect(glyphFor('W')).toEqual({ edges: { top: false, right: false, bottom: false, left: false }, chevron: 'up', dot: true });
    // lock the full chosen X-limb convention: S/W=up, T/X=right, U/Y=down, V/Z=left
    expect(glyphFor('T').chevron).toBe('right');
    expect(glyphFor('U').chevron).toBe('down');
    expect(glyphFor('V').chevron).toBe('left');
    expect(glyphFor('Z').chevron).toBe('left');
  });

  it('splits text into letters with word breaks and skips non-letters', () => {
    const r = textToPigpen('Hi! Yo');
    expect(r.letters).toEqual(['H', 'I', '', 'Y', 'O']);
    expect(r.skipped).toEqual(['!']);
  });

  it('distinguishes the dotted/undotted X glyphs only by the dot (S vs W)', () => {
    expect(glyphFor('S').dot).toBe(false);
    expect(glyphFor('W').dot).toBe(true);
    expect(glyphFor('S').chevron).toBe(glyphFor('W').chevron); // same chevron direction
  });

  it('returns null for non-letters', () => {
    expect(glyphFor('1')).toBeNull();
    expect(glyphFor(' ')).toBeNull();
  });
});

describe('semaphore', () => {
  it('has angles for every A–Z, all distinct, multiples of 45 in [0,360), with left != right', () => {
    expect(SEM_LETTERS).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    const seen = new Set();
    for (const ch of SEM_LETTERS) {
      const a = anglesFor(ch);
      expect(a).not.toBeNull();
      expect(a.left % 45).toBe(0);
      expect(a.right % 45).toBe(0);
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.left).toBeLessThan(360);
      expect(a.right).toBeGreaterThanOrEqual(0);
      expect(a.right).toBeLessThan(360);
      expect(a.left).not.toBe(a.right);
      seen.add(`${Math.min(a.left, a.right)},${Math.max(a.left, a.right)}`);
    }
    expect(seen.size).toBe(26);
  });

  it('matches canonical distinctive figures', () => {
    const set = (ch) => { const a = anglesFor(ch); return [a.left, a.right].sort((x, y) => x - y); };
    expect(set('R')).toEqual([90, 270]);  // horizontal line
    expect(set('U')).toEqual([45, 315]);  // up-V
    expect(set('N')).toEqual([135, 225]); // down-V
    expect(set('D')).toEqual([0, 180]);   // vertical
  });

  it('locks the exact agreed angle table for all 26 letters', () => {
    // Snapshot so any future edit or transposition fails loudly (the unordered
    // distinctness check above cannot catch a left/right swap or a two-letter swap).
    const expected = {
      A: { left: 225, right: 180 }, B: { left: 270, right: 180 }, C: { left: 315, right: 180 },
      D: { left: 180, right: 0 }, E: { left: 180, right: 45 }, F: { left: 180, right: 90 },
      G: { left: 180, right: 135 }, H: { left: 270, right: 225 }, I: { left: 315, right: 225 },
      J: { left: 90, right: 0 }, K: { left: 225, right: 0 }, L: { left: 225, right: 45 },
      M: { left: 225, right: 90 }, N: { left: 225, right: 135 }, O: { left: 315, right: 270 },
      P: { left: 270, right: 0 }, Q: { left: 270, right: 45 }, R: { left: 270, right: 90 },
      S: { left: 270, right: 135 }, T: { left: 315, right: 0 }, U: { left: 315, right: 45 },
      V: { left: 135, right: 0 }, W: { left: 90, right: 45 }, X: { left: 135, right: 45 },
      Y: { left: 315, right: 90 }, Z: { left: 135, right: 90 },
    };
    for (const ch of SEM_LETTERS) expect(anglesFor(ch)).toEqual(expected[ch]);
  });

  it('returns null for non-letters', () => {
    expect(anglesFor('1')).toBeNull();
  });

  it('splits text into letters with word breaks', () => {
    expect(textToSemaphore('SOS!').letters).toEqual(['S', 'O', 'S']);
    expect(textToSemaphore('SOS!').skipped).toEqual(['!']);
    expect(textToSemaphore('A B').letters).toEqual(['A', '', 'B']);
    expect(textToSemaphore('  A   B  ').letters).toEqual(['A', '', 'B']); // trims, no empty edge breaks
  });
});
