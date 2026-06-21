// Image Resizer pure helpers. The canvas re-encode + EXIF-orientation read live
// in the UI (browser-only); these helpers are the testable math.

// Compute the output size. opts: { width, height, lock=true, percent }.
// - percent overrides width/height.
// - lock=true preserves aspect ratio (fits within a box if both given).
// - lock=false stretches to the given width/height.
export function computeTargetSize(srcW, srcH, opts = {}) {
  if (!(srcW > 0) || !(srcH > 0)) throw new Error('Source dimensions must be positive.');
  if (opts.percent != null) {
    const p = opts.percent / 100;
    return { width: Math.max(1, Math.round(srcW * p)), height: Math.max(1, Math.round(srcH * p)) };
  }
  const lock = opts.lock !== false;
  const hasW = opts.width != null && opts.width > 0;
  const hasH = opts.height != null && opts.height > 0;
  if (!hasW && !hasH) return { width: srcW, height: srcH };
  if (lock) {
    if (hasW && !hasH) return { width: Math.max(1, Math.round(opts.width)), height: Math.max(1, Math.round(opts.width * srcH / srcW)) };
    if (hasH && !hasW) return { width: Math.max(1, Math.round(opts.height * srcW / srcH)), height: Math.max(1, Math.round(opts.height)) };
    const scale = Math.min(opts.width / srcW, opts.height / srcH);
    return { width: Math.max(1, Math.round(srcW * scale)), height: Math.max(1, Math.round(srcH * scale)) };
  }
  return { width: hasW ? Math.max(1, Math.round(opts.width)) : srcW, height: hasH ? Math.max(1, Math.round(opts.height)) : srcH };
}

// EXIF orientation (1-8) → how to transform the canvas. `swap` means width/height
// are exchanged (90°/270° rotations). `flip` is a horizontal mirror.
export function orientationToTransform(n) {
  switch (n) {
    case 2: return { rotate: 0, flip: true, swap: false };
    case 3: return { rotate: 180, flip: false, swap: false };
    case 4: return { rotate: 180, flip: true, swap: false };
    case 5: return { rotate: 90, flip: true, swap: true };
    case 6: return { rotate: 90, flip: false, swap: true };
    case 7: return { rotate: 270, flip: true, swap: true };
    case 8: return { rotate: 270, flip: false, swap: true };
    default: return { rotate: 0, flip: false, swap: false };
  }
}
