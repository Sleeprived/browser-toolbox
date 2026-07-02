import { textToTaps, tapsToText } from './tapcode.js';
import { textToBacon, baconToText } from './baconian.js';
import { LETTERS as PIG_LETTERS, textToPigpen } from './pigpen.js';
import { LETTERS as SEM_LETTERS, textToSemaphore } from './semaphore.js';
import { glyphSvg, exportStripSvg } from './glyph-render.js';

const $ = (id) => document.getElementById(id);

const formatSel = $('cipher-format');
const dirSel = $('cipher-dir');
const inputText = $('cipher-input-text');
const inEl = $('cipher-in');
const inputPalette = $('cipher-input-palette');
const paletteEl = $('cipher-palette');
const skippedEl = $('cipher-skipped');
// Reserved structural-error region (role="alert"). The cipher engines never throw
// — decoders degrade to U+FFFD, encoders record skipped chars — so nothing populates
// it today; it is kept hidden for the a11y contract and future use.
const errorEl = $('cipher-error');
const statusEl = $('cipher-status');
const outEl = $('cipher-out');
const outH = $('cipher-out-h');
const visualEl = $('cipher-visual');
const visualH = $('cipher-visual-h');
const chartEl = $('cipher-chart');
const chartH = $('cipher-chart-h');
const copyBtn = $('cipher-copy');
const copiedEl = $('cipher-copied');
const dlSvgBtn = $('cipher-download-svg');
const dlPngBtn = $('cipher-download-png');

const TEXT = {
  tapcode: { enc: textToTaps, dec: tapsToText },
  baconian: { enc: textToBacon, dec: baconToText },
};
const VISUAL = {
  pigpen: { split: textToPigpen, letters: PIG_LETTERS },
  semaphore: { split: textToSemaphore, letters: SEM_LETTERS },
};
const isVisual = (f) => f === 'pigpen' || f === 'semaphore';
const MAX_VISUAL_GLYPHS = 2000; // cap the live per-keystroke glyph render so a huge paste can't freeze the tab

// Buffer built by clicking glyphs in visual-decode mode.
let decodeBuffer = '';
let chartFormat = null;   // format the reference chart is currently built for
let paletteFormat = null; // format the decode palette is currently built for

const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');
const toggle = (el, on) => el.classList.toggle('hidden', !on);
const showSkipped = (msg) => { skippedEl.textContent = msg; show(skippedEl); };
const setStatus = (msg) => { statusEl.textContent = msg; show(statusEl); };
const hideStatus = () => { statusEl.textContent = ''; statusEl.classList.add('hidden'); }; // never leave stale text in a live region

function showPanels(visual, dir) {
  const vEnc = visual && dir === 'encode';
  const vDec = visual && dir === 'decode';
  toggle(inputText, !vDec);
  toggle(inputPalette, vDec);
  toggle(outEl, !vEnc);
  toggle(outH, !vEnc);
  toggle(visualEl, vEnc);
  toggle(visualH, vEnc);
  toggle(chartEl, vEnc);
  toggle(chartH, vEnc);
  toggle(copyBtn, !vEnc);
  toggle(dlSvgBtn, vEnc);
  toggle(dlPngBtn, vEnc);
}

function renderText(format, dir) {
  const text = inEl.value;
  if (text === '') { outEl.textContent = ''; return; }
  if (dir === 'encode') {
    const { code, skipped } = TEXT[format].enc(text);
    outEl.textContent = code;
    if (skipped.length) showSkipped(`Skipped (no code): ${skipped.join(' ')}`);
  } else {
    const out = TEXT[format].dec(text);
    outEl.textContent = out;
    const bad = (out.match(/�/g) || []).length;
    if (bad) showSkipped(`${bad} token(s) could not be decoded.`);
  }
}

function buildChart(format) {
  if (chartFormat === format) return;
  chartFormat = format;
  const cells = [];
  for (const ch of VISUAL[format].letters) {
    const cell = document.createElement('div');
    cell.className = 'glyph-cell';
    cell.appendChild(glyphSvg(format, ch, { decorative: true })); // visible label names the cell
    const label = document.createElement('span');
    label.className = 'glyph-label';
    label.textContent = ch;
    cell.appendChild(label);
    cells.push(cell);
  }
  chartEl.replaceChildren(...cells);
}

function renderVisualEncode(format) {
  outEl.textContent = ''; // §6 reset contract: #cipher-out holds no stale text in visual-encode
  buildChart(format);
  const text = inEl.value;
  const nodes = [];
  if (text !== '') {
    const { letters, skipped } = VISUAL[format].split(text);
    // Cap the live render: drawing one SVG per letter on every keystroke would freeze
    // the tab on a very long paste. Show the first N glyphs plus an inline notice.
    const capped = letters.length > MAX_VISUAL_GLYPHS;
    const shown = capped ? letters.slice(0, MAX_VISUAL_GLYPHS) : letters;
    for (const ch of shown) {
      if (ch === '') {
        const gap = document.createElement('span');
        gap.className = 'word-gap';
        const sr = document.createElement('span');
        sr.className = 'visually-hidden-h';
        sr.textContent = 'space';
        gap.appendChild(sr);
        nodes.push(gap);
      } else {
        nodes.push(glyphSvg(format, ch));
      }
    }
    if (capped) {
      const note = document.createElement('span');
      note.className = 'glyph-truncated';
      note.textContent = `… message too long to draw — showing the first ${MAX_VISUAL_GLYPHS} glyphs.`;
      nodes.push(note);
    }
    if (skipped.length) showSkipped(`Skipped (no glyph): ${skipped.join(' ')}`);
  }
  visualEl.replaceChildren(...nodes);
}

function buildPalette(format) {
  if (paletteFormat === format) return;
  paletteFormat = format;
  const nodes = [];
  const editBtn = (text, label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn secondary';
    b.textContent = text;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  };
  // Edit buttons first so corrections are reachable without tabbing past 26 glyphs.
  nodes.push(editBtn('Space', 'Insert space', () => { decodeBuffer += ' '; renderBuffer(); hideStatus(); }));
  nodes.push(editBtn('Backspace', 'Delete last', () => { decodeBuffer = decodeBuffer.slice(0, -1); renderBuffer(); hideStatus(); }));
  nodes.push(editBtn('Clear', 'Clear all', () => { decodeBuffer = ''; renderBuffer(); setStatus('Cleared'); }));
  for (const ch of VISUAL[format].letters) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn secondary glyph-btn';
    b.setAttribute('aria-label', `Letter ${ch}`);
    b.appendChild(glyphSvg(format, ch, { decorative: true })); // the button's aria-label names it
    b.addEventListener('click', () => { decodeBuffer += ch; renderBuffer(); hideStatus(); });
    nodes.push(b);
  }
  paletteEl.replaceChildren(...nodes);
}

function renderBuffer() {
  outEl.textContent = decodeBuffer;
}

function update() {
  hide(copiedEl);
  hide(errorEl);
  hide(skippedEl);
  const format = formatSel.value;
  const dir = dirSel.value;
  const visual = isVisual(format);
  showPanels(visual, dir);
  if (!visual) {
    renderText(format, dir);
  } else if (dir === 'encode') {
    renderVisualEncode(format);
  } else {
    buildPalette(format);
    renderBuffer();
  }
}

// Mode switch (format/direction): empties the decode buffer; announces the discard.
function onModeChange() {
  const had = decodeBuffer.length > 0;
  decodeBuffer = '';
  update();
  if (had) setStatus('Switched — palette cleared');
  else hideStatus();
}

// --- downloads --------------------------------------------------------------
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Deferred like player.js/vault-ui: a synchronous revoke can cancel the
  // just-started download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function currentLetters() {
  const format = formatSel.value;
  const { letters } = VISUAL[format].split(inEl.value);
  return letters.filter((l) => l !== '').length ? letters : null;
}

function exportSvgNode() {
  const letters = currentLetters();
  if (!letters) return null;
  return exportStripSvg(formatSel.value, letters);
}

function downloadSvg() {
  const svg = exportSvgNode();
  if (!svg) { setStatus('Nothing to download yet — type a message first.'); return; }
  const xml = new XMLSerializer().serializeToString(svg);
  downloadBlob(new Blob([xml], { type: 'image/svg+xml' }), 'cipher.svg');
}

function downloadPng() {
  const svg = exportSvgNode();
  if (!svg) { setStatus('Nothing to download yet — type a message first.'); return; }
  const xml = new XMLSerializer().serializeToString(svg);
  const w = Number(svg.getAttribute('width'));
  const h = Number(svg.getAttribute('height'));
  const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  const fallback = () => {
    downloadBlob(new Blob([xml], { type: 'image/svg+xml' }), 'cipher.svg');
    setStatus('PNG export unavailable here — downloaded an SVG instead.');
  };
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(svgUrl);
        if (blob) downloadBlob(blob, 'cipher.png');
        else fallback();
      }, 'image/png');
    } catch {
      URL.revokeObjectURL(svgUrl);
      fallback();
    }
  };
  img.onerror = () => { URL.revokeObjectURL(svgUrl); fallback(); };
  img.src = svgUrl;
}

copyBtn.addEventListener('click', async () => {
  if (!outEl.textContent) return;
  let ok = false;
  try { await navigator.clipboard.writeText(outEl.textContent); ok = true; } catch { ok = false; }
  copiedEl.textContent = ok ? 'Copied to clipboard' : 'Press Ctrl+C to copy';
  show(copiedEl);
});

dlSvgBtn.addEventListener('click', downloadSvg);
dlPngBtn.addEventListener('click', downloadPng);
formatSel.addEventListener('change', onModeChange);
dirSel.addEventListener('change', onModeChange);
inEl.addEventListener('input', () => { hideStatus(); update(); });

update();
