import { textToMorse, morseToText } from './morse.js';
import { buildTimeline } from './timing.js';
import * as player from './player.js';

const $ = (id) => document.getElementById(id);

const inEl = $('morse-in');
const dirEl = $('morse-dir');
const outEl = $('morse-out');
const errorEl = $('morse-error');
const skippedEl = $('morse-skipped');
const copyBtn = $('morse-copy');
const copiedEl = $('morse-copied');

const playBtn = $('morse-play');
const stopBtn = $('morse-stop');
const downloadBtn = $('morse-download');
const flashBtn = $('morse-flash');
const vibrateBtn = $('morse-vibrate');
const flasher = $('morse-flasher');

const wpmEl = $('morse-wpm');
const wpmVal = $('morse-wpm-val');
const cwpmEl = $('morse-cwpm');
const cwpmVal = $('morse-cwpm-val');
const toneEl = $('morse-tone');
const toneVal = $('morse-tone-val');

// The Morse string the signal-output controls act on: the output when encoding,
// the (raw) input when decoding.
let currentMorse = '';

function readSettings() {
  const wpm = Number(wpmEl.value);
  const charWpm = Math.max(wpm, Number(cwpmEl.value)); // character speed >= overall
  return { wpm, charWpm, freq: Number(toneEl.value) };
}

function setFlasher(on) {
  if (flasher) flasher.classList.toggle('on', on);
}

function setPlaying(playing) {
  playBtn.disabled = playing;
  stopBtn.disabled = !playing;
}

function update() {
  copiedEl.classList.add('hidden');
  player.stopAll();
  setFlasher(false);
  setPlaying(false);
  errorEl.classList.add('hidden');
  skippedEl.classList.add('hidden');

  const text = inEl.value;
  if (text === '') {
    outEl.textContent = '';
    currentMorse = '';
    return;
  }

  if (dirEl.value === 'decode') {
    outEl.textContent = morseToText(text); // textContent — XSS-safe
    currentMorse = text;
  } else {
    const { code, skipped } = textToMorse(text);
    outEl.textContent = code;
    currentMorse = code;
    if (skipped.length) {
      skippedEl.textContent = `Skipped (no Morse equivalent): ${skipped.join(' ')}`;
      skippedEl.classList.remove('hidden');
    }
  }
}

// Hard ceiling on rendered signal duration. A long paste at low WPM can build a
// multi-minute (and, as a WAV, multi-gigabyte) timeline; cap it so play / flash /
// vibrate / download all degrade with a message instead of flooding the event loop
// with timers, scheduling millions of audio events, or OOMing the tab.
const MAX_OUTPUT_MS = 10 * 60 * 1000;
// Cap the FLASH strobe speed so it can never exceed ~3 Hz (the WCAG 2.3.1 seizure
// threshold), regardless of the chosen WPM. With u = 1200/charWpm ms and a dit ON +
// gap OFF forming a ~2u cycle, charWpm <= 7 keeps each cycle >= ~340 ms (< 3 Hz).
const FLASH_MAX_WPM = 7;

function currentTimeline(over = {}) {
  const { wpm, charWpm } = readSettings();
  return buildTimeline(currentMorse, { wpm: over.wpm ?? wpm, charWpm: over.charWpm ?? charWpm });
}

// Build the timeline for a signal channel, refusing (with a message) if it would be
// too long to render. Returns null when the caller should not proceed.
function outputTimeline(over) {
  if (!currentMorse) return null;
  const tl = currentTimeline(over);
  if (tl.totalMs > MAX_OUTPUT_MS) {
    errorEl.textContent = 'That is too much text to render as a signal at this speed — shorten it or raise the WPM.';
    errorEl.classList.remove('hidden');
    return null;
  }
  return tl;
}

playBtn.addEventListener('click', () => {
  const tl = outputTimeline();
  if (!tl) return;
  const ok = player.playAudio(tl, {
    freq: readSettings().freq,
    onEnd: () => setPlaying(false),
  });
  setPlaying(ok);
});

stopBtn.addEventListener('click', () => {
  player.stopAll();
  setFlasher(false);
  setPlaying(false);
});

downloadBtn.addEventListener('click', () => {
  const tl = outputTimeline();
  if (!tl) return;
  player.downloadWav(tl, { freq: readSettings().freq });
});

flashBtn.addEventListener('click', () => {
  if (player.isReducedMotion()) return;
  const { wpm, charWpm } = readSettings();
  const tl = outputTimeline({ wpm: Math.min(wpm, FLASH_MAX_WPM), charWpm: Math.min(charWpm, FLASH_MAX_WPM) });
  if (!tl) return;
  player.flash(tl, { onToggle: setFlasher });
  // flash() stops any running audio via stopAll(), which suppresses the
  // oscillator's onEnd — reset the Play/Stop buttons here or Play stays disabled.
  setPlaying(false);
});

vibrateBtn.addEventListener('click', () => {
  const tl = outputTimeline();
  if (!tl) return;
  player.vibrate(tl);
  // Same as flash(): vibrate() stopAll()s audio without firing onEnd.
  setPlaying(false);
});

copyBtn.addEventListener('click', async () => {
  if (!outEl.textContent) return;
  let ok = false;
  try { await navigator.clipboard.writeText(outEl.textContent); ok = true; } catch { ok = false; }
  copiedEl.textContent = ok ? 'Copied to clipboard' : 'Press Ctrl+C to copy';
  copiedEl.classList.remove('hidden');
});

// Range readouts.
function bindRange(el, valEl, fmt) {
  const sync = () => { valEl.textContent = fmt ? fmt(el.value) : el.value; };
  el.addEventListener('input', sync);
  sync();
}
bindRange(wpmEl, wpmVal);
bindRange(cwpmEl, cwpmVal);
bindRange(toneEl, toneVal, (v) => `${v} Hz`);

for (const el of [inEl, dirEl]) {
  el.addEventListener('input', update);
  el.addEventListener('change', update);
}

// Capability-gate the output controls (also enforced inside player.js).
setPlaying(false);
if (player.isReducedMotion()) {
  flashBtn.disabled = true;
  flashBtn.title = 'Disabled because your system requests reduced motion.';
}
if (!player.vibrateSupported()) {
  vibrateBtn.disabled = true;
  vibrateBtn.title = 'Vibration is not supported on this device.';
}

// Stop all output if the page is hidden or unloaded.
window.addEventListener('pagehide', () => player.stopAll());
document.addEventListener('visibilitychange', () => { if (document.hidden) player.stopAll(); });

update();
