// Pure QR quality helpers: payload size, QR version, and color contrast for the
// scannability guard. No DOM, no globals — testable in isolation.

// UTF-8 byte length of a string (QR capacity is measured in bytes, not chars).
export function utf8ByteLength(str) {
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; } // surrogate pair → 4 bytes
    else bytes += 3;
  }
  return bytes;
}

// QR module count is 17 + 4 × version (version 1..40 → 21..177 modules square).
export function qrVersionFromSize(size) {
  return Math.round((size - 17) / 4);
}

function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// Relative luminance per WCAG 2.x.
function relLuminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// WCAG contrast ratio between two hex colors (1..21).
export function contrastRatio(hexA, hexB) {
  const la = relLuminance(hexToRgb(hexA));
  const lb = relLuminance(hexToRgb(hexB));
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Scannability guard: returns a warning string for risky color choices, or null.
// QR readers expect a DARK code on a LIGHT background with good contrast.
export function colorWarning(fg, bg) {
  const fgLum = relLuminance(hexToRgb(fg));
  const bgLum = relLuminance(hexToRgb(bg));
  if (fgLum > bgLum) {
    return 'Light code on a dark background (inverted). Many scanners fail on this — a dark code on a light background is most reliable.';
  }
  if (contrastRatio(fg, bg) < 3) {
    return 'Low contrast between the code and its background — this may not scan reliably.';
  }
  return null;
}
