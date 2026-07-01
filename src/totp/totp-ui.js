// Standalone TOTP/2FA generator. Reuses the vault's tested TOTP engine. Generates
// a live code (with countdown) from a base32 secret or an otpauth:// URI. Nothing
// is stored — the secret lives only in this tab's memory. All output is rendered
// with textContent (never innerHTML), so a crafted issuer/label cannot inject markup.
import { base32Decode, totp, secondsRemaining, TotpError } from '../vault/totp.js';
import { parseOtpauth } from './otpauth.js';

const input = document.getElementById('totp-in');
const errorBox = document.getElementById('totp-error');
const resultBox = document.getElementById('totp-result');
const codeEl = document.getElementById('totp-code');
const countEl = document.getElementById('totp-count');
const metaEl = document.getElementById('totp-meta');
const copyBtn = document.getElementById('totp-copy');
const copied = document.getElementById('totp-copied');

let params = null; // parsed otpauth config
let keyBytes = null; // decoded base32 secret
let timer = null;
let wipeTimer = null; // wipes the secret from memory after the tab stays hidden a while
const WIPE_AFTER_HIDDEN_MS = 60000;

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
  resultBox.classList.add('hidden');
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

// Drop the decoded secret + parsed config from memory and clear the input, so a
// pasted 2FA secret does not linger in a backgrounded or unloaded tab. Mirrors the
// vault's lock-on-hide discipline (the standalone tool has no separate master gate).
function wipeSecret() {
  stop();
  keyBytes = null;
  params = null;
  input.value = '';
  codeEl.textContent = '';
  countEl.textContent = '';
  metaEl.textContent = '';
  resultBox.classList.add('hidden');
  errorBox.classList.add('hidden');
}

function formatCode(code) {
  // Group into two halves for readability (e.g. "123 456").
  if (code.length === 6 || code.length === 8) {
    const half = code.length / 2;
    return `${code.slice(0, half)} ${code.slice(half)}`;
  }
  return code;
}

async function tick() {
  if (!keyBytes || !params) return;
  const time = Date.now() / 1000;
  try {
    const code = await totp(keyBytes, { time, period: params.period, digits: params.digits, algorithm: params.algorithm });
    codeEl.textContent = formatCode(code);
    countEl.textContent = `${secondsRemaining(Math.floor(time), params.period)}s`;
  } catch (e) {
    stop();
    showError(e instanceof TotpError ? e.message : 'Could not generate a code from that secret.');
  }
}

function update() {
  copied.classList.add('hidden');
  stop();
  const raw = input.value.trim();
  if (raw === '') {
    errorBox.classList.add('hidden');
    resultBox.classList.add('hidden');
    keyBytes = null;
    params = null;
    return;
  }
  params = parseOtpauth(raw);
  if (!params || !params.secret) { showError('Enter a base32 secret or an otpauth:// URI.'); return; }
  if (params.type !== 'totp') { showError(`This tool generates time-based (TOTP) codes; "${params.type}" is not supported.`); return; }
  try {
    keyBytes = base32Decode(params.secret);
  } catch (e) {
    showError(e instanceof TotpError ? e.message : 'That secret is not valid base32.');
    return;
  }
  if (keyBytes.length === 0) { showError('That secret is empty after decoding.'); return; }

  errorBox.classList.add('hidden');
  resultBox.classList.remove('hidden');
  const parts = [];
  const name = params.issuer || params.label;
  if (name) parts.push(name);
  parts.push(`${params.digits} digits`, `${params.period}s period`, params.algorithm);
  metaEl.textContent = parts.join(' · '); // textContent — safe even if the URI carried markup
  tick();
  timer = setInterval(tick, 1000);
}

copyBtn.addEventListener('click', async () => {
  const code = (codeEl.textContent || '').replace(/\s+/g, '');
  if (!code) return;
  let ok = false;
  try { await navigator.clipboard.writeText(code); ok = true; } catch { ok = false; }
  copied.textContent = ok ? 'Copied to clipboard' : 'Press Ctrl+C to copy';
  copied.classList.remove('hidden');
});

input.addEventListener('input', update);
// Stop the timer when the tab is hidden; resume on return so a backgrounded tab
// isn't spinning a 1s interval forever. After a longer hidden period (or on page
// unload) wipe the decoded secret from memory entirely.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stop();
    clearTimeout(wipeTimer);
    wipeTimer = setTimeout(wipeSecret, WIPE_AFTER_HIDDEN_MS);
  } else {
    clearTimeout(wipeTimer);
    if (keyBytes && !timer) { tick(); timer = setInterval(tick, 1000); }
  }
});
window.addEventListener('pagehide', wipeSecret);
update();
