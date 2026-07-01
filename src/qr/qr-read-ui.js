// Read tab: decode a QR image locally and show what it contains plus a local
// heuristic safety check. Decoded content is untrusted — everything is rendered
// with textContent, never innerHTML, and no link is ever auto-opened.
import { parseQrPayload } from './decode.js';
import { analyzePayload } from './risk.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 2048; // cap canvas dimension to bound memory on huge images
// A small file can still decode to an enormous bitmap (decompression bomb). The
// canvas downscale below only bounds the OUTPUT canvas — the browser still decodes
// the full-resolution source first — so reject implausibly large images outright.
const MAX_IMAGE_PIXELS = 64 * 1000 * 1000; // 64 MP (~256 MB peak bitmap) — matches the image/palette guards

const KIND_LABEL = {
  url: 'Link (URL)',
  wifi: 'Wi-Fi network',
  vcard: 'Contact card',
  email: 'Email',
  sms: 'Text message (SMS)',
  geo: 'Map location',
  tel: 'Phone number',
  text: 'Plain text',
};

const LEVEL = {
  danger: { cls: 'msg error', word: 'Danger' },
  caution: { cls: 'msg warn', word: 'Caution' },
  info: { cls: 'msg note', word: 'Note' },
};

const DISCLAIMER =
  'This is a local heuristic check, not a guarantee — it can flag warning signs ' +
  'but cannot confirm something is safe. Always verify before you act.';

// ---- tab switching -------------------------------------------------------
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

// ---- DOM helpers ---------------------------------------------------------
const dropzone = document.getElementById('read-dropzone');
const fileInput = document.getElementById('read-file');
const errorBox = document.getElementById('read-error');
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

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

// ---- rendering -----------------------------------------------------------
function fieldList(pairs) {
  const dl = el('dl', 'read-fields');
  for (const [label, value] of pairs) {
    if (value == null || value === '') continue;
    dl.appendChild(el('dt', null, label));
    dl.appendChild(el('dd', null, String(value)));
  }
  return dl;
}

function fieldsFor(parsed) {
  const f = parsed.fields || {};
  switch (parsed.kind) {
    case 'url': {
      const pairs = [['Opens', f.url]];
      try {
        pairs.push(['Domain', new URL(f.url).hostname]);
      } catch { /* not a parseable URL; the 'Opens' row already shows it */ }
      return fieldList(pairs);
    }
    case 'wifi':
      return fieldList([
        ['Network (SSID)', f.ssid],
        ['Security', f.auth],
        ['Password', f.auth === 'nopass' ? '(none)' : f.password],
        ['Hidden', f.hidden ? 'yes' : 'no'],
      ]);
    case 'vcard':
      return fieldList([['Name', f.name], ['Organization', f.org], ['Phone', f.phone], ['Email', f.email]]);
    case 'email':
      return fieldList([['To', f.to], ['Subject', f.subject], ['Message', f.body]]);
    case 'sms':
      return fieldList([['Number', f.number], ['Message', f.message]]);
    case 'geo':
      return fieldList([['Latitude', f.lat], ['Longitude', f.lng]]);
    case 'tel':
      return fieldList([['Number', f.number]]);
    default:
      return fieldList([['Text', f.text]]);
  }
}

function renderResult(raw) {
  const parsed = parseQrPayload(raw);
  const findings = analyzePayload(parsed);

  const card = el('div', 'card');
  card.appendChild(el('div', 'read-kind', KIND_LABEL[parsed.kind] || 'Decoded'));
  card.appendChild(fieldsFor(parsed));

  // Findings (each prefixed with a level word so it does not rely on color alone).
  for (const finding of findings) {
    const meta = LEVEL[finding.level] || LEVEL.info;
    const box = el('div', meta.cls);
    box.appendChild(el('strong', null, meta.word + ' — '));
    box.appendChild(document.createTextNode(finding.message));
    card.appendChild(box);
  }

  card.appendChild(el('div', 'msg note read-disclaimer', DISCLAIMER));

  // Copy button (no auto-open of links by design).
  const row = el('div', 'btn-row');
  const copyBtn = el('button', 'btn secondary', 'Copy decoded text');
  copyBtn.type = 'button';
  const copyMsg = el('span', 'lead read-copied');
  copyBtn.addEventListener('click', () => {
    if (!(navigator.clipboard && navigator.clipboard.writeText)) {
      copyMsg.textContent = 'Copying is not supported in this browser.';
      return;
    }
    navigator.clipboard.writeText(parsed.raw).then(
      () => { copyMsg.textContent = 'Copied.'; },
      () => { copyMsg.textContent = 'Could not copy.'; },
    );
  });
  row.appendChild(copyBtn);
  row.appendChild(copyMsg);
  card.appendChild(row);

  // Raw decoded text, collapsed, always inert.
  const details = el('details', 'read-raw');
  details.appendChild(el('summary', null, 'Raw decoded text'));
  details.appendChild(el('pre', 'out', parsed.raw));
  card.appendChild(details);

  results.replaceChildren(card);
}

// ---- decode pipeline -----------------------------------------------------
function decodeImage(dataUrl) {
  const img = new Image();
  img.onload = () => {
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
    if (typeof window.jsQR !== 'function') {
      showError('The QR decoder failed to load. Refresh the page and try again.');
      return;
    }
    const code = window.jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (!code || !code.data) {
      showError('No QR code found in that image — try a clearer photo or a tighter crop around the code.');
      return;
    }
    clearError();
    renderResult(code.data);
  };
  img.onerror = () => showError('That file could not be read as an image.');
  img.src = dataUrl;
}

function handleFile(file) {
  clearError();
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    showError(`${(file.size / 1048576).toFixed(1)} MB — over the 25 MB limit.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => decodeImage(reader.result);
  reader.onerror = () => showError('Could not read that file.');
  reader.readAsDataURL(file);
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => handleFile(fileInput.files && fileInput.files[0]));

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
