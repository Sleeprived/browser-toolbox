// Color palette extraction via the median-cut algorithm. Pure functions that
// operate on raw pixel data — no DOM, no canvas (the UI does the canvas read
// and downscaling, then hands pixels here).

export function rgbToHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

// Collect [r,g,b] triples from a flat RGBA Uint8 array, skipping fully
// transparent pixels.
export function pixelsFromRgba(rgba) {
  const out = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue; // skip transparent
    out.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  return out;
}

function channelRange(pixels, ch) {
  let min = 255;
  let max = 0;
  for (const p of pixels) {
    if (p[ch] < min) min = p[ch];
    if (p[ch] > max) max = p[ch];
  }
  return max - min;
}

function averageColor(pixels) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of pixels) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = pixels.length || 1;
  return [r / n, g / n, b / n];
}

// medianCut(pixels, maxColors): pixels is an array of [r,g,b]. Returns up to
// maxColors representative [r,g,b] colors. Buckets are split along the channel
// with the widest spread, at the median, until the target count is reached.
export function medianCut(pixels, maxColors = 6) {
  if (!Array.isArray(pixels) || pixels.length === 0) return [];
  if (maxColors < 1) return [];

  let buckets = [pixels.slice()];

  while (buckets.length < maxColors) {
    // Pick the bucket with the largest single-channel range that can still split.
    let target = -1;
    let bestRange = -1;
    let bestCh = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        const range = channelRange(buckets[i], ch);
        if (range > bestRange) {
          bestRange = range;
          target = i;
          bestCh = ch;
        }
      }
    }
    if (target === -1 || bestRange === 0) break; // nothing left worth splitting

    const bucket = buckets[target];
    bucket.sort((a, b) => a[bestCh] - b[bestCh]);
    // Split at the largest gap along the chosen channel rather than at the
    // median index. This cleanly separates distinct color clusters even when
    // they are unbalanced in size (e.g. a 60/40 split), instead of bleeding one
    // cluster into the other's bucket.
    let splitAt = Math.floor(bucket.length / 2);
    let maxGap = -1;
    for (let k = 1; k < bucket.length; k++) {
      const gap = bucket[k][bestCh] - bucket[k - 1][bestCh];
      if (gap > maxGap) {
        maxGap = gap;
        splitAt = k;
      }
    }
    const left = bucket.slice(0, splitAt);
    const right = bucket.slice(splitAt);
    buckets.splice(target, 1, left, right);
  }

  return buckets
    .filter((b) => b.length > 0)
    .map(averageColor)
    .map(([r, g, b]) => [Math.round(r), Math.round(g), Math.round(b)]);
}

// Convenience: produce a palette of { r, g, b, hex } from an array of [r,g,b].
export function quantize(pixels, maxColors = 6) {
  return medianCut(pixels, maxColors).map(([r, g, b]) => ({ r, g, b, hex: rgbToHex(r, g, b) }));
}
