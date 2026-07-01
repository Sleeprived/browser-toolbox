import { encodeCode128, BarcodeError } from './code128.js';
import { encodeEan } from './ean.js';
import { renderSvg, drawCanvas } from './render.js';
import { colorWarning } from '../qr/quality.js';

const MAX_CODE128 = 120; // sane upper bound so a huge paste can't produce a monster canvas

const symSel = document.getElementById('symbology');
const dataInput = document.getElementById('data');
const hintEl = document.getElementById('hint');
const statusEl = document.getElementById('barcode-status');
const errorBox = document.getElementById('barcode-error');
const resultBox = document.getElementById('result');
const canvas = document.getElementById('canvas');
const encodedEl = document.getElementById('encoded');
const copiedMsg = document.getElementById('copied');
const dlPng = document.getElementById('dl-png');
const dlSvg = document.getElementById('dl-svg');
const copyImgBtn = document.getElementById('copy-img');

const fgInput = document.getElementById('fg');
const bgInput = document.getElementById('bg');
const scaleSel = document.getElementById('scale');
const heightSel = document.getElementById('height');
const quietRange = document.getElementById('quiet');
const quietVal = document.getElementById('quiet-val');
const hrtCheck = document.getElementById('hrt');
const colorWarn = document.getElementById('color-warn');

const HINTS = {
  code128: 'Any text or numbers (printable ASCII). Digit runs are packed automatically.',
  ean13: 'Enter 12 digits and the 13th check digit is added, or paste all 13 to verify it.',
  upca: 'Enter 11 digits and the 12th check digit is added, or paste all 12 to verify it.',
};

let currentModules = null;
let currentHrt = '';

function renderOpts(text) {
  return {
    moduleWidth: Number(scaleSel.value) || 2,
    barHeight: Number(heightSel.value) || 120,
    quiet: Math.max(0, Number(quietRange.value) || 0),
    fg: fgInput.value,
    bg: bgInput.value,
    showText: hrtCheck.checked,
    text,
  };
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
  resultBox.classList.add('hidden');
  currentModules = null;
}

function showStatus(msg, warn) {
  statusEl.textContent = msg;
  statusEl.hidden = false;
  statusEl.classList.toggle('warn', !!warn);
}

function refreshColorWarning() {
  const w = colorWarning(fgInput.value, bgInput.value);
  if (w) {
    colorWarn.textContent = w;
    colorWarn.classList.remove('hidden');
  } else {
    colorWarn.classList.add('hidden');
  }
}

function build(sym, raw) {
  if (sym === 'code128') {
    if (raw.length > MAX_CODE128) {
      throw new BarcodeError(`Code 128 input is limited to ${MAX_CODE128} characters here.`);
    }
    const r = encodeCode128(raw);
    return { modules: r.modules, hrt: raw, encoded: `Code 128 · ${r.modules.length} modules` };
  }
  const r = encodeEan(sym, raw);
  const label = sym === 'ean13' ? 'EAN-13' : 'UPC-A';
  if (r.supplied && r.mismatch) {
    showStatus(`Your check digit doesn't match — the correct one is ${r.checkDigit}, which was used.`, true);
  } else {
    showStatus(`Check digit: ${r.checkDigit}`, false);
  }
  return { modules: r.modules, hrt: r.text, encoded: `${label} · ${r.text}` };
}

function update() {
  quietVal.textContent = quietRange.value;
  refreshColorWarning();
  hintEl.textContent = HINTS[symSel.value] || '';
  statusEl.hidden = true;
  statusEl.classList.remove('warn');

  const raw = dataInput.value;
  if (raw.trim() === '') {
    errorBox.classList.add('hidden');
    resultBox.classList.add('hidden');
    currentModules = null;
    return;
  }

  let res;
  try {
    res = build(symSel.value, raw);
  } catch (e) {
    showError(e instanceof BarcodeError ? e.message : 'Could not encode that input.');
    return;
  }

  errorBox.classList.add('hidden');
  currentModules = res.modules;
  currentHrt = res.hrt;
  drawCanvas(canvas, res.modules, renderOpts(res.hrt));
  // Keep a wide barcode inside the page; the export keeps full resolution.
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  encodedEl.textContent = res.encoded;
  copiedMsg.classList.add('hidden');
  resultBox.classList.remove('hidden');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

dlPng.addEventListener('click', () => {
  if (!currentModules) return;
  canvas.toBlob((blob) => blob && downloadBlob(blob, 'barcode.png'), 'image/png');
});

dlSvg.addEventListener('click', () => {
  if (!currentModules) return;
  const svg = renderSvg(currentModules, renderOpts(currentHrt));
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'barcode.svg');
});

copyImgBtn.addEventListener('click', () => {
  if (!currentModules) return;
  if (!(navigator.clipboard && window.ClipboardItem)) {
    copiedMsg.textContent = 'Copying images is not supported in this browser — use Download PNG instead.';
    copiedMsg.classList.remove('hidden');
    return;
  }
  canvas.toBlob((blob) => {
    if (!blob) return;
    navigator.clipboard
      .write([new window.ClipboardItem({ 'image/png': blob })])
      .then(() => {
        copiedMsg.textContent = 'Image copied to clipboard';
        copiedMsg.classList.remove('hidden');
      })
      .catch(() => {
        copiedMsg.textContent = 'Could not copy — use Download PNG instead.';
        copiedMsg.classList.remove('hidden');
      });
  }, 'image/png');
});

for (const el of [symSel, dataInput, fgInput, bgInput, scaleSel, heightSel, quietRange, hrtCheck]) {
  el.addEventListener('input', update);
  el.addEventListener('change', update);
}

update();
