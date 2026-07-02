// Timestamp & UUID UI. All rendering via textContent; conversion logic lives
// in timestamp.js.
import { parseEpoch, formatBoth, dateToEpoch, generateUuid, parseUuid } from './timestamp.js';

const epochEl = document.getElementById('ts-epoch');
const nowBtn = document.getElementById('ts-now');
const tsError = document.getElementById('ts-error');
const tsOut = document.getElementById('ts-out');

const dateEl = document.getElementById('ts-date');
const dateError = document.getElementById('ts-date-error');
const dateOut = document.getElementById('ts-date-out');

const genBtn = document.getElementById('uuid-gen');
const uuidOut = document.getElementById('uuid-out');
const uuidIn = document.getElementById('uuid-in');
const uuidError = document.getElementById('uuid-error');
const uuidInfo = document.getElementById('uuid-info');

function set(id, text) {
  document.getElementById(id).textContent = text;
}

function updateEpoch() {
  tsError.classList.add('hidden');
  tsOut.classList.add('hidden');
  if (epochEl.value.trim() === '') return; // cleared — stay quiet
  const res = parseEpoch(epochEl.value);
  if (res.error) {
    tsError.textContent = res.error;
    tsError.classList.remove('hidden');
    return;
  }
  const f = formatBoth(res.ms);
  set('ts-unit', res.unit === 's' ? 'Seconds' : 'Milliseconds');
  set('ts-local', f.local);
  set('ts-utc', f.utc);
  set('ts-iso', f.iso);
  tsOut.classList.remove('hidden');
}

function updateDate() {
  dateError.classList.add('hidden');
  dateOut.classList.add('hidden');
  if (!dateEl.value) return;
  const d = new Date(dateEl.value); // datetime-local parses in the local zone
  if (Number.isNaN(d.getTime())) {
    dateError.textContent = 'Not a valid date and time.';
    dateError.classList.remove('hidden');
    return;
  }
  const { s, ms } = dateToEpoch(d);
  set('ts-date-s', String(s));
  set('ts-date-ms', String(ms));
  dateOut.classList.remove('hidden');
}

function updateUuid() {
  uuidError.classList.add('hidden');
  uuidInfo.classList.add('hidden');
  if (uuidIn.value.trim() === '') return;
  const res = parseUuid(uuidIn.value);
  if (res.error) {
    uuidError.textContent = res.error;
    uuidError.classList.remove('hidden');
    return;
  }
  set('uuid-version', String(res.version));
  set('uuid-variant', res.variant);
  set('uuid-time', res.timestampMs !== undefined
    ? formatBoth(res.timestampMs).iso
    : 'Not applicable for this version');
  uuidInfo.classList.remove('hidden');
}

nowBtn.addEventListener('click', () => {
  epochEl.value = String(Math.floor(Date.now() / 1000));
  updateEpoch();
});

genBtn.addEventListener('click', () => {
  uuidOut.textContent = generateUuid();
  uuidOut.classList.remove('hidden');
});

epochEl.addEventListener('input', updateEpoch);
dateEl.addEventListener('input', updateDate);
uuidIn.addEventListener('input', updateUuid);
