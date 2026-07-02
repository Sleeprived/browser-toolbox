// WCAG 2.x contrast math. Pure — no DOM.
//
// parseHex('#1a2b3c' | '#abc') → { r, g, b } | null
// contrastRatio(rgb1, rgb2)    → ratio (1..21), unrounded
// evaluate(rgb1, rgb2)         → { ratio (2dp), passes: {aaNormal, aaLarge, aaaNormal, aaaLarge} }

export function parseHex(input) {
  const s = String(input ?? '').trim().replace(/^#/, '');
  let hex;
  if (/^[0-9a-f]{6}$/i.test(s)) hex = s;
  else if (/^[0-9a-f]{3}$/i.test(s)) hex = s.split('').map((c) => c + c).join('');
  else return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }) {
  const h = (v) => v.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// WCAG 2.x relative luminance of an sRGB color.
export function relativeLuminance({ r, g, b }) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : (((c + 0.055) / 1.055) ** 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// WCAG 2.1 thresholds: AA 4.5:1 normal / 3:1 large; AAA 7:1 normal / 4.5:1 large.
export function evaluate(rgb1, rgb2) {
  const raw = contrastRatio(rgb1, rgb2);
  // Floor, not round: pass/fail uses the raw ratio, so the displayed value
  // must never overstate it (raw 4.4999 shown as "4.50" beside an AA Fail).
  const ratio = Math.floor(raw * 100) / 100;
  return {
    ratio,
    passes: {
      aaNormal: raw >= 4.5,
      aaLarge: raw >= 3,
      aaaNormal: raw >= 7,
      aaaLarge: raw >= 4.5,
    },
  };
}
