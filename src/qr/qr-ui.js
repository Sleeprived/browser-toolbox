import {
  formatText,
  formatUrl,
  formatWifi,
  formatVcard,
  formatEmail,
  formatSms,
  formatGeo,
  formatTel,
} from './payloads.js';
import { getQrMatrix } from './matrix.js';
import { utf8ByteLength, colorWarning } from './quality.js';

const typeSel = document.getElementById('type');
const eclSel = document.getElementById('ecl');
const forms = {
  text: document.getElementById('form-text'),
  wifi: document.getElementById('form-wifi'),
  vcard: document.getElementById('form-vcard'),
  email: document.getElementById('form-email'),
  sms: document.getElementById('form-sms'),
  geo: document.getElementById('form-geo'),
  tel: document.getElementById('form-tel'),
};
const errorBox = document.getElementById('error');
const resultBox = document.getElementById('result');
const canvas = document.getElementById('canvas');
const payloadEl = document.getElementById('payload');
const capacityEl = document.getElementById('capacity');
const dlPng = document.getElementById('dl-png');
const dlSvg = document.getElementById('dl-svg');
const copyImgBtn = document.getElementById('copy-img');
const copiedMsg = document.getElementById('copied');

const fgInput = document.getElementById('fg');
const bgInput = document.getElementById('bg');
const sizeSel = document.getElementById('size');
const marginRange = document.getElementById('margin');
const marginVal = document.getElementById('margin-val');
const colorWarn = document.getElementById('color-warn');

let currentMatrix = null;

function buildPayload() {
  const type = typeSel.value;
  if (type === 'text') {
    const v = document.getElementById('text-val').value.trim();
    // A bare domain becomes a URL; anything else is sent as-is.
    return /^[\w.+-]+\.[a-z]{2,}(\/\S*)?$/i.test(v) ? formatUrl(v) : formatText(v);
  }
  if (type === 'wifi') {
    return formatWifi({
      ssid: document.getElementById('wifi-ssid').value,
      password: document.getElementById('wifi-pass').value,
      encryption: document.getElementById('wifi-enc').value,
      hidden: document.getElementById('wifi-hidden').checked,
    });
  }
  if (type === 'vcard') {
    return formatVcard({
      name: document.getElementById('vc-name').value,
      org: document.getElementById('vc-org').value,
      phone: document.getElementById('vc-phone').value,
      email: document.getElementById('vc-email').value,
    });
  }
  if (type === 'email') {
    return formatEmail({
      to: document.getElementById('em-to').value,
      subject: document.getElementById('em-subject').value,
      body: document.getElementById('em-body').value,
    });
  }
  if (type === 'sms') {
    return formatSms({
      number: document.getElementById('sms-number').value,
      message: document.getElementById('sms-message').value,
    });
  }
  if (type === 'geo') {
    return formatGeo({
      lat: document.getElementById('geo-lat').value,
      lng: document.getElementById('geo-lng').value,
    });
  }
  if (type === 'tel') {
    return formatTel({ number: document.getElementById('tel-number').value });
  }
  return '';
}

function margin() {
  return Math.max(0, Number(marginRange.value) || 0);
}

function drawCanvas(matrix) {
  const { size, modules } = matrix;
  const m = margin();
  const total = size + m * 2;
  const target = Number(sizeSel.value) || 512;
  const scale = Math.max(1, Math.floor(target / total));
  const px = total * scale;
  canvas.width = px;
  canvas.height = px;
  // Render at the chosen export resolution; display capped for the preview.
  const displayPx = Math.min(300, px);
  canvas.style.width = displayPx + 'px';
  canvas.style.height = displayPx + 'px';

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bgInput.value;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = fgInput.value;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        ctx.fillRect((c + m) * scale, (r + m) * scale, scale, scale);
      }
    }
  }
}

function matrixToSvg(matrix) {
  const { size, modules } = matrix;
  const m = margin();
  const total = size + m * 2;
  let rects = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) rects += `<rect x="${c + m}" y="${r + m}" width="1" height="1"/>`;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${bgInput.value}"/>` +
    `<g fill="${fgInput.value}">${rects}</g></svg>`;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
  resultBox.classList.add('hidden');
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

function update() {
  for (const [key, el] of Object.entries(forms)) {
    el.classList.toggle('hidden', key !== typeSel.value);
  }
  marginVal.textContent = marginRange.value;
  refreshColorWarning();

  let payload;
  try {
    payload = buildPayload();
  } catch (e) {
    showError(e && e.message ? e.message : String(e)); // e.g. out-of-range geo
    return;
  }
  if (!payload) {
    errorBox.classList.add('hidden');
    resultBox.classList.add('hidden');
    return;
  }
  try {
    currentMatrix = getQrMatrix(payload, eclSel.value);
    drawCanvas(currentMatrix);
    payloadEl.textContent = payload;
    capacityEl.textContent =
      `${utf8ByteLength(payload)} bytes · QR version ${currentMatrix.version} ` +
      `(${currentMatrix.size}×${currentMatrix.size}) · error correction ${eclSel.value}`;
    copiedMsg.classList.add('hidden');
    errorBox.classList.add('hidden');
    resultBox.classList.remove('hidden');
  } catch (e) {
    showError(e && e.message ? e.message : String(e));
  }
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
  if (!currentMatrix) return;
  canvas.toBlob((blob) => blob && downloadBlob(blob, 'qr-code.png'), 'image/png');
});

dlSvg.addEventListener('click', () => {
  if (!currentMatrix) return;
  downloadBlob(new Blob([matrixToSvg(currentMatrix)], { type: 'image/svg+xml' }), 'qr-code.svg');
});

copyImgBtn.addEventListener('click', () => {
  if (!currentMatrix) return;
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

typeSel.addEventListener('change', update);
eclSel.addEventListener('change', update);
for (const el of document.querySelectorAll('.qr-form input, .qr-form select, .qr-form textarea')) {
  el.addEventListener('input', update);
  el.addEventListener('change', update);
}
for (const el of [fgInput, bgInput, sizeSel, marginRange]) {
  el.addEventListener('input', update);
  el.addEventListener('change', update);
}

update();
