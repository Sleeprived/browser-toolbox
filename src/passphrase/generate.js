// Diceware passphrase generation. Uses cryptographically-secure randomness by
// default (crypto.getRandomValues with rejection sampling for an unbiased pick).
// The RNG is injectable so the generator can be tested deterministically.

export const WORDLIST_SIZE = 7776;

// Default secure integer in [0, max) using rejection sampling to avoid modulo bias.
export function secureRandomInt(max) {
  if (max <= 0) throw new Error('max must be > 0');
  const cryptoObj = globalThis.crypto;
  const range = 2 ** 32;
  const limit = range - (range % max);
  const buf = new Uint32Array(1);
  let x;
  do {
    cryptoObj.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

function capitalizeWord(w) {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

// Generate a passphrase.
//   opts: { words=6, separator='-', capitalize=false, appendDigit=false }
//   wordlist: array of words
//   randomInt: (max) => int in [0,max)   (defaults to secureRandomInt)
export function generatePassphrase(opts, wordlist, randomInt = secureRandomInt) {
  const {
    words = 6,
    separator = '-',
    capitalize = false,
    appendDigit = false,
  } = opts || {};

  if (!Array.isArray(wordlist) || wordlist.length === 0) {
    throw new Error('wordlist must be a non-empty array');
  }
  if (!Number.isInteger(words) || words < 1) {
    throw new Error('words must be a positive integer');
  }

  const picked = [];
  for (let i = 0; i < words; i++) {
    let w = wordlist[randomInt(wordlist.length)];
    if (capitalize) w = capitalizeWord(w);
    picked.push(w);
  }

  let phrase = picked.join(separator);
  if (appendDigit) {
    phrase += String(randomInt(10));
  }
  return phrase;
}

// Entropy of a generated passphrase in bits, given the generation parameters.
export function generatorEntropyBits(opts, wordlistSize = WORDLIST_SIZE) {
  const { words = 6, appendDigit = false } = opts || {};
  let bits = words * Math.log2(wordlistSize);
  if (appendDigit) bits += Math.log2(10);
  return Math.round(bits * 10) / 10;
}
