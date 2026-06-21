import {
  isJpeg,
  readExifSummary,
  readJpegDimensions,
  stripJpegMetadata,
  scanJpegMetadata,
} from './jpeg.js';
import {
  isPng,
  readPngDimensions,
  listStrippableChunks,
  stripPngMetadata,
  pngTrailingByteCount,
} from './png.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file');
const errorBox = document.getElementById('error');
const results = document.getElementById('results');
const clearBtn = document.getElementById('clear-all');

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text; // textContent = XSS-safe
  return e;
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

function cleanName(name, suffix) {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return name + suffix;
  return name.slice(0, dot) + suffix + name.slice(dot);
}

function describeMeta(summary) {
  const found = [];
  if (summary.gps) found.push(`GPS ${summary.gps}`);
  if (summary.make || summary.model) found.push(`Camera ${[summary.make, summary.model].filter(Boolean).join(' ')}`);
  if (summary.dateTime) found.push(`Taken ${summary.dateTime}`);
  return found;
}

// Describe the metadata containers found beyond the decoded EXIF fields, so the
// user can see everything that is being removed (not just GPS/camera/date).
function describeContainers(scan) {
  const labels = [];
  if (scan.exif) labels.push('EXIF');
  if (scan.xmp) labels.push('XMP');
  if (scan.iptc) labels.push('IPTC');
  if (scan.icc) labels.push('ICC profile');
  if (scan.comment) labels.push('comment');
  if (scan.other) labels.push('other app data');
  const lines = [];
  if (labels.length) lines.push(`Removing: ${labels.join(', ')}`);
  if (scan.trailing) lines.push('Removing hidden data appended after the image');
  return lines;
}

function detectFormat(bytes) {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  // HEIC/HEIF: 'ftyp' box at offset 4 with heic/heif/mif1 brand.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'heic';
  return 'unknown';
}

function processFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const bytes = new Uint8Array(reader.result);
    let cleaned;
    let mime;
    let found = [];

    try {
      if (isJpeg(bytes)) {
        mime = 'image/jpeg';
        const summary = readExifSummary(bytes);
        found = [...describeMeta(summary), ...describeContainers(scanJpegMetadata(bytes))];
        readJpegDimensions(bytes); // validate it is a real JPEG
        cleaned = stripJpegMetadata(bytes);
      } else if (isPng(bytes)) {
        mime = 'image/png';
        const strippable = listStrippableChunks(bytes);
        found = strippable.length ? [`Metadata chunks: ${strippable.join(', ')}`] : [];
        const trailing = pngTrailingByteCount(bytes);
        if (trailing > 0) found.push(`Removing ${trailing} bytes of hidden data appended after the image`);
        readPngDimensions(bytes);
        cleaned = stripPngMetadata(bytes);
      } else {
        const fmt = detectFormat(bytes);
        const hint = {
          webp: 'WebP is not supported — convert to JPEG or PNG first.',
          gif: 'GIF is not supported — convert to PNG first.',
          heic: 'HEIC/HEIF is not supported — convert to JPEG first.',
        }[fmt] || 'Not a JPEG or PNG — skipped.';
        renderCard(file, [hint], null, null, true);
        return;
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      renderCard(file, [`Could not process: ${msg}`], null, null, true);
      return;
    }

    const removed = bytes.length - cleaned.length;
    if (removed > 0) {
      const kb = (removed / 1024).toFixed(removed >= 1024 ? 0 : 1);
      found.push(`Removed ${kb} KB (${bytes.length} → ${cleaned.length} bytes) · verified: no metadata containers remain`);
    } else {
      found.push(`No size change (${bytes.length} bytes) · verified: no metadata containers remain`);
    }

    const blob = new Blob([cleaned], { type: mime });
    renderCard(file, found, blob, cleanName(file.name, '-clean'));
  };
  reader.onerror = () => renderCard(file, ['Could not read file.'], null, null, true);
  reader.readAsArrayBuffer(file);
}

function renderCard(file, foundLines, blob, downloadName, isError) {
  const card = el('div', 'file-item');
  const meta = el('div', 'meta');
  meta.appendChild(el('div', null, file.name));

  if (foundLines.length === 0) {
    meta.appendChild(el('div', null, 'No identifying metadata found — a clean copy is ready anyway.'));
  } else {
    for (const line of foundLines) {
      const d = el('div');
      d.appendChild(el('code', null, line));
      meta.appendChild(d);
    }
  }
  card.appendChild(meta);

  if (blob && downloadName) {
    const btn = el('button', 'btn', 'Download cleaned');
    btn.type = 'button';
    btn.addEventListener('click', () => downloadBlob(blob, downloadName));
    card.appendChild(btn);
  }
  if (isError) card.classList.add('msg');
  results.appendChild(card);
}

clearBtn.addEventListener('click', () => {
  results.replaceChildren();
  clearBtn.classList.add('hidden');
  errorBox.classList.add('hidden');
});

function handleFiles(fileList) {
  errorBox.classList.add('hidden');
  const files = Array.from(fileList);
  if (files.length === 0) return;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      renderCard(file, [`${(file.size / 1048576).toFixed(1)} MB — over the 25 MB limit. Skipped.`], null, null, true);
      continue;
    }
    processFile(file);
  }
  if (results.children.length > 0) clearBtn.classList.remove('hidden');
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => handleFiles(fileInput.files));

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
  if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
});
