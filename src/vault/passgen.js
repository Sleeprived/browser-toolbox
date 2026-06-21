// Random-character password generator for vault entries. Built on the passphrase
// tool's cryptographically-secure, bias-free integer picker (no duplication). The
// passphrase generator itself is reused directly by the UI for the other mode.
//
// Guarantees at least one character from each selected class, then fills the rest
// from the union, then shuffles so the guaranteed characters are not predictably
// placed. The RNG is injectable for deterministic tests.

import { secureRandomInt } from '../passphrase/generate.js';

export const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
};

export function generatePassword(opts = {}, randomInt = secureRandomInt) {
  const { length = 20, lower = true, upper = true, digits = true, symbols = true } = opts;

  const pools = [];
  if (lower) pools.push(CHARSETS.lower);
  if (upper) pools.push(CHARSETS.upper);
  if (digits) pools.push(CHARSETS.digits);
  if (symbols) pools.push(CHARSETS.symbols);

  if (pools.length === 0) throw new Error('Select at least one character type.');
  if (!Number.isInteger(length) || length < 1) throw new Error('length must be a positive integer.');
  if (length < pools.length) throw new Error(`length must be at least ${pools.length} to include each selected type.`);

  const union = pools.join('');
  const chars = [];

  // One guaranteed character from each selected pool.
  for (const pool of pools) chars.push(pool[randomInt(pool.length)]);
  // Fill the remainder from the combined set.
  for (let i = pools.length; i < length; i++) chars.push(union[randomInt(union.length)]);

  // Fisher–Yates shuffle with the secure RNG.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join('');
}
