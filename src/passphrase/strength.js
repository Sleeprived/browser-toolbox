// Lightweight password strength estimator. Estimates entropy from length and
// the character classes present, then subtracts concrete penalties for obvious
// weaknesses. Pure function — no DOM, no network.
//
// This is a rough guide, deliberately NOT a full cracker (zxcvbn was out of
// scope). It errs toward caution: a common word dressed up with substitutions or
// a trailing digit is capped, and a string that is really just two or more
// dictionary words strung together (e.g. "password password") is scored as a
// short word-sequence rather than by length*charset, so neither can read as
// "strong". It still cannot see every disguise — l33t of an uncommon single word
// outside the bundled lists can still be over-rated — so it is a guard, not a
// guarantee; for a master password the bundled generator gives true randomness.

import { COMMON_PASSWORDS } from './common-passwords.js';
import { EFF_WORDLIST } from '../../assets/data/eff_wordlist.js';

// Penalty amounts, in bits. Documented so the meter's behavior is testable.
export const PENALTY_SEQUENTIAL = 12; // an ascending/descending run of length >= 3
export const PENALTY_COMMON = 30; // exact match against the bundled common-password list
export const PENALTY_COMMON_AFFIX = 26; // a common word + substitutions/affixes (P@ssw0rd, password1!)
export const PENALTY_KEYBOARD = 14; // a keyboard-adjacency walk (qwerty, asdf, 1234)
// PENALTY_IDENTICAL and PENALTY_REPEAT were removed — the
// all-identical and repeated-unit cases are now score CAPS (see estimateStrength),
// not flat subtractions, because a flat penalty was outgrown by length.

// Bit caps applied when the password is essentially a known word: real guessing
// cost is tiny regardless of length/charset, so the charset-entropy estimate is
// overridden downward.
const CAP_COMMON = 16;
const CAP_COMMON_AFFIX = 32;

const SYMBOL_SPACE = 33; // printable ASCII punctuation + space

// Leetspeak de-mangling, used only to detect a common word hiding behind
// substitutions. Not used for the entropy estimate itself.
const LEET = { '@': 'a', '4': 'a', '8': 'b', '3': 'e', '1': 'i', '0': 'o', '5': 's', $: 's', '7': 't' };

const KEYBOARD_ROWS = ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'];

// Word set for spotting dictionary-composition passwords: the EFF diceware list
// (the same words the generator draws from) plus the alphabetic common-password
// entries. Built once. A recognized word is treated as at most one diceware pick
// (log2(7776) bits) so the generator's own 5+-word output still clears the gate,
// while glued/repeated common words ("password password") collapse far below it.
const DICT_WORDS = (() => {
  const s = new Set();
  for (const w of EFF_WORDLIST) if (w.length >= 3) s.add(w);
  for (const w of COMMON_PASSWORDS) if (/^[a-z]{3,}$/.test(w)) s.add(w);
  return s;
})();
const DICT_BITS_PER_WORD = Math.log2(7776);
const MAX_DICT_WORD = 15; // longest substring we try to match as a word at a position

function charClassSize(password) {
  let size = 0;
  if (/[a-z]/.test(password)) size += 26;
  if (/[A-Z]/.test(password)) size += 26;
  if (/[0-9]/.test(password)) size += 10;
  if (/[^a-zA-Z0-9]/.test(password)) size += SYMBOL_SPACE;
  return size;
}

function allIdentical(password) {
  return password.length >= 2 && /^(.)\1*$/.test(password);
}

// Length of the LONGEST monotonic ±1 run (ascending or descending): "abcd" -> 4,
// "abXcd" -> 2. Returning the length (not a boolean) lets the caller tell an
// incidental short run apart from a string that IS one big sequential walk.
function longestSequentialRun(password) {
  let run = 1;
  let max = 1;
  let dir = 0; // 0 = unknown, 1 = ascending, -1 = descending
  for (let i = 1; i < password.length; i++) {
    const diff = password.charCodeAt(i) - password.charCodeAt(i - 1);
    if ((diff === 1 || diff === -1) && (dir === 0 || dir === diff)) {
      dir = diff;
      run += 1;
    } else if (diff === 1 || diff === -1) {
      dir = diff;
      run = 2; // start a fresh run in the new direction from the pair
    } else {
      dir = 0;
      run = 1;
    }
    if (run > max) max = run;
  }
  return max;
}

function repeatedUnitLength(password) {
  // Smallest unit length (>= 2) whose repetition equals the whole string, else 0.
  // Scan from unit length 2 so 2-char cycles ("abab...") count.
  const n = password.length;
  for (let unit = 2; unit <= n / 2; unit++) {
    if (n % unit !== 0) continue;
    if (password.slice(0, unit).repeat(n / unit) === password) return unit;
  }
  return 0;
}

function keyPos(ch) {
  for (let r = 0; r < KEYBOARD_ROWS.length; r++) {
    const idx = KEYBOARD_ROWS[r].indexOf(ch);
    if (idx !== -1) return { r, idx };
  }
  return null;
}

// Number of characters that participate in a keyboard-row walk of length >= minRun
// (e.g. "qwerty", "asdf", "1234"). Coverage is summed ACROSS row boundaries, so a
// multi-row walk like "qwertyuiopasdfghjkl" reports its full length even though the
// row change breaks one contiguous run. Catches patterns charcode-sequencing misses.
function keyboardWalkCoverage(password, minRun = 4) {
  const lower = password.toLowerCase();
  let covered = 0;
  let run = 1;
  let prev = keyPos(lower[0]);
  for (let i = 1; i <= lower.length; i++) {
    const cur = i < lower.length ? keyPos(lower[i]) : null;
    const adjacent = prev && cur && prev.r === cur.r && Math.abs(prev.idx - cur.idx) === 1;
    if (adjacent) {
      run += 1;
    } else {
      if (run >= minRun) covered += run;
      run = 1;
    }
    prev = cur;
  }
  return covered;
}

// Longest alphabetic entry in the common-password list. Bounds the embedded-word
// scan below so it stays linear. Computed once.
const MAX_COMMON_WORD = (() => {
  let m = 0;
  for (const w of COMMON_PASSWORDS) if (/^[a-z]+$/.test(w) && w.length > m) m = w.length;
  return m;
})();

// True if a common alphabetic password word (>= 5 chars) appears as a substring of
// `lower` (or its leet-demangled form) AND covers at least half the string — i.e.
// the password is essentially that common word with a little padding. The "half"
// guard keeps a strong password that merely CONTAINS a short common word (e.g.
// "Shark_Vm4!xQ9z") from being flagged. Bounded, linear work.
function hasDominantCommonWord(lower, leet) {
  const half = lower.length / 2;
  for (const s of [lower, leet]) {
    const n = s.length;
    for (let i = 0; i < n; i++) {
      const maxLen = Math.min(MAX_COMMON_WORD, n - i);
      for (let len = maxLen; len >= 5 && len >= half; len--) {
        const cand = s.slice(i, i + len);
        if (/^[a-z]+$/.test(cand) && COMMON_PASSWORDS.has(cand)) return true;
      }
    }
  }
  return false;
}

// Detect a common password possibly disguised by case, substitutions, affixes, or
// padding. Returns 'exact', 'affix', or null. The affix trim only strips leading/
// trailing NON-letter padding; letter and interior padding ("xpasswordx",
// "xq8passwordxq8") is caught by hasDominantCommonWord so a padded common word
// cannot read Strong or clear the vault's 60-bit master-password gate. (The scan is
// bounded to typed-length inputs to keep estimateStrength linear on huge pastes.)
function commonMatch(password) {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'exact';
  const trimmed = lower.replace(/^[^a-z]+/, '').replace(/[^a-z]+$/, '');
  if (trimmed.length >= 3 && COMMON_PASSWORDS.has(trimmed)) return 'affix';
  let leet = '';
  for (const ch of lower) leet += LEET[ch] || ch;
  const leetCore = leet.replace(/[^a-z]/g, '');
  if (leetCore.length >= 3 && COMMON_PASSWORDS.has(leetCore)) return 'affix';
  if (password.length <= 64 && hasDominantCommonWord(lower, leet)) return 'affix';
  return null;
}

// Greedy longest-match segmentation of the lowercased password against DICT_WORDS.
// Returns how much of the alphabetic content is real dictionary words, so the
// caller can cap multi-word compositions (which length*log2(charset) over-rates).
function dictionaryComposition(password) {
  const lower = password.toLowerCase();
  const n = lower.length;
  const isAlpha = (c) => c >= 'a' && c <= 'z';
  const distinct = new Set();
  let totalWords = 0;
  let coveredLetters = 0;
  let totalLetters = 0;
  let i = 0;
  while (i < n) {
    if (!isAlpha(lower[i])) { i++; continue; }
    totalLetters++;
    let matched = 0;
    const maxLen = Math.min(MAX_DICT_WORD, n - i);
    for (let len = maxLen; len >= 3; len--) {
      const cand = lower.slice(i, i + len);
      if (!/^[a-z]+$/.test(cand)) continue; // never match across a non-letter
      if (DICT_WORDS.has(cand)) { matched = len; break; }
    }
    if (matched) {
      distinct.add(lower.slice(i, i + matched));
      totalWords++;
      coveredLetters += matched;
      totalLetters += matched - 1; // the first letter of the word was already counted
      i += matched;
    } else {
      i++; // uncovered single letter; the next iteration counts the following one
    }
  }
  return {
    totalWords,
    distinctWords: distinct.size,
    uncoveredLetters: totalLetters - coveredLetters,
    coverage: totalLetters > 0 ? coveredLetters / totalLetters : 0,
  };
}

export function labelForBits(bits, hasInput = true) {
  if (!hasInput) return '—';
  if (bits < 28) return 'Very weak';
  if (bits < 40) return 'Weak';
  if (bits < 60) return 'Fair';
  if (bits < 80) return 'Strong';
  return 'Very strong';
}

// Returns { bits, label, length, classSize, penalties: [...] }.
export function estimateStrength(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return { bits: 0, label: '—', length: 0, classSize: 0, penalties: [] };
  }

  const classSize = charClassSize(password);
  let bits = password.length * Math.log2(classSize || 1);
  const penalties = [];

  // Cap (don't flat-subtract) for all-identical or very low
  // character diversity. A flat penalty was outgrown by length*log2(classSize), so
  // "aaaaaaaaaaaaaaaaaa" read as Strong; the real guessing cost is tiny regardless
  // of length. This bits value also gates the vault master password
  // (MASTER_MIN_BITS), so the cap closes that weak-master loophole too.
  const lowDiversityCap = Math.log2(classSize || 1) + Math.log2(password.length);
  if (allIdentical(password)) {
    bits = Math.min(bits, lowDiversityCap);
    penalties.push('repeated character');
  } else if (new Set(password).size <= 3 && password.length >= 8) {
    bits = Math.min(bits, lowDiversityCap);
    penalties.push('few unique characters');
  }
  // Sequential run: a flat penalty for an incidental run, but a hard CAP when the
  // run dominates the whole string (e.g. "abcdefghijklmnop"), whose real guessing
  // cost is tiny. Without the cap, length*log2(classSize) outgrew the flat penalty
  // so long walks read "Strong" and passed the vault's master-password gate — the
  // same failure mode already fixed for all-identical and repeated-unit passwords.
  const seqRun = longestSequentialRun(password);
  if (seqRun >= 3) {
    penalties.push('sequential run');
    if (seqRun >= password.length * 0.7) bits = Math.min(bits, lowDiversityCap);
    else bits -= PENALTY_SEQUENTIAL;
  }
  // Keyboard walk: same flat-vs-cap treatment, gated on how much of the string is a
  // row-walk (counted across row boundaries, so a two-row "qwerty…asdf…" walk caps).
  const kbCover = keyboardWalkCoverage(password);
  if (kbCover > 0) {
    penalties.push('keyboard pattern');
    if (kbCover >= password.length * 0.7) bits = Math.min(bits, lowDiversityCap);
    else bits -= PENALTY_KEYBOARD;
  }

  // A whole-string repeated unit (e.g. "Aa1!Aa1!Aa1!") has the
  // guessing cost of ONE unit plus knowing it repeats — cap it there instead of a
  // flat penalty that length*log2(classSize) outgrows (which let a 4+-distinct
  // repeated unit read Strong and pass the vault master gate). Covers the cases the
  // <=3-distinct cap above misses.
  const unitLen = allIdentical(password) ? 0 : repeatedUnitLength(password);
  if (unitLen > 0) {
    const repeats = password.length / unitLen;
    bits = Math.min(bits, unitLen * Math.log2(classSize || 1) + Math.log2(repeats));
    penalties.push('repeated word');
  }

  // A password that is really just two or more dictionary words strung together
  // ("password password", "passwordmonkey", "admin99admin") has the guessing cost
  // of a short word sequence, which the single-token caps above all miss. When
  // dictionary words dominate the alphabetic content, cap at a diceware-style
  // word-count estimate so such a password can never pass the vault's 60-bit
  // master gate, while a genuinely random 5+-word generated passphrase still does.
  const comp = dictionaryComposition(password);
  if (comp.totalWords >= 2 && comp.coverage >= 0.6) {
    const wordBits =
      comp.distinctWords * DICT_BITS_PER_WORD + // each distinct word ~ one diceware pick
      Math.log2(comp.totalWords) +              // ordering / repetition of the words
      comp.uncoveredLetters * Math.log2(26);    // leftover non-dictionary letters
    bits = Math.min(bits, wordBits);
    penalties.push('dictionary words');
  }

  const common = commonMatch(password);
  if (common === 'exact') {
    bits = Math.min(bits - PENALTY_COMMON, CAP_COMMON);
    penalties.push('common password');
  } else if (common === 'affix') {
    bits = Math.min(bits - PENALTY_COMMON_AFFIX, CAP_COMMON_AFFIX);
    penalties.push('common password pattern');
  }

  if (bits < 0) bits = 0;
  bits = Math.round(bits * 10) / 10;

  return { bits, label: labelForBits(bits, true), length: password.length, classSize, penalties };
}
