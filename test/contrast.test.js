import { describe, it, expect } from 'vitest';
import { parseHex, toHex, relativeLuminance, contrastRatio, evaluate } from '../src/contrast/contrast.js';

describe('parseHex', () => {
  it('parses 6-digit, 3-digit, #-prefixed, and unprefixed hex', () => {
    expect(parseHex('#1a2b3c')).toEqual({ r: 26, g: 43, b: 60 });
    expect(parseHex('1A2B3C')).toEqual({ r: 26, g: 43, b: 60 });
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('returns null for invalid input (caller keeps the last valid value)', () => {
    for (const bad of ['', '#12', '#12345', 'red', '#ggg', '#1234567']) {
      expect(parseHex(bad)).toBeNull();
    }
  });

  it('toHex round-trips', () => {
    expect(toHex(parseHex('#1a2b3c'))).toBe('#1a2b3c');
  });
});

describe('WCAG math', () => {
  it('black/white is exactly 21:1 and white/white is 1:1', () => {
    const black = parseHex('#000000');
    const white = parseHex('#ffffff');
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it('is symmetric (order of colors does not matter)', () => {
    const a = parseHex('#336699');
    const b = parseHex('#ffcc00');
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it('matches a known reference value (#777 on white, raw ≈ 4.478 floored to 4.47)', () => {
    const r = evaluate(parseHex('#777777'), parseHex('#ffffff'));
    // Displayed ratio is FLOORED so it can never overstate the raw ratio the
    // badges are judged on (tools that round half-up show 4.48 here).
    expect(r.ratio).toBe(4.47);
    expect(r.passes.aaNormal).toBe(false); // the classic just-fails-AA gray
    expect(r.passes.aaLarge).toBe(true);
  });

  it('relative luminance of pure white is 1 and pure black is 0', () => {
    expect(relativeLuminance(parseHex('#ffffff'))).toBeCloseTo(1, 5);
    expect(relativeLuminance(parseHex('#000000'))).toBeCloseTo(0, 5);
  });

  it('evaluate applies all four AA/AAA thresholds', () => {
    const r = evaluate(parseHex('#000000'), parseHex('#ffffff'));
    expect(r.ratio).toBe(21);
    expect(r.passes).toEqual({ aaNormal: true, aaLarge: true, aaaNormal: true, aaaLarge: true });
    const mid = evaluate(parseHex('#949494'), parseHex('#ffffff')); // ~3.0:1
    expect(mid.passes.aaNormal).toBe(false);
    expect(mid.passes.aaaNormal).toBe(false);
  });
});

describe('displayed ratio never overstates the raw ratio', () => {
  it('floors instead of rounding half-up', () => {
    // Find a pair whose raw ratio sits just under a 2dp boundary and check the
    // display never rounds it up past what the badges were judged on.
    const a = { r: 118, g: 118, b: 118 };
    const b = { r: 255, g: 255, b: 255 };
    const raw = contrastRatio(a, b);
    const { ratio } = evaluate(a, b);
    expect(ratio).toBeLessThanOrEqual(raw);
    expect(ratio).toBe(Math.floor(raw * 100) / 100);
  });
});
