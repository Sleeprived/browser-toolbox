// Regex tester core. Pure — no DOM. Uses the browser's native RegExp.
//
// runRegex(pattern, flags, text) →
//   { error }                                  — invalid pattern/flags (SyntaxError text)
//   { matches, segments, truncated, timedOut } — otherwise
//
// Bounding honesty: matching is run in a loop with a wall-clock deadline and a
// match-count cap, so match ENUMERATION can never spin forever. A single
// pathological exec() call (catastrophic backtracking) cannot be interrupted
// from JavaScript — that residual risk is documented in the UI.

export const MAX_TEXT_CHARS = 1 * 1024 * 1024;
export const MAX_MATCHES = 2000;
export const TIME_BUDGET_MS = 2000;

const VALID_FLAGS = /^[gimsuyvd]*$/;

export function runRegex(pattern, flags, text, nowFn = Date.now) {
  if (typeof pattern !== 'string' || pattern === '') return { error: 'Enter a pattern.' };
  if (!VALID_FLAGS.test(flags) || new Set(flags).size !== flags.length) {
    return { error: `Invalid flags: "${flags}".` };
  }
  if (text.length > MAX_TEXT_CHARS) {
    return { error: 'Test text is over the 1 MB limit — trim it down.' };
  }

  let re;
  try {
    // Always add 'g' internally so iteration works; report matches per the
    // user's own flags (without g, only the first match is kept).
    re = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
  } catch (e) {
    return { error: e && e.message ? e.message : 'Invalid pattern.' };
  }

  const global = flags.includes('g');
  const matches = [];
  let truncated = false;
  let timedOut = false;
  const deadline = nowFn() + TIME_BUDGET_MS;

  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({
      index: m.index,
      text: m[0],
      groups: m.slice(1),
      named: m.groups ? { ...m.groups } : null,
    });
    if (!global) break;
    if (m[0] === '') {
      // Zero-length match: force progress — by a whole code point under the
      // unicode flags, so the next attempt cannot land mid-surrogate-pair.
      const cp = text.codePointAt(re.lastIndex);
      re.lastIndex += (flags.includes('u') || flags.includes('v')) && cp > 0xffff ? 2 : 1;
    }
    if (matches.length >= MAX_MATCHES) { truncated = true; break; }
    if (nowFn() > deadline) { timedOut = true; break; }
  }

  // Highlight segments: the full text cut into plain/match runs, in order.
  const segments = [];
  let pos = 0;
  for (const match of matches) {
    if (match.index > pos) segments.push({ text: text.slice(pos, match.index), match: false });
    segments.push({ text: match.text, match: true });
    pos = match.index + match.text.length;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), match: false });

  return { matches, segments, truncated, timedOut };
}
