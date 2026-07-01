import { computeTargetSize, orientationToTransform } from './image.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
// A small file can still decode to an enormous bitmap (decompression bomb); the
// canvas clamp below only bounds the OUTPUT. Reject implausibly large sources.
const MAX_IMAGE_PIXELS = 64 * 1000 * 1000; // 64 MP (~256 MB peak bitmap) — still allows any realistic camera/phone photo

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file');
const errorBox = document.getElementById('image-error');
const resultBox = document.getElementById('image-result');
const widthInput = document.getElementById('img-width');
const heightInput = document.getElementById('img-height');
const lockChk = document.getElementById('img-lock');
const formatSel = document.getElementById('img-format');
const qualityRange = document.getElementById('img-quality');
const qualityVal = document.getElementById('img-quality-val');
const applyBtn = document.getElementById('img-apply');
const downloadBtn = document.getElementById('img-download');
const stats = document.getElementById('img-stats');
const preview = document.getElementById('img-preview');

let srcBitmap = null; // { img, width, height, orientation, type, size }
let outBlob = null;
let outUrl = null;

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
  resultBox.classList.add('hidden');
}

// Non-fatal notice: show the message but keep the result/controls visible.
function showWarning(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

// Canvas allocation limits. Browsers cap a single side (~16384px on many) and
// total area; clamp a too-large default while preserving aspect ratio.
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_PIXELS = 40 * 1000 * 1000;
function clampToCanvasLimits(w, h) {
  // A typed exponential literal (e.g. "1e999") coerces to Infinity, and an
  // over-large finite product can overflow to Infinity; either would propagate
  // NaN through the scaling math to a NaN-sized canvas. Substitute the max side
  // so the existing logic produces a sane, in-bounds result instead.
  if (!Number.isFinite(w) || w <= 0) w = MAX_CANVAS_SIDE;
  if (!Number.isFinite(h) || h <= 0) h = MAX_CANVAS_SIDE;
  let scale = 1;
  if (w * h > MAX_CANVAS_PIXELS) scale = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
  if (w * scale > MAX_CANVAS_SIDE) scale = Math.min(scale, MAX_CANVAS_SIDE / w);
  if (h * scale > MAX_CANVAS_SIDE) scale = Math.min(scale, MAX_CANVAS_SIDE / h);
  if (scale >= 1) return { width: w, height: h };
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) };
}

function loadFile(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    showError('Please choose a JPEG, PNG, or WebP image.');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showError(`That file is ${(file.size / 1048576).toFixed(1)} MB — over the 25 MB limit.`);
    return;
  }
  // A new file invalidates any previous output; without this reset the preview
  // and Download button would keep serving the PREVIOUS image's result.
  outBlob = null;
  if (outUrl) { URL.revokeObjectURL(outUrl); outUrl = null; }
  preview.removeAttribute('src');
  downloadBtn.classList.add('hidden');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    // Bound decode-bomb memory: a small file can decode to an enormous bitmap.
    if (img.naturalWidth * img.naturalHeight > MAX_IMAGE_PIXELS) {
      showError(`That image is ${img.naturalWidth}×${img.naturalHeight} — too large to process safely.`);
      return;
    }
    // Modern browsers auto-orient images via the default `image-orientation:
    // from-image`: naturalWidth/naturalHeight are already the upright dimensions and
    // drawImage paints upright. Re-applying the EXIF Orientation tag here would
    // rotate the image a SECOND time, so orientation is fixed to 1 (identity).
    srcBitmap = { img, width: img.naturalWidth, height: img.naturalHeight, orientation: 1, type: file.type, size: file.size };
    const dispW = img.naturalWidth;
    const dispH = img.naturalHeight;
    errorBox.classList.add('hidden');
    resultBox.classList.remove('hidden');
    // Clamp the default target so the canvas stays within sane limits.
    const def = clampToCanvasLimits(dispW, dispH);
    widthInput.value = def.width;
    heightInput.value = def.height;
    if (def.width !== dispW || def.height !== dispH) {
      showWarning(`That image is very large (${dispW}×${dispH}). Default size clamped to ${def.width}×${def.height} to avoid running out of memory; you can adjust it.`);
    }
    stats.textContent = `Original: ${dispW}×${dispH}, ${(file.size / 1024).toFixed(0)} KB`;
  };
  img.onerror = () => { URL.revokeObjectURL(url); showError('Could not load that image.'); };
  img.src = url;
}

function render() {
  if (!srcBitmap) return;
  const { img, width, height, orientation, type } = srcBitmap;
  const t = orientationToTransform(orientation);
  // Source dimensions AFTER orientation (what the user sees as upright).
  const uprightW = t.swap ? height : width;
  const uprightH = t.swap ? width : height;
  const target = computeTargetSize(uprightW, uprightH, {
    width: Number(widthInput.value) || undefined,
    height: Number(heightInput.value) || undefined,
    lock: lockChk.checked,
  });
  // Re-clamp manually-typed dimensions; clampToCanvasLimits was
  // only applied to the on-load default, so a huge typed value could request an
  // over-limit canvas and silently fail toBlob.
  const clamped = clampToCanvasLimits(target.width, target.height);
  const didClamp = clamped.width !== target.width || clamped.height !== target.height;
  if (didClamp) {
    showWarning(`Requested size too large; clamped to ${clamped.width}×${clamped.height} to stay within canvas limits.`);
    target.width = clamped.width;
    target.height = clamped.height;
  }

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  const outType = formatSel.value === 'keep' ? type : formatSel.value;
  // JPEG has no alpha: composite onto white so transparent PNG/WebP don't go black.
  if (outType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.save();
  // Apply orientation transform around the canvas center.
  ctx.translate(target.width / 2, target.height / 2);
  ctx.rotate((t.rotate * Math.PI) / 180);
  if (t.flip) ctx.scale(-1, 1);
  // After rotate, draw the source scaled to the rotated bounding box.
  const drawW = t.swap ? target.height : target.width;
  const drawH = t.swap ? target.width : target.height;
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  const quality = Number(qualityRange.value);
  canvas.toBlob((blob) => {
    if (!blob) { showError('Could not encode the image in that format.'); return; }
    // Keep THIS render's clamp notice visible; only dismiss a stale notice.
    if (!didClamp) errorBox.classList.add('hidden');
    outBlob = blob;
    if (outUrl) URL.revokeObjectURL(outUrl);
    outUrl = URL.createObjectURL(blob);
    preview.src = outUrl;
    downloadBtn.classList.remove('hidden');
    const pct = srcBitmap.size ? Math.round((1 - blob.size / srcBitmap.size) * 100) : 0;
    stats.textContent = `${target.width}×${target.height} · ${(blob.size / 1024).toFixed(0)} KB ` +
      `(${pct >= 0 ? pct + '% smaller' : Math.abs(pct) + '% larger'})`;
  }, outType, /^image\/(jpeg|webp)$/.test(outType) ? quality : undefined);
}

// Aspect-lock: editing one dimension updates the other when locked.
widthInput.addEventListener('input', () => {
  if (lockChk.checked && srcBitmap) {
    const t = orientationToTransform(srcBitmap.orientation);
    const uw = t.swap ? srcBitmap.height : srcBitmap.width;
    const uh = t.swap ? srcBitmap.width : srcBitmap.height;
    heightInput.value = Math.max(1, Math.round((Number(widthInput.value) || 0) * uh / uw));
  }
});
heightInput.addEventListener('input', () => {
  if (lockChk.checked && srcBitmap) {
    const t = orientationToTransform(srcBitmap.orientation);
    const uw = t.swap ? srcBitmap.height : srcBitmap.width;
    const uh = t.swap ? srcBitmap.width : srcBitmap.height;
    widthInput.value = Math.max(1, Math.round((Number(heightInput.value) || 0) * uw / uh));
  }
});
qualityRange.addEventListener('input', () => { qualityVal.textContent = qualityRange.value; });
applyBtn.addEventListener('click', render);
downloadBtn.addEventListener('click', () => {
  if (!outBlob) return;
  const ext = (outBlob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const a = document.createElement('a');
  a.href = outUrl;
  a.download = `resized.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) loadFile(f);
});
['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }),
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); }),
);
dropzone.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});
