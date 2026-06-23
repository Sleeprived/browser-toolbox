import { decodeJwt, describeClaims, securityFlags, expiryStatus, JwtError } from './jwt.js';

const input = document.getElementById('jwt-in');
const errorBox = document.getElementById('jwt-error');
const resultBox = document.getElementById('jwt-result');
const headerEl = document.getElementById('jwt-header');
const payloadEl = document.getElementById('jwt-payload');
const claimsEl = document.getElementById('jwt-claims');
const flagsEl = document.getElementById('jwt-flags');
const secretInput = document.getElementById('jwt-secret');
const verifyBtn = document.getElementById('jwt-verify');
const verdictEl = document.getElementById('jwt-verdict');

let current = null;

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
  resultBox.classList.add('hidden');
}

function render() {
  const text = input.value.trim();
  verdictEl.textContent = '';
  if (text === '') {
    errorBox.classList.add('hidden');
    resultBox.classList.add('hidden');
    current = null;
    return;
  }
  let decoded;
  try {
    decoded = decodeJwt(text);
  } catch (e) {
    current = null;
    showError(e instanceof JwtError ? e.message : 'Could not decode that token.');
    return;
  }
  current = decoded;
  try {
    headerEl.textContent = JSON.stringify(decoded.header, null, 2);
    payloadEl.textContent = JSON.stringify(decoded.payload, null, 2);

    claimsEl.replaceChildren();
    const status = expiryStatus(decoded.payload, Date.now());
    for (const c of describeClaims(decoded.payload, Date.now())) {
      const li = document.createElement('li');
      li.textContent = c.relative ? `${c.label}: ${c.iso} (${c.relative})` : `${c.label}: ${c.iso}`;
      claimsEl.appendChild(li);
    }
    if (status !== 'active') {
      const li = document.createElement('li');
      li.textContent = status === 'expired' ? 'This token has EXPIRED.' : 'This token is NOT YET valid.';
      claimsEl.appendChild(li);
    }

    flagsEl.replaceChildren();
    for (const w of securityFlags(decoded.header, decoded.payload)) {
      const d = document.createElement('div');
      d.className = 'msg warn';
      d.textContent = w;
      flagsEl.appendChild(d);
    }

    errorBox.classList.add('hidden');
    resultBox.classList.remove('hidden');
  } catch (e) {
    current = null;
    showError('Could not display that token.');
  }
}

const HASH = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };

verifyBtn.addEventListener('click', async () => {
  if (!current) { verdictEl.textContent = 'Decode a token first.'; return; }
  const alg = current.header && current.header.alg;
  const hash = HASH[alg];
  if (!hash) {
    verdictEl.textContent = `Only HS256/384/512 can be verified here. This token uses "${alg}".`;
    return;
  }
  if (!secretInput.value) { verdictEl.textContent = 'Enter the secret to verify.'; return; }
  if (!(globalThis.crypto && globalThis.crypto.subtle)) {
    verdictEl.textContent = 'Signature verification is not available in this browser.';
    return;
  }
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secretInput.value),
      { name: 'HMAC', hash }, false, ['verify'],
    );
    const sig = b64urlToBytes(current.signature);
    const ok = await crypto.subtle.verify('HMAC', key, sig, enc.encode(current.signingInput));
    verdictEl.textContent = ok
      ? `✓ Signature VALID for ${alg} with this secret. (This checks the signature only — not the claims.)`
      : `✗ Signature INVALID for ${alg} with this secret.`;
  } catch {
    verdictEl.textContent = 'Could not verify (malformed signature or secret).';
  }
});

function b64urlToBytes(seg) {
  let s = String(seg).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

input.addEventListener('input', render);
// Editing the secret invalidates any prior verdict so a stale "VALID" can never
// linger next to a secret it was not checked against.
secretInput.addEventListener('input', () => { verdictEl.textContent = ''; });
render();
