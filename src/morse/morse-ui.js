import { textToMorse, morseToText } from './morse.js';
import { buildTimeline } from './timing.js';
import * as player from './player.js';

const $ = (id) => document.getElementById(id);

// Two-way translate panes: whichever box the user edits is the source and the
// other follows. Programmatic writes don't fire 'input', so no update loops.
const textEl = $('morse-in');
const codeEl = $('morse-out');
const errorEl = $('morse-error');
const skippedEl = $('morse-skipped');
const copyBtn = $('morse-copy');
const copyTextBtn = $('morse-copy-text'); // may be absent on a stale cached page
const clearBtn = $('morse-clear');
const copiedEl = $('morse-copied');

// On a stale cached page (pre-1.12) the Morse pane is still a read-only <pre>;
// read/write through a shim so this module works on either markup.
const codeIsField = 'value' in codeEl;
const getCode = () => (codeIsField ? codeEl.value : codeEl.textContent);
const setCode = (v) => { if (codeIsField) codeEl.value = v; else codeEl.textContent = v; };

const playBtn = $('morse-play');
const stopBtn = $('morse-stop');
// Twins of Play/Stop up in the translate card (may be absent on a stale
// cached page — every use is guarded).
const playOutBtn = $('morse-play-out');
const stopOutBtn = $('morse-stop-out');
const downloadBtn = $('morse-download');
const flashBtn = $('morse-flash');
const vibrateBtn = $('morse-vibrate');
const flasher = $('morse-flasher');

const progressEl = $('morse-progress');
const wpmEl = $('morse-wpm');
const wpmVal = $('morse-wpm-val');
const cwpmEl = $('morse-cwpm');
const cwpmVal = $('morse-cwpm-val');
const toneEl = $('morse-tone');
const toneVal = $('morse-tone-val');

// The Morse string the signal-output controls act on: whatever the Morse pane
// holds — encoded from the text pane, or typed/tapped into it directly.
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
  for (const b of [playBtn, playOutBtn]) { if (b) b.disabled = playing; }
  for (const b of [stopBtn, stopOutBtn]) { if (b) b.disabled = !playing; }
}

// Playback progress bar: audio is scheduled ahead on the Web Audio clock, so
// progress is tracked against wall time over the timeline's known duration.
let progressTimer = 0;
function stopProgress() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = 0; }
  progressEl.hidden = true;
  progressEl.value = 0;
}
function startProgress(totalMs) {
  stopProgress();
  progressEl.hidden = false;
  const startedAt = Date.now();
  progressTimer = setInterval(() => {
    progressEl.value = Math.min(100, ((Date.now() - startedAt) / totalMs) * 100);
  }, 100);
}

// Any edit invalidates whatever signal is playing and any stale messages.
function resetSignals() {
  copiedEl.classList.add('hidden');
  player.stopAll();
  setFlasher(false);
  setPlaying(false);
  stopProgress();
  errorEl.classList.add('hidden');
  skippedEl.classList.add('hidden');
}

function syncFromText() {
  resetSignals();
  const text = textEl.value;
  if (text === '') {
    setCode('');
    currentMorse = '';
    return;
  }
  const { code, skipped } = textToMorse(text);
  setCode(code);
  currentMorse = code;
  if (skipped.length) {
    skippedEl.textContent = `Skipped (no Morse equivalent): ${skipped.join(' ')}`;
    skippedEl.classList.remove('hidden');
  }
}

function syncFromCode() {
  resetSignals();
  const code = getCode();
  currentMorse = code;
  textEl.value = morseToText(code);
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

function startPlayback() {
  const tl = outputTimeline();
  if (!tl) return;
  const ok = player.playAudio(tl, {
    freq: readSettings().freq,
    onEnd: () => { setPlaying(false); stopProgress(); },
  });
  setPlaying(ok);
  if (ok) startProgress(tl.totalMs);
}
playBtn.addEventListener('click', startPlayback);
playOutBtn?.addEventListener('click', startPlayback);

function stopPlayback() {
  player.stopAll();
  setFlasher(false);
  setPlaying(false);
  stopProgress();
}
stopBtn.addEventListener('click', stopPlayback);
stopOutBtn?.addEventListener('click', stopPlayback);

// The tap card's Play (tap-ui.js) preempts this card's audio via stopAll(),
// which suppresses the superseded oscillator's onEnd — it announces the
// takeover with this event so Play/Stop and the progress bar reset here.
document.addEventListener('morse-playback-reset', () => {
  setPlaying(false);
  stopProgress();
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
  stopProgress();
});

vibrateBtn.addEventListener('click', () => {
  const tl = outputTimeline();
  if (!tl) return;
  player.vibrate(tl);
  // Same as flash(): vibrate() stopAll()s audio without firing onEnd.
  setPlaying(false);
  stopProgress();
});

// Clear both panes; the dispatched 'input' event resets everything downstream
// (signal state and the tap card's transcript). (Optional chaining: the
// button may be absent on a stale cached page.)
clearBtn?.addEventListener('click', () => {
  textEl.value = '';
  setCode('');
  codeEl.dispatchEvent(new Event('input'));
});

async function copyOut(value) {
  if (!value) return;
  let ok = false;
  try { await navigator.clipboard.writeText(value); ok = true; } catch { ok = false; }
  copiedEl.textContent = ok ? 'Copied to clipboard' : 'Press Ctrl+C to copy';
  copiedEl.classList.remove('hidden');
}
copyBtn.addEventListener('click', () => copyOut(getCode()));
copyTextBtn?.addEventListener('click', () => copyOut(textEl.value));

// Range readouts.
function bindRange(el, valEl, fmt) {
  const sync = () => { valEl.textContent = fmt ? fmt(el.value) : el.value; };
  el.addEventListener('input', sync);
  sync();
}
bindRange(wpmEl, wpmVal);
bindRange(cwpmEl, cwpmVal);
bindRange(toneEl, toneVal, (v) => `${v} Hz`);

textEl.addEventListener('input', syncFromText);
codeEl.addEventListener('input', syncFromCode);

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

// Stop all output if the page is hidden or unloaded. stopAll() suppresses the
// oscillator's onEnd, so the progress bar and buttons are reset here explicitly.
function haltOutput() {
  player.stopAll();
  setFlasher(false);
  setPlaying(false);
  stopProgress();
}
window.addEventListener('pagehide', haltOutput);
document.addEventListener('visibilitychange', () => { if (document.hidden) haltOutput(); });

syncFromText();
