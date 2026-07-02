import { quantize, pixelsFromRgba } from './quantize.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 256; // downscale long edge before reading pixels (bounds memory)
// A small file can still decode to an enormous bitmap (decompression bomb); the
// 256px downscale only runs AFTER the full-resolution decode. Reject outright.
const MAX_IMAGE_PIXELS = 64 * 1000 * 1000; // 64 MP (~256 MB peak bitmap) — still allows any realistic camera/phone photo

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file');
const countRange = document.getElementById('count');
const countVal = document.getElementById('count-val');
const errorBox = document.getElementById('error');
const resultBox = document.getElementById('result');
const previewImg = document.getElementById('preview-img');
const swatchesEl = document.getElementById('swatches');
const exportOut = document.getElementById('export-out');
const copiedMsg = document.getElementById('copied');
const work = document.getElementById('work');
const infoBox = document.getElementById('palette-info');

let palette = [];
let currentUrl = null;
let lastPixels = null; // cached [r,g,b] pixels of the current image (decode once)
let loadGen = 0; // bumped per load; stale async onload/onerror results are dropped

function showInfo(msg) { infoBox.textContent = msg; infoBox.classList.remove('hidden'); }
function clearInfo() { infoBox.classList.add('hidden'); }

function showError(msg) {
  clearInfo();
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
  resultBox.classList.add('hidden');
}

function extractFromImage(img) {
  let { naturalWidth: w, naturalHeight: h } = img;
  if (w === 0 || h === 0) {
    showError('That image could not be decoded.');
    return;
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  work.width = dw;
  work.height = dh;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, dw, dh);

  let data;
  try {
    data = ctx.getImageData(0, 0, dw, dh).data;
  } catch (e) {
    showError('Could not read image pixels: ' + e.message);
    return;
  }

  // Decode the pixels once; the color-count slider re-quantizes this cache
  // instead of re-decoding the image on every tick.
  lastPixels = pixelsFromRgba(data);
  requantize();
}

function requantize() {
  if (!lastPixels) return;
  const requested = Number(countRange.value);
  palette = quantize(lastPixels, requested);
  if (palette.length === 0) {
    showError('No opaque pixels found in this image — there are no colors to extract.');
    return;
  }
  if (palette.length < requested) {
    showInfo(`This image has only ${palette.length} distinct color region${palette.length === 1 ? '' : 's'}.`);
  } else {
    clearInfo();
  }
  renderSwatches();
  errorBox.classList.add('hidden');
  resultBox.classList.remove('hidden');
}

function renderSwatches() {
  swatchesEl.replaceChildren();
  if (copiedMsg) copiedMsg.classList.add('hidden');
  for (const c of palette) {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.style.background = c.hex; // CSSOM style — allowed under CSP
    const hex = document.createElement('button');
    hex.type = 'button';
    hex.className = 'hex';
    hex.textContent = c.hex;
    hex.setAttribute('aria-label', `Copy ${c.hex}`);
    hex.title = 'Click to copy';
    hex.addEventListener('click', () => copyText(c.hex));
    sw.append(chip, hex);
    swatchesEl.appendChild(sw);
  }
  showExport('hex');
}

async function copyText(text) {
  let ok = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    ok = false; // clipboard may be unavailable (e.g. non-secure context)
  }
  copiedMsg.textContent = ok ? `Copied ${text}` : `Copy here: ${text}`;
  copiedMsg.classList.remove('hidden');
}

function showExport(fmt) {
  if (palette.length === 0) return;
  if (fmt === 'hex') {
    exportOut.textContent = palette.map((c) => c.hex).join('\n');
  } else if (fmt === 'css') {
    exportOut.textContent =
      ':root {\n' + palette.map((c, i) => `  --color-${i + 1}: ${c.hex};`).join('\n') + '\n}';
  } else {
    exportOut.textContent = JSON.stringify(
      palette.map((c) => ({ hex: c.hex, r: c.r, g: c.g, b: c.b })),
      null,
      2,
    );
  }
}

function loadFile(file) {
  // Bump BEFORE validation: a rejected file must also supersede in-flight
  // work, or an older load finishing late would overwrite the rejection error.
  // The guard also stops a slow decode finishing after a newer file was chosen
  // from pairing image A's swatches with image B's preview (last-write-wins).
  const gen = ++loadGen;
  if (!file.type.startsWith('image/') || file.size > MAX_FILE_BYTES) {
    // Release the URL now: a superseded in-flight load returns at its gen
    // check BEFORE its own revoke line, so it would leak the blob URL.
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
    showError(!file.type.startsWith('image/')
      ? 'Please choose an image file.'
      : `That file is ${(file.size / 1048576).toFixed(1)} MB — over the 25 MB limit.`);
    return;
  }
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(file);
  // Drop the previous image's cached pixels: if THIS load fails to decode, the
  // color-count slider must not resurrect the old palette next to a broken preview.
  lastPixels = null;
  const img = new Image();
  img.onload = () => {
    if (gen !== loadGen) return; // superseded by a newer file
    // Bound decode-bomb memory: only show the preview and process once the
    // dimensions are known to be sane.
    if (img.naturalWidth * img.naturalHeight > MAX_IMAGE_PIXELS) {
      previewImg.removeAttribute('src');
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
      showError(`That image is ${img.naturalWidth}×${img.naturalHeight} — too large to process safely.`);
      return;
    }
    previewImg.src = currentUrl;
    extractFromImage(img);
  };
  img.onerror = () => {
    if (gen !== loadGen) return; // superseded — the newer load owns currentUrl now
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
    showError('Could not load that image.');
  };
  img.src = currentUrl;
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) loadFile(f);
});
countRange.addEventListener('input', () => {
  countVal.textContent = countRange.value;
  requantize(); // re-quantize cached pixels; no image re-decode
});

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  }),
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
  }),
);
dropzone.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

for (const btn of document.querySelectorAll('[data-fmt]')) {
  btn.addEventListener('click', () => showExport(btn.getAttribute('data-fmt')));
}
