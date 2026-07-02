// Hand-rolled LCS line diff. Pure — no DOM, no dependencies.
//
// diffLines(aText, bText) → { ops: [{type:'same'|'del'|'add', text}] }
//                         | { tooLarge: true }
// diffWords(aLine, bLine) → word-level changed spans for one replaced line pair.
//
// Anti-freeze bounds: inputs above MAX_DIFF_CHARS per pane, or middles whose
// LCS table would exceed MAX_LCS_CELLS after common prefix/suffix trimming,
// return { tooLarge: true } instead of locking the tab.

export const MAX_DIFF_CHARS = 2 * 1024 * 1024; // per pane
export const MAX_LCS_CELLS = 4 * 1000 * 1000;  // DP table bound (~16 MB Int32)
const MAX_WORD_TOKENS = 200;                    // per line, for word-level LCS

export function diffLines(aText, bText) {
  if (aText.length > MAX_DIFF_CHARS || bText.length > MAX_DIFF_CHARS) {
    return { tooLarge: true };
  }
  const a = String(aText).split('\n');
  const b = String(bText).split('\n');

  // Trim the common prefix and suffix — typical edits touch a small middle, so
  // the quadratic LCS only ever sees the changed region.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const n = endA - start;
  const m = endB - start;
  // Cap what is actually allocated — the table is (n+1)×(m+1), so a skewed
  // middle (huge n, tiny m) must not slip past an n×m-only check.
  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) return { tooLarge: true };

  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ type: 'same', text: a[i] });

  if (n === 0) {
    for (let j = start; j < endB; j++) ops.push({ type: 'add', text: b[j] });
  } else if (m === 0) {
    for (let i = start; i < endA; i++) ops.push({ type: 'del', text: a[i] });
  } else {
    // Intern middle lines as integers so each DP cell comparison is O(1) —
    // full string compares would make crafted panes (long lines sharing long
    // prefixes) stall for seconds despite the cell cap.
    const idOf = new Map();
    const intern = (s) => {
      let id = idOf.get(s);
      if (id === undefined) {
        id = idOf.size;
        idOf.set(s, id);
      }
      return id;
    };
    const aIds = new Int32Array(n);
    for (let i = 0; i < n; i++) aIds[i] = intern(a[start + i]);
    const bIds = new Int32Array(m);
    for (let j = 0; j < m; j++) bIds[j] = intern(b[start + j]);

    // Classic LCS-length table over the trimmed middle, then backtrack.
    const width = m + 1;
    const table = new Int32Array((n + 1) * width);
    for (let i = 1; i <= n; i++) {
      const ai = aIds[i - 1];
      for (let j = 1; j <= m; j++) {
        table[i * width + j] = ai === bIds[j - 1]
          ? table[(i - 1) * width + (j - 1)] + 1
          : Math.max(table[(i - 1) * width + j], table[i * width + (j - 1)]);
      }
    }
    const middle = [];
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
      if (aIds[i - 1] === bIds[j - 1]) {
        middle.push({ type: 'same', text: a[start + i - 1] });
        i--; j--;
      } else if (table[i * width + (j - 1)] >= table[(i - 1) * width + j]) {
        // Ties take the add branch: pushes run back-to-front, so the add lands
        // AFTER the del once reversed — dels always precede adds in a replace.
        middle.push({ type: 'add', text: b[start + j - 1] });
        j--;
      } else {
        middle.push({ type: 'del', text: a[start + i - 1] });
        i--;
      }
    }
    while (i > 0) { i--; middle.push({ type: 'del', text: a[start + i] }); }
    while (j > 0) { j--; middle.push({ type: 'add', text: b[start + j] }); }
    middle.reverse();
    // Not push(...middle): a large middle as spread arguments overflows the
    // engine's argument limit and throws RangeError.
    for (const op of middle) ops.push(op);
  }

  for (let i = endA; i < a.length; i++) ops.push({ type: 'same', text: a[i] });
  return { ops };
}

// Split a line into word / non-word runs so the word diff can re-join spans
// losslessly (tokens always concatenate back to the original line).
function tokenize(line) {
  return line.match(/\w+|\s+|[^\w\s]+/g) || [];
}

// Word-level diff of one del/add line pair. Returns spans for each side:
// { a: [{text, changed}], b: [{text, changed}] }. Falls back to whole-line
// changed when the lines are too token-heavy for a quadratic pass.
export function diffWords(aLine, bLine) {
  const at = tokenize(aLine);
  const bt = tokenize(bLine);
  if (at.length > MAX_WORD_TOKENS || bt.length > MAX_WORD_TOKENS) {
    return {
      a: aLine ? [{ text: aLine, changed: true }] : [],
      b: bLine ? [{ text: bLine, changed: true }] : [],
    };
  }
  const n = at.length;
  const m = bt.length;
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      table[i * width + j] = at[i - 1] === bt[j - 1]
        ? table[(i - 1) * width + (j - 1)] + 1
        : Math.max(table[(i - 1) * width + j], table[i * width + (j - 1)]);
    }
  }
  const aSpans = [];
  const bSpans = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && at[i - 1] === bt[j - 1]) {
      aSpans.push({ text: at[--i], changed: false });
      bSpans.push({ text: bt[--j], changed: false });
    } else if (j > 0 && (i === 0 || table[i * width + (j - 1)] >= table[(i - 1) * width + j])) {
      bSpans.push({ text: bt[--j], changed: true });
    } else {
      aSpans.push({ text: at[--i], changed: true });
    }
  }
  const merge = (spans) => {
    spans.reverse();
    const out = [];
    for (const s of spans) {
      const last = out[out.length - 1];
      if (last && last.changed === s.changed) last.text += s.text;
      else out.push({ ...s });
    }
    return out;
  };
  return { a: merge(aSpans), b: merge(bSpans) };
}
