import { describe, it, expect } from 'vitest';
import {
  createEntry,
  updateEntry,
  deleteEntry,
  upsertEntry,
  searchEntries,
  filterByTag,
  allTags,
  makeVaultObject,
  parseVaultObject,
  VaultModelError,
} from '../src/vault/model.js';

const deps = (id, now) => ({ id, now });

describe('createEntry', () => {
  it('fills defaults and uses injected id + clock', () => {
    const e = createEntry({ title: 'GitHub', username: 'me', password: 'pw' }, deps('id1', 100));
    expect(e).toMatchObject({
      id: 'id1', title: 'GitHub', username: 'me', password: 'pw',
      url: '', notes: '', tags: [], totp: null, customFields: [], passwordHistory: [],
      createdAt: 100, updatedAt: 100,
    });
  });

  it('normalizes tags and drops an empty TOTP secret to null', () => {
    const e = createEntry({ title: 't', tags: ['a', '', 'b'], totp: { secret: '  ' } }, deps('id2', 1));
    expect(e.tags).toEqual(['a', 'b']);
    expect(e.totp).toBeNull();
  });

  it('keeps a valid TOTP and defaults its parameters', () => {
    const e = createEntry({ title: 't', totp: { secret: 'JBSWY3DPEHPK3PXP' } }, deps('id3', 1));
    expect(e.totp).toEqual({ secret: 'JBSWY3DPEHPK3PXP', digits: 6, period: 30, algorithm: 'SHA-1' });
  });

  it('coerces invalid TOTP digits/period/algorithm to defaults', () => {
    const e = createEntry({ title: 't', totp: { secret: 'ABC', digits: 'nope', period: null, algorithm: 'BOGUS' } }, deps('id4', 1));
    expect(e.totp).toEqual({ secret: 'ABC', digits: 6, period: 30, algorithm: 'SHA-1' });
  });

  it('preserves valid non-default TOTP parameters', () => {
    const e = createEntry({ title: 't', totp: { secret: 'ABC', digits: 8, period: 60, algorithm: 'SHA-256' } }, deps('id5', 1));
    expect(e.totp).toEqual({ secret: 'ABC', digits: 8, period: 60, algorithm: 'SHA-256' });
  });

  it('auto-generates ids for custom fields missing one, preserving order', () => {
    const e = createEntry({ title: 't', customFields: [{ label: 'a', value: '1' }, { id: '', label: 'b', value: '2' }] }, deps('id6', 1));
    expect(e.customFields.map((c) => c.id)).toEqual(['cf0', 'cf1']);
    expect(e.customFields.map((c) => c.label)).toEqual(['a', 'b']);
  });
});

describe('updateEntry', () => {
  it('updates fields, bumps updatedAt, preserves id and createdAt', () => {
    const e = createEntry({ title: 'A', password: 'p1' }, deps('id1', 100));
    const u = updateEntry(e, { title: 'B' }, deps(null, 200));
    expect(u.title).toBe('B');
    expect(u.id).toBe('id1');
    expect(u.createdAt).toBe(100);
    expect(u.updatedAt).toBe(200);
  });

  it('pushes the old password into history on change', () => {
    const e = createEntry({ title: 'A', password: 'old' }, deps('id1', 100));
    const u = updateEntry(e, { password: 'new' }, deps(null, 200));
    expect(u.password).toBe('new');
    expect(u.passwordHistory).toEqual([{ password: 'old', changedAt: 200 }]);
  });

  it('does not push history when the password is unchanged', () => {
    const e = createEntry({ title: 'A', password: 'same' }, deps('id1', 100));
    const u = updateEntry(e, { title: 'B', password: 'same' }, deps(null, 200));
    expect(u.passwordHistory).toEqual([]);
  });

  it('does not push history when the previous password was empty', () => {
    const e = createEntry({ title: 'A', password: '' }, deps('id1', 100));
    const u = updateEntry(e, { password: 'first' }, deps(null, 200));
    expect(u.passwordHistory).toEqual([]);
  });

  it('does not push history when password is explicitly undefined', () => {
    const e = createEntry({ title: 'A', password: 'old' }, deps('id1', 100));
    const u = updateEntry(e, { password: undefined, title: 'B' }, deps(null, 200));
    expect(u.passwordHistory).toEqual([]);
    expect(u.password).toBe(''); // normalized
  });

  it('keeps newest history first across multiple changes', () => {
    let e = createEntry({ title: 'A', password: 'p1' }, deps('id1', 100));
    e = updateEntry(e, { password: 'p2' }, deps(null, 200));
    e = updateEntry(e, { password: 'p3' }, deps(null, 300));
    expect(e.passwordHistory).toEqual([
      { password: 'p2', changedAt: 300 },
      { password: 'p1', changedAt: 200 },
    ]);
  });
});

describe('list operations', () => {
  const list = [
    createEntry({ title: 'Gmail', username: 'a@x.com', tags: ['mail', 'work'] }, deps('1', 1)),
    createEntry({ title: 'Bank', username: 'acct', tags: ['finance'] }, deps('2', 1)),
    createEntry({ title: 'GitHub', username: 'dev', tags: ['work'] }, deps('3', 1)),
  ];

  it('deleteEntry removes by id and does not mutate the input', () => {
    const out = deleteEntry(list, '2');
    expect(out.map((e) => e.id)).toEqual(['1', '3']);
    expect(list).toHaveLength(3);
  });

  it('upsertEntry replaces by id or appends', () => {
    const replaced = upsertEntry(list, { ...list[0], title: 'Gmail (work)' });
    expect(replaced).toHaveLength(3);
    expect(replaced.find((e) => e.id === '1').title).toBe('Gmail (work)');
    const added = upsertEntry(list, createEntry({ title: 'New' }, deps('9', 1)));
    expect(added).toHaveLength(4);
  });

  it('searchEntries matches title or username, case-insensitively', () => {
    expect(searchEntries(list, 'git').map((e) => e.id)).toEqual(['3']);
    expect(searchEntries(list, 'ACCT').map((e) => e.id)).toEqual(['2']);
    expect(searchEntries(list, '')).toHaveLength(3);
  });

  it('filterByTag returns entries carrying the tag', () => {
    expect(filterByTag(list, 'work').map((e) => e.id)).toEqual(['1', '3']);
  });

  it('allTags returns sorted unique tags', () => {
    expect(allTags(list)).toEqual(['finance', 'mail', 'work']);
  });
});

describe('serialize / parse', () => {
  it('makeVaultObject wraps entries with a version', () => {
    const v = makeVaultObject([createEntry({ title: 'A' }, deps('1', 1))]);
    expect(v.version).toBe(1);
    expect(v.entries).toHaveLength(1);
  });

  it('round-trips through make/parse', () => {
    const entries = [createEntry({ title: 'A', password: 'p', tags: ['x'] }, deps('1', 5))];
    const parsed = parseVaultObject(makeVaultObject(entries));
    expect(parsed).toEqual(entries);
  });

  it('parseVaultObject normalizes legacy/partial entries', () => {
    const parsed = parseVaultObject({ entries: [{ id: '1', title: 'A', tags: ['x', 7], extra: 'ignored' }] });
    expect(parsed[0]).toMatchObject({ id: '1', title: 'A', tags: ['x', '7'], totp: null, customFields: [], passwordHistory: [] });
    expect(parsed[0]).not.toHaveProperty('extra');
  });

  it('throws on a non-object or missing entries array', () => {
    expect(() => parseVaultObject(null)).toThrow(VaultModelError);
    expect(() => parseVaultObject({})).toThrow(VaultModelError);
    expect(() => parseVaultObject({ entries: {} })).toThrow(VaultModelError);
  });

  it('throws when an entry has no id', () => {
    expect(() => parseVaultObject({ entries: [{ title: 'no id' }] })).toThrow(VaultModelError);
  });

  it('loads files with a newer or missing version (forward-compatible)', () => {
    expect(parseVaultObject({ version: 99, entries: [{ id: '1', title: 'A' }] })).toHaveLength(1);
    expect(parseVaultObject({ entries: [{ id: '1', title: 'A' }] })).toHaveLength(1);
  });
});
