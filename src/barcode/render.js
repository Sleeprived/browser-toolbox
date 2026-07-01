// Barcode rendering: a flat boolean module array → merged bar geometry, an SVG
// string, or a canvas draw. The geometry and SVG paths are pure (no DOM) and
// unit-tested; the canvas draw is browser-only and verified by the manual scan
// check per the spec (jsdom has no Canvas 2D API).

const DEFAULTS = { moduleWidth: 2, barHeight: 120, quiet: 10, fontPx: 20, textGap: 6 };

// Merge consecutive dark modules into { x, width } runs (module units), offset by
// the quiet zone. Fewer rects, and easy to assert in tests.
export function barRuns(modules, quiet) {
  const runs = [];
  let x = quiet;
  let i = 0;
  while (i < modules.length) {
    if (modules[i]) {
      let w = 0;
      while (i < modules.length && modules[i]) { w++; i++; }
      runs.push({ x, width: w });
      x += w;
    } else {
      x += 1;
      i += 1;
    }
  }
  return runs;
}

function opts(o = {}) {
  return { ...DEFAULTS, ...o };
}

// Total width in modules including both quiet zones.
export function totalModules(moduleCount, quiet) {
  return moduleCount + quiet * 2;
}

const safeHex = (v, fallback) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);
const xmlEscape = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Render modules to a standalone SVG string.
export function renderSvg(modules, o = {}) {
  const { moduleWidth, barHeight, quiet, fontPx, textGap, fg, bg, showText, text } = opts(o);
  const totalW = totalModules(modules.length, quiet);
  const wPx = totalW * moduleWidth;
  const textBand = showText && text ? textGap + fontPx : 0;
  const hPx = barHeight + textBand;
  const ink = safeHex(fg, '#000000');
  const paper = safeHex(bg, '#ffffff');

  let rects = '';
  for (const run of barRuns(modules, quiet)) {
    rects += `<rect x="${run.x * moduleWidth}" y="0" width="${run.width * moduleWidth}" height="${barHeight}"/>`;
  }
  let label = '';
  if (showText && text) {
    label =
      `<text x="${wPx / 2}" y="${barHeight + textGap + fontPx * 0.8}" fill="${ink}" ` +
      `font-family="monospace" font-size="${fontPx}" text-anchor="middle" ` +
      `letter-spacing="2">${xmlEscape(text)}</text>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" ` +
    `viewBox="0 0 ${wPx} ${hPx}" shape-rendering="crispEdges">` +
    `<rect width="${wPx}" height="${hPx}" fill="${paper}"/>` +
    `<g fill="${ink}">${rects}</g>${label}</svg>`;
}

// Draw modules onto a canvas element (browser only). Sizes the canvas to the
// requested module width / bar height, returns the pixel dimensions used.
export function drawCanvas(canvas, modules, o = {}) {
  const { moduleWidth, barHeight, quiet, fontPx, textGap, fg, bg, showText, text } = opts(o);
  const totalW = totalModules(modules.length, quiet);
  const wPx = totalW * moduleWidth;
  const textBand = showText && text ? textGap + fontPx : 0;
  const hPx = barHeight + textBand;
  canvas.width = wPx;
  canvas.height = hPx;

  // jsdom (and any canvas-less environment) returns null here; skip drawing so
  // the UI module stays importable/testable. Real browsers draw normally.
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return { width: wPx, height: hPx };
  ctx.fillStyle = safeHex(bg, '#ffffff');
  ctx.fillRect(0, 0, wPx, hPx);
  ctx.fillStyle = safeHex(fg, '#000000');
  for (const run of barRuns(modules, quiet)) {
    ctx.fillRect(run.x * moduleWidth, 0, run.width * moduleWidth, barHeight);
  }
  if (showText && text) {
    ctx.font = `${fontPx}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(text), wPx / 2, barHeight + textGap + fontPx * 0.8);
  }
  return { width: wPx, height: hPx };
}
