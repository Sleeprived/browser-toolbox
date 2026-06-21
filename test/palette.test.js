import { describe, it, expect } from 'vitest';
import { medianCut, quantize, rgbToHex, pixelsFromRgba } from '../src/palette/quantize.js';

function rgbaBuffer(colors) {
  // colors: array of [r,g,b,count]; build a flat RGBA Uint8 array (opaque).
  const out = [];
  for (const [r, g, b, count] of colors) {
    for (let i = 0; i < count; i++) out.push(r, g, b, 255);
  }
  return new Uint8Array(out);
}

function nearest(palette, target) {
  let best = Infinity;
  let bestColor = null;
  for (const c of palette) {
    const d = (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2 + (c[2] - target[2]) ** 2;
    if (d < best) { best = d; bestColor = c; }
  }
  return { dist: Math.sqrt(best), color: bestColor };
}

describe('rgbToHex', () => {
  it('formats and clamps channels', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 128, 255)).toBe('#0080ff');
    expect(rgbToHex(300, -5, 10)).toBe('#ff000a');
  });
});

describe('medianCut', () => {
  it('extracts red and blue from a 60/40 red/blue image', () => {
    const pixels = pixelsFromRgba(rgbaBuffer([[255, 0, 0, 60], [0, 0, 255, 40]]));
    const palette = medianCut(pixels, 2);
    expect(palette.length).toBe(2);
    expect(nearest(palette, [255, 0, 0]).dist).toBeLessThan(20);
    expect(nearest(palette, [0, 0, 255]).dist).toBeLessThan(20);
  });

  it('returns a single color for a solid image', () => {
    const pixels = pixelsFromRgba(rgbaBuffer([[10, 200, 90, 50]]));
    const palette = medianCut(pixels, 6);
    expect(palette.length).toBe(1);
    expect(palette[0]).toEqual([10, 200, 90]);
  });

  it('separates three distinct clusters', () => {
    const pixels = pixelsFromRgba(rgbaBuffer([
      [240, 10, 10, 30],
      [10, 240, 10, 30],
      [10, 10, 240, 30],
    ]));
    const palette = medianCut(pixels, 3);
    expect(palette.length).toBe(3);
    expect(nearest(palette, [240, 10, 10]).dist).toBeLessThan(25);
    expect(nearest(palette, [10, 240, 10]).dist).toBeLessThan(25);
    expect(nearest(palette, [10, 10, 240]).dist).toBeLessThan(25);
  });

  it('never returns more colors than requested', () => {
    const pixels = pixelsFromRgba(rgbaBuffer([
      [1, 2, 3, 10], [250, 250, 250, 10], [120, 60, 180, 10], [9, 200, 30, 10],
    ]));
    expect(medianCut(pixels, 2).length).toBeLessThanOrEqual(2);
  });

  it('handles empty input', () => {
    expect(medianCut([], 6)).toEqual([]);
  });

  it('spreads a smooth grayscale ramp evenly instead of peeling near-black slivers', () => {
    // 256-step grayscale ramp (0..255), one pixel per step.
    const ramp = [];
    for (let v = 0; v < 256; v++) ramp.push([v, v, v, 1]);
    const pixels = pixelsFromRgba(rgbaBuffer(ramp));
    const palette = medianCut(pixels, 6);
    expect(palette.length).toBe(6);

    // Each palette entry is gray (r==g==b); sort by gray value.
    const grays = palette.map((c) => c[0]).sort((a, b) => a - b);

    // On the old "first 1-step gap wins" split, the ramp degenerated into five
    // near-black slivers plus one huge bucket — the top gray sat far below 255
    // and the largest gap between consecutive palette grays was enormous.
    let maxGap = 0;
    for (let i = 1; i < grays.length; i++) {
      maxGap = Math.max(maxGap, grays[i] - grays[i - 1]);
    }
    // With 6 colors spread across 0..255 the ideal spacing is ~42; allow slack
    // but reject the degenerate case (one ~250 gap, five tiny ones).
    expect(maxGap).toBeLessThan(70);
    // The palette must actually reach toward both ends of the ramp.
    expect(grays[0]).toBeLessThan(40);
    expect(grays[grays.length - 1]).toBeGreaterThan(215);
  });
});

describe('pixelsFromRgba', () => {
  it('skips fully transparent pixels', () => {
    const rgba = new Uint8Array([255, 0, 0, 0, /* transparent */ 0, 255, 0, 255]);
    expect(pixelsFromRgba(rgba)).toEqual([[0, 255, 0]]);
  });

  it('skips near-transparent pixels, not just alpha===0', () => {
    // one opaque red, one barely-visible blue (alpha 8) -> blue is ignored.
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 8]);
    const px = pixelsFromRgba(rgba);
    expect(px).toEqual([[255, 0, 0]]);
  });
});

describe('quantize', () => {
  it('returns colors with hex strings', () => {
    const pixels = pixelsFromRgba(rgbaBuffer([[255, 0, 0, 10]]));
    expect(quantize(pixels, 1)).toEqual([{ r: 255, g: 0, b: 0, hex: '#ff0000' }]);
  });
});
