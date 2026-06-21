import { describe, it, expect } from 'vitest';
import { encryptVault, decryptVault } from '../src/vault/crypto.js';
import { createEntry, makeVaultObject, parseVaultObject } from '../src/vault/model.js';

// End-to-end: the exact path the app takes when you Save then later Open a file.
// Uses the production-default PBKDF2 work factor to prove real parameters work.
describe('vault save/open round-trip (production crypto)', () => {
  it('survives encrypt -> JSON string -> reopen -> decrypt -> parse, unchanged', async () => {
    const entries = [
      createEntry({
        title: 'Bank', username: 'me@example.com', password: 'S3cr3t-Pass!',
        url: 'https://bank.example', notes: 'multi\nline — ünïcode 🔐',
        tags: ['finance', 'important'],
        totp: { secret: 'JBSWY3DPEHPK3PXP' },
        customFields: [{ id: 'cf0', label: 'PIN', value: '1234', hidden: true }],
      }, { id: 'e1', now: 1000 }),
      createEntry({ title: 'Email', username: 'inbox', password: 'p' }, { id: 'e2', now: 2000 }),
    ];

    const masterPassword = 'correct-horse-battery-staple-vault-2026!';

    // Save: model -> encrypt -> JSON text (what gets downloaded).
    const envelope = await encryptVault(makeVaultObject(entries), masterPassword);
    const fileText = JSON.stringify(envelope, null, 2);
    expect(envelope.kdf.iterations).toBe(600000);

    // Open: parse text -> decrypt -> model.
    const reopened = JSON.parse(fileText);
    const { vault } = await decryptVault(reopened, masterPassword);
    const parsed = parseVaultObject(vault);

    expect(parsed).toEqual(entries);
  });

  it('a file saved under one password cannot be opened with another', async () => {
    const entries = [createEntry({ title: 'X', password: 'y' }, { id: 'e1', now: 1 })];
    const envelope = await encryptVault(makeVaultObject(entries), 'first-master-password-strong');
    await expect(decryptVault(envelope, 'second-master-password-strong')).rejects.toThrow();
  });
});
