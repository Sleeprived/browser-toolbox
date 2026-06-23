import { describe, it, expect } from 'vitest';
import {
  encryptVault,
  encryptVaultWithKey,
  decryptVault,
  deriveKey,
  VaultCryptoError,
  DEFAULT_ITERATIONS,
} from '../src/vault/crypto.js';

// Keep tests fast: PBKDF2 work factor is irrelevant to correctness, so override it.
const FAST = { iterations: 1000 };

const SAMPLE = {
  version: 1,
  entries: [
    { id: 'a1', title: 'Email', username: 'me@example.com', password: 'hunter2', url: 'https://mail.example.com', notes: 'líne\nbreak — ünïcode', tags: ['mail'], totp: null, customFields: [], passwordHistory: [], createdAt: 1, updatedAt: 2 },
  ],
};

describe('encryptVault / decryptVault', () => {
  it('round-trips a vault object unchanged', async () => {
    const envelope = await encryptVault(SAMPLE, 'correct horse battery staple', FAST);
    const { vault } = await decryptVault(envelope, 'correct horse battery staple');
    expect(vault).toEqual(SAMPLE);
  });

  it('produces an envelope with the documented shape', async () => {
    const env = await encryptVault(SAMPLE, 'pw', FAST);
    expect(env.format).toBe('browser-toolbox-vault');
    expect(env.version).toBe(1);
    expect(env.cipher).toBe('AES-GCM');
    expect(env.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 });
    expect(typeof env.kdf.salt).toBe('string');
    expect(typeof env.iv).toBe('string');
    expect(typeof env.ciphertext).toBe('string');
  });

  it('defaults to the OWASP iteration count when not overridden', async () => {
    expect(DEFAULT_ITERATIONS).toBe(600000);
  });

  it('uses a fresh salt and IV on every encryption', async () => {
    const a = await encryptVault(SAMPLE, 'pw', FAST);
    const b = await encryptVault(SAMPLE, 'pw', FAST);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects the wrong password', async () => {
    const env = await encryptVault(SAMPLE, 'right', FAST);
    await expect(decryptVault(env, 'wrong')).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('rejects a tampered ciphertext (GCM auth failure)', async () => {
    const env = await encryptVault(SAMPLE, 'pw', FAST);
    // Flip a character in the base64 ciphertext.
    const ct = env.ciphertext;
    const flipped = (ct[10] === 'A' ? 'B' : 'A') + ct.slice(1);
    const tampered = { ...env, ciphertext: ct.slice(0, 10) + flipped[0] + ct.slice(11) };
    await expect(decryptVault(tampered, 'pw')).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('rejects a malformed envelope', async () => {
    await expect(decryptVault({ nope: true }, 'pw')).rejects.toBeInstanceOf(VaultCryptoError);
    await expect(decryptVault(null, 'pw')).rejects.toBeInstanceOf(VaultCryptoError);
    await expect(decryptVault({ format: 'browser-toolbox-vault' }, 'pw')).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('rejects an envelope field that is not valid base64', async () => {
    const env = await encryptVault(SAMPLE, 'pw', FAST);
    const bad = { ...env, kdf: { ...env.kdf, salt: 'not valid base64 !!!' } };
    await expect(decryptVault(bad, 'pw')).rejects.toThrow(/base64/i);
  });

  it('rejects a wrong-length IV with a clear message', async () => {
    const env = await encryptVault(SAMPLE, 'pw', FAST);
    const bad = { ...env, iv: btoa('short') }; // valid base64, but only 5 bytes
    await expect(decryptVault(bad, 'pw')).rejects.toThrow(/IV length/i);
  });

  it('rejects an implausibly high iteration count (open-a-hostile-file DoS guard)', async () => {
    const env = await encryptVault(SAMPLE, 'pw', FAST);
    const bad = { ...env, kdf: { ...env.kdf, iterations: 2000000000 } };
    await expect(decryptVault(bad, 'pw')).rejects.toThrow(/implausibly high/i);
  });

  it('deriveKey itself caps the iteration count', async () => {
    const salt = new Uint8Array(16).fill(7);
    await expect(deriveKey('pw', salt, 2000000000)).rejects.toThrow(/maximum/i);
  });

  it('returns a reusable key so repeated saves need not re-derive', async () => {
    const env = await encryptVault(SAMPLE, 'pw', FAST);
    const { key } = await decryptVault(env, 'pw');
    expect(key).toBeInstanceOf(CryptoKey);
  });

  it('deriveKey is deterministic for the same password+salt+iterations', async () => {
    const salt = new Uint8Array(16).fill(7);
    const k1 = await deriveKey('pw', salt, 1000);
    const k2 = await deriveKey('pw', salt, 1000);
    // Use the keys to encrypt the same plaintext+iv and compare — equal keys => equal output.
    const iv = new Uint8Array(12).fill(9);
    const data = new TextEncoder().encode('xyz');
    const c1 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, data));
    const c2 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k2, data));
    expect([...c1]).toEqual([...c2]);
  });

  it('encryptVaultWithKey round-trips and embeds the supplied salt (session re-save path)', async () => {
    const salt = new Uint8Array(16).fill(3);
    const key = await deriveKey('pw', salt, 1000);
    const env = await encryptVaultWithKey(SAMPLE, key, salt, 1000);
    // The salt the key was derived from must be embedded verbatim, or the file won't open.
    expect(env.kdf.salt).toBe(btoa(String.fromCharCode(...salt)));
    expect(env.kdf.iterations).toBe(1000);
    const { vault } = await decryptVault(env, 'pw');
    expect(vault).toEqual(SAMPLE);
  });

  it('encryptVaultWithKey requires a real CryptoKey', async () => {
    await expect(encryptVaultWithKey(SAMPLE, {}, new Uint8Array(16).fill(3), 1000))
      .rejects.toBeInstanceOf(VaultCryptoError);
  });
});
