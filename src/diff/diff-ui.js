// Text diff UI. Rendering is DOM-built with textContent only (pasted text is
// untrusted); the algorithm lives in diff.js.
import { diffLines, diffWords } from './diff.js';

const aEl = document.getElementById('diff-a');
const bEl = document.getElementById('diff-b');
const viewEl = document.getElementById('diff-view');
const runBtn = document.getElementById('diff-run');
const msgEl = document.getElementById('diff-msg');
const outEl = document.getElementById('diff-out');

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function showMessage(msg) {
  msgEl.textContent = msg;
  msgEl.classList.remove('hidden');
  outEl.classList.add('hidden');
  outEl.replaceChildren();
}

// A line as spans, marking word-level changes when spans are provided.
function lineEl(cls, prefix, text, spans) {
  const line = el('div', `diff-line ${cls}`);
  line.appendChild(el('span', 'diff-prefix', prefix));
  if (spans) {
    for (const s of spans) {
      line.appendChild(s.changed ? el('mark', 'diff-word', s.text) : document.createTextNode(s.text));
    }
  } else {
    line.appendChild(document.createTextNode(text));
  }
  return line;
}

// Group consecutive ops of one type so del/add runs can be paired for
// word-level highlighting and side-by-side alignment.
function groupOps(ops) {
  const groups = [];
  for (const op of ops) {
    const last = groups[groups.length - 1];
    if (last && last.type === op.type) last.lines.push(op.text);
    else groups.push({ type: op.type, lines: [op.text] });
  }
  // Merge del-followed-by-add into a "replace" group for pairing.
  const merged = [];
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].type === 'del' && groups[i + 1] && groups[i + 1].type === 'add') {
      merged.push({ type: 'replace', del: groups[i].lines, add: groups[i + 1].lines });
      i++;
    } else {
      merged.push(groups[i]);
    }
  }
  return merged;
}

// The LCS caps bound the algorithm but not the render: two huge
// mostly-identical (or one-sided) panes can pass them yet produce millions of
// line ops. Fold long unchanged runs and hard-cap total rendered lines so the
// DOM stays bounded no matter what the inputs are.
const FOLD_CONTEXT = 20; // unchanged lines kept on each side of a fold
const FOLD_MIN = 200; // unchanged runs longer than this get folded
const MAX_RENDER_LINES = 20000;

function eachSameLine(lines, emit, fold) {
  if (lines.length <= FOLD_MIN) {
    for (const t of lines) emit(t);
    return;
  }
  for (let i = 0; i < FOLD_CONTEXT; i++) emit(lines[i]);
  fold(lines.length - 2 * FOLD_CONTEXT);
  for (let i = lines.length - FOLD_CONTEXT; i < lines.length; i++) emit(lines[i]);
}

// Trim a group to the remaining line budget so an oversized group renders
// partially instead of vanishing (a first group bigger than the cap used to
// leave the output card completely empty under a "showing first N" message).
function trimGroup(g, budget) {
  if (budget <= 0) return null;
  if (g.type === 'replace') {
    const del = g.del.slice(0, budget);
    const add = g.add.slice(0, budget - del.length);
    if (del.length === 0 && add.length === 0) return null;
    return { type: 'replace', del, add };
  }
  const lines = g.lines.slice(0, budget);
  return lines.length ? { type: g.type, lines } : null;
}

function boundGroups(groups) {
  let used = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const lines = g.type === 'replace' ? g.del.length + g.add.length : g.lines.length;
    const cost = g.type === 'same' && g.lines.length > FOLD_MIN ? FOLD_CONTEXT * 2 + 1 : lines;
    if (used + cost > MAX_RENDER_LINES) {
      const kept = groups.slice(0, i);
      const partial = trimGroup(g, MAX_RENDER_LINES - used);
      if (partial) kept.push(partial);
      return { groups: kept, truncated: true };
    }
    used += cost;
  }
  return { groups, truncated: false };
}

function renderInline(groups) {
  const box = el('div', 'diff-box mono');
  for (const g of groups) {
    if (g.type === 'same') {
      eachSameLine(
        g.lines,
        (t) => box.appendChild(lineEl('same', ' ', t)),
        (n) => box.appendChild(el('div', 'diff-line fold', `⋯ ${n} unchanged lines`)),
      );
    } else if (g.type === 'del') {
      for (const t of g.lines) box.appendChild(lineEl('del', '-', t));
    } else if (g.type === 'add') {
      for (const t of g.lines) box.appendChild(lineEl('add', '+', t));
    } else {
      // replace: pair lines by index for word-level highlight
      const count = Math.max(g.del.length, g.add.length);
      const pairs = [];
      for (let i = 0; i < count; i++) {
        pairs.push(g.del[i] != null && g.add[i] != null ? diffWords(g.del[i], g.add[i]) : null);
      }
      g.del.forEach((t, i) => box.appendChild(lineEl('del', '-', t, pairs[i] && pairs[i].a)));
      g.add.forEach((t, i) => box.appendChild(lineEl('add', '+', t, pairs[i] && pairs[i].b)));
    }
  }
  return box;
}

function renderSideBySide(groups) {
  const grid = el('div', 'diff-grid mono');
  const row = (left, right) => {
    grid.appendChild(left || el('div', 'diff-line blank', '')); // keep columns aligned
    grid.appendChild(right || el('div', 'diff-line blank', ''));
  };
  for (const g of groups) {
    if (g.type === 'same') {
      eachSameLine(
        g.lines,
        (t) => row(lineEl('same', ' ', t), lineEl('same', ' ', t)),
        (n) => row(el('div', 'diff-line fold', `⋯ ${n} unchanged lines`), el('div', 'diff-line fold', `⋯ ${n} unchanged lines`)),
      );
    } else if (g.type === 'del') {
      for (const t of g.lines) row(lineEl('del', '-', t), null);
    } else if (g.type === 'add') {
      for (const t of g.lines) row(null, lineEl('add', '+', t));
    } else {
      const count = Math.max(g.del.length, g.add.length);
      for (let i = 0; i < count; i++) {
        const pair = g.del[i] != null && g.add[i] != null ? diffWords(g.del[i], g.add[i]) : null;
        row(
          g.del[i] != null ? lineEl('del', '-', g.del[i], pair && pair.a) : null,
          g.add[i] != null ? lineEl('add', '+', g.add[i], pair && pair.b) : null,
        );
      }
    }
  }
  return grid;
}

function compare() {
  const a = aEl.value;
  const b = bEl.value;
  if (a === '' && b === '') {
    showMessage('Nothing to compare — paste text into both panes.');
    return;
  }
  const res = diffLines(a, b);
  if (res.tooLarge) {
    showMessage('Too large to diff — each pane is limited to 2 MB, and two mostly-different large texts are refused to keep the page responsive.');
    return;
  }
  const bounded = boundGroups(groupOps(res.ops));
  const changes = res.ops.filter((o) => o.type !== 'same').length;
  msgEl.textContent = (changes === 0 ? 'The texts are identical.' : `${changes} changed line(s).`) +
    (bounded.truncated ? ` Showing the first ~${MAX_RENDER_LINES.toLocaleString()} lines only.` : '');
  msgEl.classList.remove('hidden');
  outEl.replaceChildren(viewEl.value === 'side' ? renderSideBySide(bounded.groups) : renderInline(bounded.groups));
  outEl.classList.remove('hidden');
}

runBtn.addEventListener('click', compare);
viewEl.addEventListener('change', () => {
  if (!outEl.classList.contains('hidden') || !msgEl.classList.contains('hidden')) compare();
});
