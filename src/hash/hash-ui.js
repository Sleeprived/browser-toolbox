// Hash & Checksum tool. Computes SHA-1/256/384/512 of text or a dropped file using
// Web Crypto, and compares the result against a pasted checksum to verify a
// download. Everything is local — no upload. All output is rendered with
// textContent (the digest is hex; the file name and verdict are inert text).
import { bytesToHex, hexEquals } from './hash.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // hashing reads the whole file into memory; matches the app-wide 25 MB file cap

const textInput = document.getElementById('hash-text');
const algoSel = document.getElementById('hash-algo');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file');
const out = document.getElementById('hash-out');
const sourceEl = document.getElementById('hash-source');
const compareInput = document.getElementById('hash-compare');
const verdictEl = document.getElementById('hash-verdict');
const copyBtn = document.getElementById('hash-copy');
const copied = document.getElementById('hash-copied');
const errorBox = document.getElementById('hash-error');

let lastData = null; // Uint8Array currently being hashed
let lastSource = ''; // human label of the source
let gen = 0; // bumped per input/algo change; stale async digests and file reads are dropped

function showError(msg) { errorBox.textContent = msg; errorBox.classList.remove('hidden'); }
function clearError() { errorBox.classList.add('hidden'); }
// Clear any prior digest + verdict so a rejected or unreadable file can't leave a
// stale "✓ Match" result on screen next to the new error.
function clearResult() { lastData = null; lastSource = ''; out.textContent = ''; sourceEl.textContent = ''; updateVerdict(); }

async function digestHex(algo, data) {
  const buf = await crypto.subtle.digest(algo, data);
  return bytesToHex(new Uint8Array(buf));
}

function updateVerdict() {
  const hash = out.textContent || '';
  const cmp = compareInput.value.trim();
  if (!hash || !cmp) { verdictEl.textContent = ''; verdictEl.className = 'msg hidden'; return; }
  if (hexEquals(hash, cmp)) {
    verdictEl.textContent = '✓ Match — the checksums are identical.';
    verdictEl.className = 'msg ok';
  } else {
    verdictEl.textContent = '✗ No match — the checksums differ.';
    verdictEl.className = 'msg error';
  }
}

async function recompute() {
  // Capture the algorithm and a generation stamp up front: if the algorithm or
  // input changes while the digest is in flight, this result is stale and must
  // not be shown (it would be labeled with the wrong algorithm).
  const my = ++gen;
  const algo = algoSel.value;
  copied.classList.add('hidden');
  if (!lastData) { out.textContent = ''; sourceEl.textContent = ''; updateVerdict(); return; }
  if (!(globalThis.crypto && globalThis.crypto.subtle)) { showError('Hashing is not available in this browser.'); return; }
  try {
    const hex = await digestHex(algo, lastData);
    if (my !== gen) return; // superseded mid-compute
    out.textContent = hex;
    sourceEl.textContent = `${algo} of ${lastSource}`;
    clearError();
  } catch {
    if (my !== gen) return;
    out.textContent = '';
    showError('Could not hash that input.');
  }
  updateVerdict();
}

function setText() {
  const text = textInput.value;
  if (text === '') { lastData = null; lastSource = ''; }
  else { lastData = new TextEncoder().encode(text); lastSource = 'the text input'; }
  recompute();
}

function setFile(file) {
  if (!file) return;
  // Stamp BEFORE validation: a rejected file must also supersede in-flight
  // work, or an older read finishing late would overwrite the rejection error.
  // The stamp also guards a slower file A finishing after file B was chosen (or
  // after new text was typed) from clobbering the newer input.
  const my = ++gen;
  if (file.size > MAX_FILE_BYTES) {
    showError(`That file is ${(file.size / 1048576).toFixed(1)} MB — over the 25 MB limit for in-browser hashing.`);
    clearResult();
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (my !== gen) return; // superseded by a newer input
    lastData = new Uint8Array(reader.result);
    lastSource = `"${file.name}" (${(file.size / 1024).toFixed(0)} KB)`;
    textInput.value = '';
    clearError();
    recompute();
  };
  reader.onerror = () => { if (my !== gen) return; showError('Could not read that file.'); clearResult(); };
  reader.readAsArrayBuffer(file);
}

textInput.addEventListener('input', setText);
algoSel.addEventListener('change', recompute);
compareInput.addEventListener('input', updateVerdict);

copyBtn.addEventListener('click', async () => {
  if (!out.textContent) return;
  let ok = false;
  try { await navigator.clipboard.writeText(out.textContent); ok = true; } catch { ok = false; }
  copied.textContent = ok ? 'Copied to clipboard' : 'Press Ctrl+C to copy';
  copied.classList.remove('hidden');
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => setFile(fileInput.files && fileInput.files[0]));
['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }),
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); }),
);
dropzone.addEventListener('drop', (e) => setFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]));
