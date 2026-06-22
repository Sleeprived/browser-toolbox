// Vault encryption core. PBKDF2-HMAC-SHA256 stretches the master password into a
// 256-bit key; AES-256-GCM encrypts the vault JSON with a fresh random IV per
// save. GCM's authentication tag makes a wrong password or a tampered/corrupted
// file fail loudly instead of returning garbage.
//
// The on-disk format is a plaintext JSON envelope whose header carries only
// non-sensitive KDF parameters; every secret lives inside `ciphertext`.
//
// Uses only the browser's native Web Crypto — no dependencies, no CSP change.

export class VaultCryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultCryptoError';
  }
}

// OWASP 2023 guidance for PBKDF2-HMAC-SHA256. Stored in the file header so it can
// be raised in a future version without breaking older files.
export const DEFAULT_ITERATIONS = 600000;

// Ceiling on the attacker-controllable iteration count from an opened vault file
// (audit-6 M5). Without it, a crafted file could set iterations to billions
// and freeze the tab in PBKDF2 before the password is even checked. 10M leaves
// ample headroom to raise the work factor in future versions.
export const MAX_ITERATIONS = 10000000;

export const FORMAT = 'browser-toolbox-vault';
export const FORMAT_VERSION = 1;

const SALT_BYTES = 16;
const IV_BYTES = 12; // 96-bit nonce, the recommended size for AES-GCM.
const KEY_BITS = 256;

function getCrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new VaultCryptoError('Web Crypto is not available in this environment.');
  return c;
}

// --- base64 <-> bytes (binary-safe, no data: prefixes) ---
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  if (typeof b64 !== 'string') throw new VaultCryptoError('Expected a base64 string.');
  let bin;
  try {
    bin = atob(b64);
  } catch {
    throw new VaultCryptoError('A field is not valid base64.');
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return bytes;
}

// Derive an AES-GCM CryptoKey from the master password. Usable for both encrypt
// and decrypt so a single derivation serves repeated saves in one session.
export async function deriveKey(masterPassword, salt, iterations = DEFAULT_ITERATIONS) {
  if (typeof masterPassword !== 'string' || masterPassword.length === 0) {
    throw new VaultCryptoError('Master password must be a non-empty string.');
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new VaultCryptoError('iterations must be a positive integer.');
  }
  if (iterations > MAX_ITERATIONS) {
    throw new VaultCryptoError('iterations exceeds the maximum allowed.');
  }
  const { subtle } = getCrypto();
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(masterPassword),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

function buildEnvelope(saltBytes, ivBytes, ciphertextBytes, iterations) {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(saltBytes) },
    cipher: 'AES-GCM',
    iv: bytesToBase64(ivBytes),
    ciphertext: bytesToBase64(ciphertextBytes),
  };
}

async function encryptWith(key, vaultObject, saltBytes, iterations) {
  const { subtle } = getCrypto();
  const iv = getCrypto().getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(vaultObject));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return buildEnvelope(saltBytes, iv, ct, iterations);
}

// Encrypt a vault object under a fresh salt + IV. Returns the on-disk envelope.
export async function encryptVault(vaultObject, masterPassword, opts = {}) {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const salt = getCrypto().getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(masterPassword, salt, iterations);
  return encryptWith(key, vaultObject, salt, iterations);
}

// Re-encrypt using a key already derived this session (fresh IV, same salt +
// iterations as the original derivation). Avoids paying the PBKDF2 cost again.
export async function encryptVaultWithKey(vaultObject, key, saltBytes, iterations) {
  if (!(key instanceof CryptoKey)) throw new VaultCryptoError('A derived CryptoKey is required.');
  return encryptWith(key, vaultObject, saltBytes, iterations);
}

function validateEnvelope(env) {
  if (!env || typeof env !== 'object') throw new VaultCryptoError('Not a vault file.');
  const { kdf, iv, ciphertext } = env;
  if (!kdf || typeof kdf !== 'object') throw new VaultCryptoError('Vault file is missing its key-derivation header.');
  if (kdf.name !== 'PBKDF2') throw new VaultCryptoError(`Unsupported key-derivation function: ${kdf.name}.`);
  if (typeof kdf.salt !== 'string') throw new VaultCryptoError('Vault file is missing its salt.');
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < 1) throw new VaultCryptoError('Vault file has an invalid iteration count.');
  if (kdf.iterations > MAX_ITERATIONS) throw new VaultCryptoError('Vault file iteration count is implausibly high; refusing to open.');
  if (env.cipher && env.cipher !== 'AES-GCM') throw new VaultCryptoError(`Unsupported cipher: ${env.cipher}.`);
  if (typeof iv !== 'string') throw new VaultCryptoError('Vault file is missing its IV.');
  if (typeof ciphertext !== 'string') throw new VaultCryptoError('Vault file is missing its ciphertext.');
}

// Decrypt an envelope. Returns { vault, key, salt, iterations } so the caller can
// re-save without re-deriving. Throws VaultCryptoError on wrong password, a
// tampered/corrupt file, or a malformed envelope.
export async function decryptVault(envelope, masterPassword) {
  validateEnvelope(envelope);
  const { subtle } = getCrypto();
  const salt = base64ToBytes(envelope.kdf.salt);
  const iv = base64ToBytes(envelope.iv);
  const ct = base64ToBytes(envelope.ciphertext);
  const iterations = envelope.kdf.iterations;

  // Catch truncated/corrupt fields early with a clear message rather than a
  // generic Web Crypto failure. v1 uses a 12-byte GCM IV; the ciphertext always
  // includes at least the 16-byte auth tag.
  if (iv.length !== IV_BYTES) throw new VaultCryptoError('Vault file has an invalid IV length.');
  if (salt.length === 0) throw new VaultCryptoError('Vault file has an empty salt.');
  if (ct.length < 16) throw new VaultCryptoError('Vault file ciphertext is too short to be valid.');

  const key = await deriveKey(masterPassword, salt, iterations);

  let plainBuf;
  try {
    plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    throw new VaultCryptoError('Wrong master password, or the vault file is damaged.');
  }

  let vault;
  try {
    vault = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plainBuf));
  } catch {
    throw new VaultCryptoError('Vault decrypted but its contents are not valid (file may be corrupt).');
  }
  return { vault, key, salt, iterations };
}
