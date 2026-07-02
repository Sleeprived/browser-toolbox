// Contrast checker UI. Keeps each color-picker/hex-input pair in sync and
// shows the last valid ratio while a hex field is mid-edit; math lives in
// contrast.js.
import { parseHex, toHex, evaluate } from './contrast.js';

const fgPick = document.getElementById('ct-fg-pick');
const fgHex = document.getElementById('ct-fg-hex');
const bgPick = document.getElementById('ct-bg-pick');
const bgHex = document.getElementById('ct-bg-hex');
const errorEl = document.getElementById('ct-error');
const previewEl = document.getElementById('ct-preview');
const ratioEl = document.getElementById('ct-ratio');

// Last valid colors — kept when a hex field holds an invalid value. The hex
// fields can hold garbage at load time (browser form-state restore), so fall
// back to the pickers' values, which color inputs always keep valid.
let fg = parseHex(fgHex.value) || parseHex(fgPick.value);
let bg = parseHex(bgHex.value) || parseHex(bgPick.value);

function badge(id, pass) {
  const el = document.getElementById(id);
  el.textContent = pass ? 'Pass' : 'Fail';
  el.className = pass ? 'badge-pass' : 'badge-fail';
}

function render() {
  const { ratio, passes } = evaluate(fg, bg);
  ratioEl.textContent = `${ratio.toFixed(2)}:1`;
  badge('ct-aa-normal', passes.aaNormal);
  badge('ct-aa-large', passes.aaLarge);
  badge('ct-aaa-normal', passes.aaaNormal);
  badge('ct-aaa-large', passes.aaaLarge);
  previewEl.style.color = toHex(fg);
  previewEl.style.backgroundColor = toHex(bg);
}

// Invalid state is tracked per field: fixing one field must not clear the
// error while the OTHER field still holds garbage (its stale color remains in
// use for the displayed ratio).
const invalid = { fg: false, bg: false };

function syncError() {
  if (invalid.fg || invalid.bg) {
    errorEl.textContent = 'Not a valid hex color — use #rgb or #rrggbb. Showing the last valid pair.';
    errorEl.classList.remove('hidden');
  } else {
    errorEl.classList.add('hidden');
  }
}

function onHexInput(hexEl, pickEl, key, assign) {
  const rgb = parseHex(hexEl.value);
  invalid[key] = !rgb;
  syncError();
  if (!rgb) return;
  assign(rgb);
  pickEl.value = toHex(rgb);
  render();
}

function onPick(pickEl, hexEl, key, assign) {
  const rgb = parseHex(pickEl.value); // color inputs always emit #rrggbb
  invalid[key] = false; // the picker also rewrites the hex field to a valid value
  syncError();
  assign(rgb);
  hexEl.value = pickEl.value;
  render();
}

fgHex.addEventListener('input', () => onHexInput(fgHex, fgPick, 'fg', (v) => { fg = v; }));
bgHex.addEventListener('input', () => onHexInput(bgHex, bgPick, 'bg', (v) => { bg = v; }));
fgPick.addEventListener('input', () => onPick(fgPick, fgHex, 'fg', (v) => { fg = v; }));
bgPick.addEventListener('input', () => onPick(bgPick, bgHex, 'bg', (v) => { bg = v; }));

render();
