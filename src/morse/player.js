// Browser-only signal drivers for Morse: audio (Web Audio), on-screen flash,
// and vibration. Each consumes a timeline from timing.js. Everything is lazy
// and feature-detected so this module imports cleanly under jsdom (the smoke
// tests) and never auto-plays — an AudioContext is created only on demand.

import { timelineToWav } from './wav.js';

let audioCtx = null;
let activeOsc = null;
let flashTimers = [];
let onFlashOff = null;

export function isReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function vibrateSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

// Stop every output channel and clear all scheduled work. Safe to call anytime.
export function stopAll() {
  if (activeOsc) {
    try { activeOsc.osc.stop(); } catch { /* already stopped */ }
    try { activeOsc.osc.disconnect(); } catch { /* noop */ }
    try { activeOsc.gain.disconnect(); } catch { /* noop */ }
    activeOsc = null;
  }
  for (const t of flashTimers) clearTimeout(t);
  flashTimers = [];
  if (onFlashOff) { try { onFlashOff(); } catch { /* noop */ } onFlashOff = null; }
  if (vibrateSupported()) { try { navigator.vibrate(0); } catch { /* noop */ } }
}

const RAMP = 0.005; // seconds — matches the WAV encoder's anti-click ramp

/**
 * Play the timeline as CW sidetone. Returns false if Web Audio is unavailable.
 * Starting playback stops any other active output first.
 */
export function playAudio(timeline, { freq = 600, amplitude = 0.7, onEnd } = {}) {
  stopAll();
  const Ctx = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx) return false;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  let t = audioCtx.currentTime + 0.06;
  const segments = timeline.segments ?? timeline;
  for (const seg of segments) {
    const dur = seg.ms / 1000;
    if (seg.on) {
      const ramp = Math.min(RAMP, dur / 2);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(amplitude, t + ramp);
      gain.gain.setValueAtTime(amplitude, Math.max(t + dur - ramp, t + ramp));
      gain.gain.linearRampToValueAtTime(0, t + dur);
    } else {
      gain.gain.setValueAtTime(0, t);
    }
    t += dur;
  }

  osc.start();
  osc.stop(t + 0.02);
  activeOsc = { osc, gain };
  osc.onended = () => {
    // Only act for the current oscillator: a superseded one (replaced by a new
    // Play) must not fire a stale onEnd that desyncs the play/stop button state.
    if (activeOsc && activeOsc.osc === osc) {
      activeOsc = null;
      if (onEnd) onEnd();
    }
  };
  return true;
}

/**
 * Blink the timeline by calling onToggle(boolean) at the right times. Caller is
 * responsible for honoring reduced-motion (the UI disables the control).
 */
export function flash(timeline, { onToggle, onEnd } = {}) {
  stopAll();
  const segments = timeline.segments ?? timeline;
  let acc = 0;
  for (const seg of segments) {
    const on = !!seg.on;
    flashTimers.push(setTimeout(() => onToggle(on), acc));
    acc += seg.ms;
  }
  flashTimers.push(setTimeout(() => {
    onToggle(false);
    flashTimers = [];
    onFlashOff = null;
    if (onEnd) onEnd();
  }, acc));
  onFlashOff = () => onToggle(false);
}

// Buzz the timeline. Pattern is [onMs, offMs, onMs, ...] — the timeline always
// starts and ends ON and strictly alternates, which is exactly what vibrate wants.
export function vibrate(timeline) {
  if (!vibrateSupported()) return false;
  stopAll(); // match playAudio()/flash(): only one output channel runs at a time
  let segments = timeline.segments ?? timeline;
  // vibrate() reads the array as [buzz, pause, buzz, ...] starting with a buzz, so
  // a leading OFF would invert the rhythm. buildTimeline already starts ON; drop a
  // leading OFF defensively so this stays correct regardless of the timeline.
  if (segments[0] && !segments[0].on) segments = segments.slice(1);
  const pattern = segments.map((s) => Math.max(0, Math.round(s.ms)));
  try { return navigator.vibrate(pattern); } catch { return false; }
}

// Build the WAV bytes and trigger a download. Local blob; URL revoked after.
export function downloadWav(timeline, { freq = 600, filename = 'morse.wav' } = {}) {
  const bytes = timelineToWav(timeline, { freq });
  const blob = new Blob([bytes], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
