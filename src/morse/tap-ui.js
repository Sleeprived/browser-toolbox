// "Tap it in": straight-key Morse input for humans copying a signal by ear.
// The on-screen pad always works; the keyboard key (rebindable, Space by
// default) is captured only while "keyboard tapping" is on, so it can't
// hijack scrolling or typing the rest of the time. Committed letters are
// appended to the Morse pane and an 'input' event is dispatched — the
// two-way sync in morse-ui.js does the rest.

import { createKeyer } from './keyer.js';
import { morseToText } from './morse.js';
import { buildTimeline } from './timing.js';
import * as player from './player.js';

const $ = (id) => document.getElementById(id);

const textEl = $('morse-in');
const codeEl = $('morse-out'); // taps land here (the Morse pane)
const toneEl = $('morse-tone');

// On a stale cached page (pre-1.12) the Morse pane is still a <pre>; the
// shim keeps taps working on either markup.
const codeIsField = 'value' in codeEl;
const getCode = () => (codeIsField ? codeEl.value : codeEl.textContent);
const setCode = (v) => { if (codeIsField) codeEl.value = v; else codeEl.textContent = v; };

// Both panes are rewritten programmatically on every tap; if one of them
// still holds focus from an earlier typing session, mobile browsers scroll
// the focused box (at the very top of the page) back into view mid-tap —
// yanking the pad out from under the user's finger. Tapping is not typing:
// drop that focus.
function blurPanes() {
  const active = document.activeElement;
  if (active === textEl || active === codeEl) active.blur();
}

const padBtn = $('tap-pad');
const listenBtn = $('tap-listen');
const keyBtn = $('tap-key-change');
const undoBtn = $('tap-undo');
const clearBtn = $('tap-clear');
const wpmEl = $('tap-wpm');
const wpmVal = $('tap-wpm-val');
const adaptedEl = $('tap-wpm-adapted');
const beepEl = $('tap-beep');
const tapMorseEl = $('tap-morse');
const tapOutEl = $('tap-out');
const tapPlayBtn = $('tap-play');
const tapStopBtn = $('tap-stop');
const sigWpmEl = $('morse-wpm');
const sigCwpmEl = $('morse-cwpm');

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
    ? 'Press a key… (Esc or click here cancels)'
    : `Change key (now: ${keyLabel(keyCode)})`;
}

function append(token) {
  const v = getCode();
  setCode((v && !/\s$/.test(v) ? `${v} ` : v) + `${token} `);
  codeEl.dispatchEvent(new Event('input'));
}

// In-card mirror of what was actually TAPPED (committed tokens plus the
// in-progress letter) and its translation, so nobody has to scroll while
// keying. Deliberately NOT a mirror of the Morse pane: pasted or hand-typed
// content must never be presented as the user's taps.
const tapped = [];

function renderTapView() {
  // A stale cached page (SW stale-while-revalidate) may predate the mirror
  // elements; the mirror is a nicety, keying must keep working without it.
  if (!tapMorseEl || !tapOutEl) return;
  const morse = tapped.join(' ');
  const pending = keyer.pending();
  tapMorseEl.textContent = morse + (pending ? `${morse ? ' ' : ''}${pending}` : '');
  tapOutEl.textContent = morseToText(morse);
}

function applyResult({ committed, wordBreak = false }) {
  // When both arrive together, the committed letter predates the word gap that
  // follows it — the letter must land before the '/'.
  if (committed) { append(committed); tapped.push(committed); }
  if (wordBreak) { append('/'); tapped.push('/'); }
  renderTapView();
}

function clearFlushTimer() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
}

function pressStart() {
  if (pressed) return;
  pressed = true;
  clearFlushTimer();
  blurPanes(); // mobile scroll-to-top guard — see blurPanes()
  // Commit first: append() triggers the pane sync -> player.stopAll(), which
  // would kill a tone started before it. The tone starts only after the
  // dispatch.
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
  renderTapView();
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

// Keys that must never become the tap key: Tab (keyboard navigation) and bare
// modifiers (held as part of ordinary shortcuts).
const UNBINDABLE = /^(Tab|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight|MetaLeft|MetaRight)$/;

document.addEventListener('keydown', (e) => {
  if (rebinding) {
    if (e.code && UNBINDABLE.test(e.code)) return; // ignored — rebind stays armed
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
  blurPanes(); // the tap key must not also type into a box
  syncButtons();
});

// Toggle: clicking again is the visible cancel path — without it, an armed
// rebind waits forever and swallows the next keystroke anywhere on the page.
keyBtn.addEventListener('click', () => {
  rebinding = !rebinding;
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
  const tokens = getCode().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return;
  const removed = tokens.pop();
  setCode(tokens.length ? `${tokens.join(' ')} ` : '');
  codeEl.dispatchEvent(new Event('input'));
  // Keep the tap mirror honest: if the undone token was the last tapped one,
  // drop it from the mirror too.
  if (tapped.length && tapped[tapped.length - 1] === removed) {
    tapped.pop();
    renderTapView();
  }
});

// Hear the tapped Morse right in this card, using the Signal output card's
// speed/tone settings. player.playAudio() preempts the translate card's Play
// without firing its onEnd, so announce the takeover and morse-ui resets its
// buttons. No duration cap needed: the timeline is bounded by how long a
// human can physically tap. (Optional chaining throughout: these controls
// may be absent on a stale cached page.)
tapPlayBtn?.addEventListener('click', () => {
  const morse = tapped.join(' ');
  if (!morse) return;
  const wpm = Number(sigWpmEl?.value) || 20;
  const charWpm = Math.max(wpm, Number(sigCwpmEl?.value) || wpm);
  document.dispatchEvent(new Event('morse-playback-reset'));
  player.playAudio(buildTimeline(morse, { wpm, charWpm }), { freq: Number(toneEl?.value) || 600 });
});

tapStopBtn?.addEventListener('click', () => {
  player.stopAll();
  document.dispatchEvent(new Event('morse-playback-reset'));
});

// Reset the tap mirror only — the taps already committed to the Morse pane stay.
// Any letter still pending in the keyer is discarded with it. (Optional
// chaining: the button may be absent on a stale cached page.)
clearBtn?.addEventListener('click', () => {
  clearFlushTimer();
  keyer.finish(); // result ignored: discard, don't commit
  tapped.length = 0;
  renderTapView();
});

// An emptied Morse pane (Clear button, select-all + delete) is a fresh start —
// a surviving tap transcript would show taps that are no longer anywhere.
codeEl.addEventListener('input', () => {
  if (tapped.length && getCode().trim() === '') {
    tapped.length = 0;
    renderTapView();
  }
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
