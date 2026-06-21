import { convert, EncodeError } from './encode.js';

const input = document.getElementById('enc-in');
const formatSel = document.getElementById('enc-format');
const modeSel = document.getElementById('enc-mode');
const errorBox = document.getElementById('enc-error');
const out = document.getElementById('enc-out');
const copyBtn = document.getElementById('enc-copy');
const copied = document.getElementById('enc-copied');

function update() {
  copied.classList.add('hidden');
  const text = input.value;
  if (text === '') {
    errorBox.classList.add('hidden');
    out.textContent = '';
    return;
  }
  try {
    out.textContent = convert(text, formatSel.value, modeSel.value); // textContent = XSS-safe
    errorBox.classList.add('hidden');
  } catch (e) {
    out.textContent = '';
    errorBox.textContent = e instanceof EncodeError ? e.message : 'Could not convert that input.';
    errorBox.classList.remove('hidden');
  }
}

copyBtn.addEventListener('click', async () => {
  if (!out.textContent) return;
  let ok = false;
  try { await navigator.clipboard.writeText(out.textContent); ok = true; } catch { ok = false; }
  copied.textContent = ok ? 'Copied to clipboard' : 'Press Ctrl+C to copy';
  copied.classList.remove('hidden');
});

for (const el of [input, formatSel, modeSel]) {
  el.addEventListener('input', update);
  el.addEventListener('change', update);
}
update();
