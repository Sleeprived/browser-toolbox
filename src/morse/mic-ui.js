// Microphone listening mode: press Start, grant mic access, and nearby Morse
// beeps are decoded live. An AnalyserNode feeds frequency frames to the pure
// tone detector (mic.js), whose confirmed edges drive the existing keyer
// (keyer.js). Audio frames are analyzed in memory and discarded — nothing is
// recorded, stored, or transmitted; Stop (or hiding the page) releases the
// microphone and closes the audio context.
//
// The live transcript is intentionally SEPARATE from the main input box:
// writing into it would re-run update(), which stops all audio output — and the
// headline use case is decoding this very page's own Play button through the
// speakers.

import { createKeyer } from './keyer.js';
import { morseToText } from './morse.js';
import { MIC_TUNING, toneInFrame, createToneTracker } from './mic.js';

const $ = (id) => document.getElementById(id);

const startBtn = $('mic-start');
const stopBtn = $('mic-stop');
const indicator = $('mic-indicator');
const errorEl = $('mic-error');
const morseEl = $('mic-morse');
const outEl = $('mic-out');

let stream = null;
let audioCtx = null;
let frameTimer = 0;
let session = 0; // bumped by stopListening; invalidates a start still awaiting permission
let tracker = null;
let keyer = null;
let heardMorse = ''; // committed tokens, space-separated ('/' = word break)

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function renderTranscript() {
  const pendingSymbols = keyer ? keyer.pending() : '';
  morseEl.textContent = heardMorse + (pendingSymbols ? `[${pendingSymbols}]` : '');
  outEl.textContent = morseToText(heardMorse);
}

function commit({ committed, wordBreak = false }) {
  if (wordBreak) heardMorse += '/ ';
  if (committed) heardMorse += `${committed} `;
  if (committed || wordBreak) renderTranscript();
}

function setListening(on) {
  startBtn.disabled = on;
  stopBtn.disabled = !on;
  indicator.classList.toggle('hidden', !on);
}

function stopListening() {
  session++;
  if (frameTimer) { clearInterval(frameTimer); frameTimer = 0; }
  if (keyer) {
    commit(keyer.finish());
    renderTranscript();
  }
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  tracker = null;
  keyer = null;
  setListening(false);
}

async function startListening() {
  if (stream || audioCtx || frameTimer) return; // already listening (or starting)
  errorEl.classList.add('hidden');
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    showError('Microphone input is not supported in this browser.');
    return;
  }
  startBtn.disabled = true; // immediately — a second click during the prompt must not start twice
  const mySession = session;
  let granted;
  try {
    // Raw audio: the browser's voice processing would eat a steady sine tone.
    granted = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    startBtn.disabled = false;
    showError('Microphone access was declined or unavailable. Nothing is recorded — audio is only analyzed in memory while listening.');
    return;
  }
  if (mySession !== session || document.hidden) {
    // Stop/pagehide/visibility fired while the permission prompt was open.
    for (const track of granted.getTracks()) track.stop();
    // A newer session may already be listening — don't re-enable Start over it.
    if (!stream) startBtn.disabled = false;
    return;
  }
  stream = granted;
  // Permission revoked mid-session (browser address-bar control): the tracks
  // end without any UI event, so tear down instead of showing a live
  // indicator over a dead mic.
  for (const track of granted.getTracks()) track.addEventListener('ended', stopListening);

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    stopListening();
    showError('Web Audio is not available in this browser.');
    return;
  }
  audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = MIC_TUNING.fftSize;
  analyser.smoothingTimeConstant = 0; // keying edges must not be smeared
  source.connect(analyser); // analysis only — never connected to any output

  const freqData = new Uint8Array(analyser.frequencyBinCount);
  const binHz = audioCtx.sampleRate / analyser.fftSize;
  tracker = createToneTracker();
  keyer = createKeyer({ wpm: 20 }); // player default; adapts to the real rhythm
  heardMorse = '';
  renderTranscript();
  setListening(true);

  frameTimer = setInterval(() => {
    analyser.getByteFrequencyData(freqData);
    const isTone = toneInFrame(freqData, binHz, tracker.state());
    const edge = tracker.sample(isTone, performance.now());
    if (edge) {
      if (edge.type === 'down') commit(keyer.down(edge.at));
      else keyer.up(edge.at);
      renderTranscript();
    } else if (!tracker.state()) {
      // Silence: let the keyer commit a finished letter (idempotent).
      commit(keyer.flush(performance.now()));
    }
    indicator.classList.toggle('tone-on', tracker.state());
  }, MIC_TUNING.frameMs);
}

startBtn.addEventListener('click', startListening);
stopBtn.addEventListener('click', stopListening);

// Never keep the mic open in a hidden or closing tab.
window.addEventListener('pagehide', stopListening);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopListening(); });

setListening(false);
