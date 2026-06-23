// Browser-only SVG renderer for the visual codes (Pigpen, Semaphore). Builds nodes
// with createElementNS only — no innerHTML, no <animate>, and no layout reads
// (getBBox/getComputedStyle) so it is jsdom-safe. All glyphs are drawn in a 0..100
// viewBox cell. On screen, color is 'currentColor' (theme-aware via the page's
// computed color); for export a hardcoded dark ink is used so a serialized SVG blob
// rasterizes visibly. The only text is a <title> set from the A–Z letter.

import { glyphFor } from './pigpen.js';
import { anglesFor } from './semaphore.js';

const NS = 'http://www.w3.org/2000/svg';
const STROKE_W = 6;        // in 0..100 user units (~2.6px at a 44px box)
const EXPORT_INK = '#15171c';
const EXPORT_BG = '#ffffff';

function el(name, attrs) {
  const node = document.createElementNS(NS, name);
  for (const k in attrs) node.setAttribute(k, String(attrs[k]));
  return node;
}

function line(x1, y1, x2, y2, color) {
  return el('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': STROKE_W, 'stroke-linecap': 'round', fill: 'none' });
}

// --- Pigpen -----------------------------------------------------------------
// Box edges occupy the 20..80 square; the X chevron and dots sit around centre 50.
function drawPigpen(parent, letter, color) {
  const g = glyphFor(letter);
  if (!g) return;
  const L = 20, R = 80, T = 20, B = 80, C = 50;
  if (g.chevron) {
    // two segments from centre to the two outer corners of the letter's triangle
    const corners = {
      up: [[L, T], [R, T]],
      down: [[L, B], [R, B]],
      left: [[L, T], [L, B]],
      right: [[R, T], [R, B]],
    }[g.chevron];
    for (const [x, y] of corners) parent.appendChild(line(C, C, x, y, color));
    if (g.dot) {
      // dot on the chevron axis, offset toward the open mouth of the wedge
      const off = { up: [C, 34], down: [C, 66], left: [34, C], right: [66, C] }[g.chevron];
      parent.appendChild(el('circle', { cx: off[0], cy: off[1], r: 5, fill: color, stroke: 'none' }));
    }
    return;
  }
  if (g.edges.top) parent.appendChild(line(L, T, R, T, color));
  if (g.edges.right) parent.appendChild(line(R, T, R, B, color));
  if (g.edges.bottom) parent.appendChild(line(L, B, R, B, color));
  if (g.edges.left) parent.appendChild(line(L, T, L, B, color));
  if (g.dot) parent.appendChild(el('circle', { cx: C, cy: C, r: 5, fill: color, stroke: 'none' }));
}

// --- Semaphore --------------------------------------------------------------
// A central body with two arms at the letter's angles, each ending in a small flag.
function armEnd(cx, cy, deg, len) {
  const rad = (deg * Math.PI) / 180;
  return [cx + len * Math.sin(rad), cy - len * Math.cos(rad)];
}

function drawArm(parent, cx, cy, deg, color) {
  const len = 36;
  const [tx, ty] = armEnd(cx, cy, deg, len);
  parent.appendChild(line(cx, cy, tx, ty, color));
  // small flag triangle near the tip, offset to one side of the arm
  const rad = (deg * Math.PI) / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);   // along arm
  const px = Math.cos(rad), py = Math.sin(rad);    // perpendicular
  const back = (f) => [tx - 11 * dx + f * px * 11, ty - 11 * dy + f * py * 11];
  const p1 = [tx, ty];
  const p2 = back(0);
  const p3 = back(1);
  parent.appendChild(el('polygon', {
    points: `${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`,
    fill: color, stroke: 'none',
  }));
}

function drawSemaphore(parent, letter, color) {
  const a = anglesFor(letter);
  if (!a) return;
  const C = 50;
  parent.appendChild(el('circle', { cx: C, cy: C, r: 7, fill: 'none', stroke: color, 'stroke-width': STROKE_W }));
  drawArm(parent, C, C, a.left, color);
  drawArm(parent, C, C, a.right, color);
}

function draw(parent, format, letter, color) {
  if (format === 'pigpen') drawPigpen(parent, letter, color);
  else if (format === 'semaphore') drawSemaphore(parent, letter, color);
}

/**
 * One glyph as a standalone <svg> node for on-screen display.
 * By default it is named for assistive tech (role="img" + <title>=letter), e.g.
 * for the encoded strip. Pass { decorative: true } when something else already
 * names it — the reference chart's visible label or the palette button's
 * aria-label — so the glyph is hidden from AT (no duplicate name, no stray tooltip).
 */
export function glyphSvg(format, letter, { decorative = false } = {}) {
  const svg = el('svg', { viewBox: '0 0 100 100', class: 'glyph' });
  if (decorative) {
    svg.setAttribute('aria-hidden', 'true');
  } else {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Letter ${letter}`);
    const title = document.createElementNS(NS, 'title');
    title.textContent = `Letter ${letter}`;
    svg.appendChild(title);
  }
  draw(svg, format, letter, 'currentColor');
  return svg;
}

/**
 * The whole message as ONE self-contained <svg> for download: explicit width/height,
 * a white background, and hardcoded dark ink (no currentColor / external refs) so a
 * serialized blob rasterizes visibly and never taints the canvas. `letters` is the
 * array from textTo*(): '' marks a word break (rendered as a gap).
 */
export function exportStripSvg(format, letters) {
  const cell = 100, pad = 16, gap = 12, wordGap = 40;
  const xs = [];
  let x = pad;
  for (const ch of letters) {
    if (ch === '') { x += wordGap; continue; }
    xs.push([ch, x]);
    x += cell + gap;
  }
  const width = Math.max(x - gap + pad, pad * 2 + cell);
  const height = cell + pad * 2;
  const svg = el('svg', { xmlns: NS, viewBox: `0 0 ${width} ${height}`, width, height });
  svg.appendChild(el('rect', { x: 0, y: 0, width, height, fill: EXPORT_BG }));
  for (const [ch, gx] of xs) {
    const g = el('g', { transform: `translate(${gx}, ${pad})` });
    draw(g, format, ch, EXPORT_INK);
    svg.appendChild(g);
  }
  return svg;
}
