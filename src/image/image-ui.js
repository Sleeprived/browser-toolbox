import { computeTargetSize, orientationToTransform } from './image.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

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
  let scale = 1;
  if (w * h > MAX_CANVAS_PIXELS) scale = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
  if (w * scale > MAX_CANVAS_SIDE) scale = Math.min(scale, MAX_CANVAS_SIDE / w);
  if (h * scale > MAX_CANVAS_SIDE) scale = Math.min(scale, MAX_CANVAS_SIDE / h);
  if (scale >= 1) return { width: w, height: h };
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) };
}

function readJpegOrientation(bytes) {
  // Use the vendored piexif global if present; default to 1 (upright).
  try {
    const p = globalThis.piexif;
    if (!p) return 1;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const ex = p.load(bin);
    const o = ex['0th'] && ex['0th'][274];
    return typeof o === 'number' ? o : 1;
  } catch {
    return 1;
  }
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
  const reader = new FileReader();
  reader.onload = () => {
    const bytes = new Uint8Array(reader.result);
    const orientation = file.type === 'image/jpeg' ? readJpegOrientation(bytes) : 1;
    const blob = new Blob([bytes], { type: file.type });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      srcBitmap = { img, width: img.naturalWidth, height: img.naturalHeight, orientation, type: file.type, size: file.size };
      const t = orientationToTransform(orientation);
      const dispW = t.swap ? img.naturalHeight : img.naturalWidth;
      const dispH = t.swap ? img.naturalWidth : img.naturalHeight;
      errorBox.classList.add('hidden');
      resultBox.classList.remove('hidden');
      // Guard against canvas OOM: a small file can still decode to a huge bitmap.
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
  };
  reader.onerror = () => showError('Could not read that file.');
  reader.readAsArrayBuffer(file);
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
    errorBox.classList.add('hidden'); // dismiss any stale clamp/large-image notice on success
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
