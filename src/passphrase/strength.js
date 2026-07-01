// Password strength via zxcvbn (Dropbox's pattern-matching estimator), loaded as a
// vendored global <script> on the pages that rate a typed password. This replaces the
// former hand-rolled heuristic, which a deep audit found let weak passwords (e.g.
// "AAAAaaaa1111!!!!", "horsehorse99", a repeated alphabet walk) clear the vault's
// master-password gate. The EXACT generator entropy (words × log2(7776)) lives in
// generate.js and is unchanged — that is a precise figure, not a guess.

// Vault master-password gate: require zxcvbn score 4 — "strong protection from an
// offline slow-hash attack", which is exactly the vault's threat model (a stolen
// PBKDF2-600k → AES-GCM file). Score 3 only claims "moderate" offline protection.
export const MASTER_MIN_SCORE = 4;

// Score 4 alone has a low FLOOR (zxcvbn defines it as guesses ≥ 1e10 ≈ 33 bits), so a
// long-but-low-entropy password like "correcthorsebattery" reaches it yet is crackable
// in days against a stolen file. Add a guesses floor: zxcvbn log10(guesses) ≥ 11
// (≈ 36.5 of the "bits" the meter shows). This rejects the marginal human passwords while
// every generator output ≥4 words / ≥16 random chars clears it.
export const MASTER_MIN_LOG10 = 11;

// The full vault master-password policy in one place, so every gate site agrees. Gate on
// the RAW guesses figure (guessesLog10), never the display-rounded `bits` — a security
// threshold must not move with how the meter formats its number.
export function meetsMasterGate(result) {
  return result.score >= MASTER_MIN_SCORE && result.guessesLog10 >= MASTER_MIN_LOG10;
}

// zxcvbn is superlinear on long inputs and its own guidance is to cap the analysed
// length; anything past this is already score 4 on length alone. Capping here also
// bounds the per-keystroke cost so a large paste cannot freeze the field.
const MAX_ANALYZE = 100;

const SCORE_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
const LOG2_10 = Math.log2(10); // present log10(guesses) as a familiar "bits" figure

// Returns { score (0-4), guessesLog10 (raw, for the gate), bits (rounded, for display),
// label, length, warning, suggestions }.
export function estimateStrength(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return { score: 0, guessesLog10: 0, bits: 0, label: '—', length: 0, warning: '', suggestions: [] };
  }
  const zxcvbn = globalThis.zxcvbn;
  if (typeof zxcvbn !== 'function') {
    // The vendored engine failed to load: fail CLOSED so the gate never accepts an
    // unrated password. In the browser the <script> is same-origin and SW-precached.
    return { score: 0, guessesLog10: 0, bits: 0, label: 'Very weak', length: password.length, warning: 'Strength checker unavailable.', suggestions: [] };
  }
  const sample = password.length > MAX_ANALYZE ? password.slice(0, MAX_ANALYZE) : password;
  const r = zxcvbn(sample);
  const fb = r.feedback || {};
  const guessesLog10 = r.guesses_log10 || 0;
  return {
    score: r.score,
    guessesLog10, // raw — the master gate compares this
    bits: Math.round(guessesLog10 * LOG2_10 * 10) / 10, // rounded — display only
    label: SCORE_LABELS[r.score] || '—',
    length: password.length,
    warning: fb.warning || '',
    suggestions: Array.isArray(fb.suggestions) ? fb.suggestions : [],
  };
}

// Map a zxcvbn score (0-4) to a 0-100 meter width for the strength bar.
export function scoreToPercent(score) {
  return [10, 30, 55, 78, 100][score] || 0;
}
