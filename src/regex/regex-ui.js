// Regex tester UI. All output is DOM-built with textContent (the test text and
// matches are untrusted); the matching core lives in regex.js.
import { runRegex } from './regex.js';

const patternEl = document.getElementById('re-pattern');
const flagsEl = document.getElementById('re-flags');
const textEl = document.getElementById('re-text');
const errorEl = document.getElementById('re-error');
const summaryEl = document.getElementById('re-summary');
const resultEl = document.getElementById('re-result');
const highlightEl = document.getElementById('re-highlight');
const matchesEl = document.getElementById('re-matches');

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function hideAll() {
  errorEl.classList.add('hidden');
  summaryEl.classList.add('hidden');
  resultEl.classList.add('hidden');
}

function update() {
  hideAll();
  const pattern = patternEl.value;
  const text = textEl.value;
  if (pattern === '' && text === '') return; // untouched page — stay quiet

  const res = runRegex(pattern, flagsEl.value.trim(), text);
  if (res.error) {
    errorEl.textContent = res.error;
    errorEl.classList.remove('hidden');
    return;
  }

  let note = res.matches.length === 1 ? '1 match.' : `${res.matches.length} matches.`;
  if (res.truncated) note += ' Stopped at the listing cap — there are more.';
  if (res.timedOut) note += ' Stopped at the time limit — there may be more.';
  summaryEl.textContent = note;
  summaryEl.classList.remove('hidden');
  if (res.matches.length === 0) return;

  highlightEl.replaceChildren();
  for (const seg of res.segments) {
    highlightEl.appendChild(seg.match ? el('mark', 're-match', seg.text) : document.createTextNode(seg.text));
  }

  matchesEl.replaceChildren();
  const list = el('ol', 're-match-list');
  for (const m of res.matches) {
    const item = el('li');
    item.appendChild(el('code', null, m.text === '' ? '(empty match)' : m.text));
    item.appendChild(el('span', 'lead', ` at index ${m.index}`));
    if (m.groups.length) {
      const dl = el('dl', 'read-fields');
      m.groups.forEach((g, i) => {
        dl.appendChild(el('dt', null, `Group ${i + 1}`));
        dl.appendChild(el('dd', null, g === undefined ? '(no match)' : g));
      });
      if (m.named) {
        for (const [name, val] of Object.entries(m.named)) {
          dl.appendChild(el('dt', null, `<${name}>`));
          dl.appendChild(el('dd', null, val === undefined ? '(no match)' : val));
        }
      }
      item.appendChild(dl);
    }
    list.appendChild(item);
  }
  matchesEl.appendChild(list);
  resultEl.classList.remove('hidden');
}

// Debounced: a half-typed pattern must not run against the full test text on
// every keystroke — one catastrophic exec() can stall the tab (see the ReDoS
// caveat on the page), so evaluation waits for a pause in typing.
let pending = 0;
function scheduleUpdate() {
  clearTimeout(pending);
  pending = setTimeout(update, 200);
}

for (const input of [patternEl, flagsEl, textEl]) {
  input.addEventListener('input', scheduleUpdate);
}
