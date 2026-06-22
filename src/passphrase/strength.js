// Lightweight password strength estimator. Estimates entropy from length and
// the character classes present, then subtracts concrete penalties for obvious
// weaknesses. Pure function — no DOM, no network.
//
// This is a rough guide, deliberately NOT a full cracker (zxcvbn was out of
// scope). It errs toward caution: a common word dressed up with substitutions or
// a trailing digit is capped so it can never read as "strong".

import { COMMON_PASSWORDS } from './common-passwords.js';

// Penalty amounts, in bits. Documented so the meter's behavior is testable.
export const PENALTY_IDENTICAL = 18; // all characters identical (e.g. "aaaa")
export const PENALTY_SEQUENTIAL = 12; // an ascending/descending run of length >= 3
export const PENALTY_COMMON = 30; // exact match against the bundled common-password list
export const PENALTY_COMMON_AFFIX = 26; // a common word + substitutions/affixes (P@ssw0rd, password1!)
export const PENALTY_KEYBOARD = 14; // a keyboard-adjacency walk (qwerty, asdf, 1234)
export const PENALTY_REPEAT = 16; // a short string repeated to fill length (e.g. "abcabcabc")

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

function hasSequentialRun(password, minRun = 3) {
  let run = 1;
  let dir = 0; // 0 = unknown, 1 = ascending, -1 = descending
  for (let i = 1; i < password.length; i++) {
    const diff = password.charCodeAt(i) - password.charCodeAt(i - 1);
    if ((diff === 1 || diff === -1) && (dir === 0 || dir === diff)) {
      dir = diff;
      run += 1;
      if (run >= minRun) return true;
    } else if (diff === 1 || diff === -1) {
      dir = diff;
      run = 2; // start a fresh run in the new direction from the pair
    } else {
      dir = 0;
      run = 1;
    }
  }
  return false;
}

function hasRepeatedUnit(password) {
  // True if the whole string is a unit repeated >= 2 times (unit length >= 2).
  // audit-6 M2: was unit >= 3, which missed 2-char cycles ("abab...").
  const n = password.length;
  for (let unit = 2; unit <= n / 2; unit++) {
    if (n % unit !== 0) continue;
    const slice = password.slice(0, unit);
    if (slice.repeat(n / unit) === password) return true;
  }
  return false;
}

function keyPos(ch) {
  for (let r = 0; r < KEYBOARD_ROWS.length; r++) {
    const idx = KEYBOARD_ROWS[r].indexOf(ch);
    if (idx !== -1) return { r, idx };
  }
  return null;
}

// True if the password walks along a single keyboard row for >= minRun keys
// (e.g. "qwerty", "asdf", "1234"). Catches patterns charcode-sequencing misses.
function hasKeyboardWalk(password, minRun = 4) {
  const lower = password.toLowerCase();
  let run = 1;
  let prev = keyPos(lower[0]);
  for (let i = 1; i < lower.length; i++) {
    const cur = keyPos(lower[i]);
    if (prev && cur && prev.r === cur.r && Math.abs(prev.idx - cur.idx) === 1) {
      run += 1;
      if (run >= minRun) return true;
    } else {
      run = 1;
    }
    prev = cur;
  }
  return false;
}

// Detect a common password possibly disguised by case, substitutions, or
// leading/trailing digits/symbols. Returns 'exact', 'affix', or null.
//
// Known, intentional limitation (this is a rough guide, not a full cracker):
// the affix trim only strips leading/trailing NON-letter padding. Interior
// padding ("pass123word") and letter padding ("xpasswordx") are NOT unwrapped,
// so those disguises read as their own tokens rather than the common word.
function commonMatch(password) {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'exact';
  const trimmed = lower.replace(/^[^a-z]+/, '').replace(/[^a-z]+$/, '');
  if (trimmed.length >= 3 && COMMON_PASSWORDS.has(trimmed)) return 'affix';
  let leet = '';
  for (const ch of lower) leet += LEET[ch] || ch;
  const leetCore = leet.replace(/[^a-z]/g, '');
  if (leetCore.length >= 3 && COMMON_PASSWORDS.has(leetCore)) return 'affix';
  return null;
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

  // audit-6 M1/m3: cap (don't flat-subtract) for all-identical or very low
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
  if (hasSequentialRun(password)) {
    bits -= PENALTY_SEQUENTIAL;
    penalties.push('sequential run');
  }
  if (hasKeyboardWalk(password)) {
    bits -= PENALTY_KEYBOARD;
    penalties.push('keyboard pattern');
  }

  if (!allIdentical(password) && hasRepeatedUnit(password)) {
    bits -= PENALTY_REPEAT;
    penalties.push('repeated word');
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
