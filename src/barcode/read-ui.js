// Read tab: decode an uploaded Code 128 / EAN-13 / UPC-A image locally and show
// what it contains plus how to recreate it. Decoded bytes are untrusted input —
// everything is rendered with textContent, never innerHTML, and the data is
// re-validated against the target format before it is placed in the generator.
// When linear decoding fails, the bitmap is probed with the already-vendored
// jsQR: if it decodes as a QR code the user gets a cross-link hint instead of a
// bare failure.
import { decodeImageData } from './decode.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 2048; // cap canvas dimension to bound memory on huge images
const MAX_IMAGE_PIXELS = 64 * 1000 * 1000; // decompression-bomb guard, matches qr/image/palette
const MAX_CODE128 = 120; // mirror the generator's input cap

const FORMAT_LABEL = { code128: 'Code 128', ean13: 'EAN-13', upca: 'UPC-A' };

// ---- tab switching (same pattern as qr.html) ------------------------------
const tabCreate = document.getElementById('tab-create');
const tabRead = document.getElementById('tab-read');
const panelCreate = document.getElementById('panel-create');
const panelRead = document.getElementById('panel-read');

function selectTab(which) {
  const create = which === 'create';
  tabCreate.setAttribute('aria-selected', String(create));
  tabRead.setAttribute('aria-selected', String(!create));
  tabCreate.tabIndex = create ? 0 : -1;
  tabRead.tabIndex = create ? -1 : 0;
  panelCreate.hidden = !create;
  panelRead.hidden = create;
}

tabCreate.addEventListener('click', () => selectTab('create'));
tabRead.addEventListener('click', () => selectTab('read'));
for (const tab of [tabCreate, tabRead]) {
  tab.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = tab === tabCreate ? tabRead : tabCreate;
      selectTab(next === tabCreate ? 'create' : 'read');
      next.focus();
    }
  });
}

// ---- DOM helpers -----------------------------------------------------------
const dropzone = document.getElementById('read-dropzone');
const fileInput = document.getElementById('read-file');
const errorBox = document.getElementById('read-error');
const qrHint = document.getElementById('read-qr-hint');
const results = document.getElementById('read-results');

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text; // textContent = XSS-safe
  return e;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
  results.replaceChildren();
}

function clearMessages() {
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
  qrHint.classList.add('hidden');
}

// ---- recreate flow ---------------------------------------------------------
// Validate the decoded data against the target format's charset/length before
// touching the generator form — decoded bytes are untrusted.
function canRecreate(res) {
  if (res.format === 'code128') {
    return res.text.length > 0 && res.text.length <= MAX_CODE128 && /^[\x20-\x7E]+$/.test(res.text);
  }
  if (res.format === 'ean13') return /^\d{13}$/.test(res.text);
  if (res.format === 'upca') return /^\d{12}$/.test(res.text);
  return false;
}

function recreate(res) {
  const symSel = document.getElementById('symbology');
  const dataInput = document.getElementById('data');
  symSel.value = res.format;
  symSel.dispatchEvent(new Event('change'));
  dataInput.value = res.text;
  dataInput.dispatchEvent(new Event('input'));
  selectTab('create');
  symSel.focus();
}

// ---- result rendering ------------------------------------------------------
// Exported for tests: renders a decode result without needing canvas.
export function showResult(res) {
  clearMessages();
  const card = el('div', 'card');
  card.appendChild(el('div', 'read-kind', `${FORMAT_LABEL[res.format] || 'Barcode'} detected`));

  // Code set A can encode ASCII control characters, which render invisibly —
  // show them as Unicode control pictures (␀…␡) so the display never differs
  // silently from the decoded bytes. (Recreate is charset-blocked anyway.)
  const pre = el('pre', 'out', res.text.replace(/[\x00-\x1f\x7f]/g,
    (c) => String.fromCharCode(c.charCodeAt(0) === 0x7f ? 0x2421 : 0x2400 + c.charCodeAt(0))));
  card.appendChild(pre);

  const dl = el('dl', 'read-fields');
  const add = (label, value) => {
    dl.appendChild(el('dt', null, label));
    dl.appendChild(el('dd', null, value));
  };
  if (res.format === 'code128') {
    add('Check symbol', `${res.checkSymbol} — validates (mod 103)`);
    add('Code set(s) used', res.codeSets.join(', '));
    if (res.fnc1) add('FNC1', 'Contains FNC1 (GS1) separators — the fields are shown run together');
  } else {
    add('Check digit', `${res.checkDigit} — validates`);
    if (res.format === 'ean13') {
      add('First digit', `${res.firstDigit} — implied by the left-half parity pattern, not drawn as bars`);
    } else {
      add('Encoding', 'UPC-A is EAN-13 with an implied leading 0 (same 95 modules)');
    }
  }
  if (res.reversed) add('Orientation', 'The image was upside-down — decoded right-to-left');
  add('Quiet zone', 'When reprinting, keep a light margin of at least 10 module widths on each side so scanners can find the edges');
  card.appendChild(dl);

  const row = el('div', 'btn-row');
  const btn = el('button', 'btn', 'Recreate in the generator');
  btn.type = 'button';
  if (res.fnc1) {
    // The generator has no FNC1 support — recreating would silently produce a
    // plain Code 128 that fails GS1 verification.
    btn.disabled = true;
    row.appendChild(el('span', 'lead', 'GS1 (FNC1) barcodes cannot be recreated — the generator would produce a plain Code 128 without the separators.'));
  } else if (canRecreate(res)) {
    btn.addEventListener('click', () => recreate(res));
  } else {
    btn.disabled = true;
    row.appendChild(el('span', 'lead', res.text === ''
      ? 'This barcode carries no data to recreate.'
      : 'This data contains characters the generator cannot encode.'));
  }
  row.prepend(btn);
  card.appendChild(row);

  results.replaceChildren(card);
}

function showFailure(qrFound) {
  results.replaceChildren();
  if (qrFound) {
    errorBox.classList.add('hidden');
    qrHint.classList.remove('hidden');
    return;
  }
  showError(
    "Couldn't read a barcode in that image. Try a sharper, straight-on picture with the " +
    'barcode large in the frame — blurry, rotated, or skewed images are not corrected.',
  );
}

// ---- decode pipeline -------------------------------------------------------
// Bumped per chosen file; both async hops check it so a slow file A can never
// overwrite file B's result.
let loadGen = 0;

function decodeImage(dataUrl, gen) {
  const img = new Image();
  img.onload = () => {
    if (gen !== loadGen) return; // superseded by a newer file
    if (img.naturalWidth * img.naturalHeight > MAX_IMAGE_PIXELS) {
      showError(`That image is ${img.naturalWidth}×${img.naturalHeight} — too large to process safely.`);
      return;
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, w, h);
    } catch {
      showError('Could not read the image pixels.');
      return;
    }
    const res = decodeImageData(imageData);
    if (res) {
      showResult(res);
      return;
    }
    // Linear decode failed — probe with jsQR so a QR code gets a helpful
    // cross-link instead of a bare failure.
    let qrFound = false;
    if (typeof window.jsQR === 'function') {
      const code = window.jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
      qrFound = !!(code && code.data);
    }
    showFailure(qrFound);
  };
  img.onerror = () => { if (gen === loadGen) showError('That file could not be read as an image.'); };
  img.src = dataUrl;
}

function handleFile(file) {
  clearMessages();
  if (!file) return;
  // Bump BEFORE validation: a rejected file must also supersede in-flight
  // work, or an older decode finishing late would overwrite the rejection error.
  const gen = ++loadGen;
  // Fast-fail non-images (drag-drop bypasses the input's accept filter) before
  // base64-reading megabytes only for img.onerror to reject them. An empty
  // type is allowed — some platforms omit it for dropped files.
  if (file.type && !file.type.startsWith('image/')) {
    showError('Please choose an image file.');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showError(`${(file.size / 1048576).toFixed(1)} MB — over the 25 MB limit.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => { if (gen === loadGen) decodeImage(reader.result, gen); };
  reader.onerror = () => { if (gen === loadGen) showError('Could not read that file.'); };
  reader.readAsDataURL(file);
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  handleFile(fileInput.files && fileInput.files[0]);
  fileInput.value = ''; // re-choosing the same file must fire change again
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
  if (e.dataTransfer && e.dataTransfer.files) handleFile(e.dataTransfer.files[0]);
});
