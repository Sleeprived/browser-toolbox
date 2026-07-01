// "Tap it in": straight-key Morse input for humans copying a signal by ear.
// The on-screen pad always works; the keyboard key (rebindable, Space by
// default) is captured only while "keyboard tapping" is on, so it can't
// hijack scrolling or typing the rest of the time. Committed letters are
// appended to the main input box and an 'input' event is dispatched — the
// existing decode pipeline in morse-ui.js does the rest.

import { createKeyer } from './keyer.js';
import * as player from './player.js';

const $ = (id) => document.getElementById(id);

const inEl = $('morse-in');
const dirEl = $('morse-dir');
const toneEl = $('morse-tone');

const padBtn = $('tap-pad');
const listenBtn = $('tap-listen');
const keyBtn = $('tap-key-change');
const undoBtn = $('tap-undo');
const wpmEl = $('tap-wpm');
const wpmVal = $('tap-wpm-val');
const adaptedEl = $('tap-wpm-adapted');
const beepEl = $('tap-beep');
const pendingEl = $('tap-pending');

const keyer = createKeyer({ wpm: Number(wpmEl.value) });
const now = () => Date.now();

let keyCode = 'Space'; // KeyboardEvent.code — layout-independent
let listening = false; // keyboard capture on/off
let rebinding = false;
let pressed = false;   // a press is in flight (key or pointer)
let flushTimer = 0;

const keyLabel = (code) => code.replace(/^Key/, '').replace(/^Digit/, '') || code;

function syncButtons() {
  listenBtn.textContent = listening ? 'Stop keyboard tapping (Esc)' : 'Start keyboard tapping';
  listenBtn.setAttribute('aria-pressed', String(listening));
  keyBtn.textContent = rebinding
    ? 'Press a key… (Esc cancels)'
    : `Change key (now: ${keyLabel(keyCode)})`;
}

function append(token) {
  const v = inEl.value;
  inEl.value = (v && !/\s$/.test(v) ? `${v} ` : v) + `${token} `;
  inEl.dispatchEvent(new Event('input'));
}

function applyResult({ committed, wordBreak = false }) {
  if (wordBreak) append('/');
  if (committed) append(committed);
  pendingEl.textContent = keyer.pending();
}

function clearFlushTimer() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
}

function pressStart() {
  if (pressed) return;
  pressed = true;
  clearFlushTimer();
  if (dirEl.value !== 'decode') {
    dirEl.value = 'decode';
    dirEl.dispatchEvent(new Event('change'));
  }
  // Commit first: append() triggers update() -> player.stopAll(), which would
  // kill a tone started before it. The tone starts only after the dispatch.
  applyResult(keyer.down(now()));
  padBtn.classList.add('held');
  if (beepEl.checked) player.startTone(Number(toneEl.value));
}

function pressEnd() {
  if (!pressed) return;
  pressed = false;
  player.stopTone();
  padBtn.classList.remove('held');
  keyer.up(now());
  pendingEl.textContent = keyer.pending();
  adaptedEl.textContent = ` — tapping at ~${Math.round(1200 / keyer.unitMs())} WPM`;
  clearFlushTimer();
  flushTimer = setTimeout(() => applyResult(keyer.flush(now())), 2 * keyer.unitMs() + 40);
}

// Stop any in-flight press and commit what is pending (tab hidden, window
// blurred, or keyboard tapping turned off) — a held key is discarded.
function halt() {
  if (pressed) {
    pressed = false;
    player.stopTone();
    padBtn.classList.remove('held');
  }
  clearFlushTimer();
  applyResult(keyer.finish());
}

function stopListening() {
  listening = false;
  halt();
  syncButtons();
}

document.addEventListener('keydown', (e) => {
  if (rebinding) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code && e.code !== 'Escape') keyCode = e.code;
    rebinding = false;
    syncButtons();
    return;
  }
  if (!listening) return;
  if (e.code === 'Escape') { stopListening(); return; }
  if (e.code !== keyCode) return;
  e.preventDefault();
  if (e.repeat) return;
  pressStart();
}, true);

document.addEventListener('keyup', (e) => {
  if (!listening || e.code !== keyCode) return;
  e.preventDefault();
  pressEnd();
}, true);

listenBtn.addEventListener('click', () => {
  if (listening) { stopListening(); return; }
  listening = true;
  inEl.blur(); // the tap key must not also type into the box
  syncButtons();
});

keyBtn.addEventListener('click', () => {
  rebinding = true;
  syncButtons();
});

padBtn.addEventListener('pointerdown', (e) => {
  if (e.isPrimary === false || (typeof e.button === 'number' && e.button > 0)) return;
  e.preventDefault();
  if (typeof padBtn.setPointerCapture === 'function' && e.pointerId !== undefined) {
    try { padBtn.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
  }
  pressStart();
});
padBtn.addEventListener('pointerup', pressEnd);
padBtn.addEventListener('pointercancel', pressEnd);
padBtn.addEventListener('contextmenu', (e) => e.preventDefault()); // mobile long-press

// Keyboard activation of the focused pad (it's a <button>, so Enter/Space must
// key it too). Skipped while keyboard tapping is on — the document-level
// handler owns the keyboard then, and one keystroke must not press twice.
const PAD_KEYS = new Set(['Space', 'Enter', 'NumpadEnter']);
padBtn.addEventListener('keydown', (e) => {
  if (listening || !PAD_KEYS.has(e.code)) return;
  e.preventDefault(); // also suppresses the synthetic click on release
  if (e.repeat) return;
  pressStart();
});
padBtn.addEventListener('keyup', (e) => {
  if (listening || !PAD_KEYS.has(e.code)) return;
  e.preventDefault();
  pressEnd();
});

undoBtn.addEventListener('click', () => {
  const tokens = inEl.value.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return;
  tokens.pop();
  inEl.value = tokens.length ? `${tokens.join(' ')} ` : '';
  inEl.dispatchEvent(new Event('input'));
});

wpmEl.addEventListener('input', () => {
  wpmVal.textContent = wpmEl.value;
  keyer.setWpm(Number(wpmEl.value));
  adaptedEl.textContent = '';
});

window.addEventListener('blur', () => { if (listening) stopListening(); else halt(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (listening) stopListening(); else halt();
});

syncButtons();
