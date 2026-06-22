import { describe, it, expect } from 'vitest';
import {
  TARGET_FIELDS, detectMapping, mapRowToFields, isRowEmpty, canImport, extractTotpSecret,
} from '../src/vault/import.js';

describe('detectMapping', () => {
  it('maps Bitwarden headers', () => {
    const m = detectMapping(['folder', 'favorite', 'type', 'name', 'notes', 'fields', 'login_uri', 'login_username', 'login_password', 'login_totp']);
    expect(m).toMatchObject({ title: 'name', username: 'login_username', password: 'login_password', url: 'login_uri', notes: 'notes', totp: 'login_totp', tag: 'folder' });
  });
  it('maps Chrome headers', () => {
    const m = detectMapping(['name', 'url', 'username', 'password', 'note']);
    expect(m).toMatchObject({ title: 'name', username: 'username', password: 'password', url: 'url', notes: 'note' });
  });
  it('maps LastPass headers (extra -> notes, name -> title)', () => {
    const m = detectMapping(['url', 'username', 'password', 'totp', 'extra', 'name', 'grouping', 'fav']);
    expect(m).toMatchObject({ title: 'name', username: 'username', password: 'password', url: 'url', notes: 'extra', totp: 'totp', tag: 'grouping' });
  });
  it('maps 1Password headers including the Tags column', () => {
    const m = detectMapping(['Title', 'Url', 'Username', 'Password', 'OTPAuth', 'Notes', 'Tags']);
    expect(m).toMatchObject({ title: 'Title', username: 'Username', password: 'Password', url: 'Url', notes: 'Notes', totp: 'OTPAuth', tag: 'Tags' });
  });
  it('is case-insensitive and preserves the verbatim header', () => {
    const m = detectMapping([' Title ', 'USERNAME', 'Password']);
    expect(m.title).toBe(' Title ');
    expect(m.username).toBe('USERNAME');
    expect(m.password).toBe('Password');
  });
  it('returns null for absent fields', () => {
    expect(detectMapping(['url', 'username', 'password']).title).toBeNull();
    expect(detectMapping([]).password).toBeNull();
  });
  it('detectMapping keys equal TARGET_FIELDS', () => {
    expect(Object.keys(detectMapping(['name'])).sort()).toEqual([...TARGET_FIELDS].sort());
  });
});

describe('mapRowToFields', () => {
  const m = { title: 'name', username: 'user', password: 'pass', url: 'url', notes: 'note', totp: 'totp', tag: 'folder' };
  it('maps a full row and wraps the tag in an array', () => {
    const f = mapRowToFields({ name: 'GitHub', user: 'me', pass: 'pw', url: 'https://github.com', note: 'n', totp: 'ABCD', folder: 'Work' }, m);
    expect(f).toMatchObject({ title: 'GitHub', username: 'me', password: 'pw', url: 'https://github.com', notes: 'n', tags: ['Work'], totp: { secret: 'ABCD' } });
  });
  it('falls back Title to URL hostname then username', () => {
    expect(mapRowToFields({ name: '', user: 'me', pass: 'pw', url: 'https://www.example.com/login' }, m).title).toBe('example.com');
    expect(mapRowToFields({ name: '', user: 'me', pass: 'pw', url: '' }, m).title).toBe('me');
  });
  it('extracts an otpauth secret', () => {
    expect(mapRowToFields({ totp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&issuer=y' }, m).totp).toEqual({ secret: 'JBSWY3DPEHPK3PXP' });
  });
  it('does not store a junk TOTP secret from an otpauth URI with no secret', () => {
    expect(mapRowToFields({ totp: 'otpauth://totp/x?issuer=y' }, m).totp).toBeNull();
    expect(mapRowToFields({ totp: 'otpauth://totp/x?secret=' }, m).totp).toBeNull();
  });
  it('never leaks userinfo into the fallback title and handles non-http schemes', () => {
    expect(mapRowToFields({ name: '', user: 'me', pass: 'p', url: 'https://user:pass@host.com:8443/x' }, m).title).toBe('host.com');
    expect(mapRowToFields({ name: '', user: 'me', pass: 'p', url: 'android://aBcD==@com.example.app/' }, m).title).toBe('com.example.app');
    expect(mapRowToFields({ name: '', user: 'me', pass: 'p', url: 'mailto:foo@bar.com' }, m).title).toBe('me');
  });
  it('leaves totp null when empty, and tags empty when no tag', () => {
    const f = mapRowToFields({ name: 'x' }, m);
    expect(f.totp).toBeNull();
    expect(f.tags).toEqual([]);
  });
  it('tolerates a null mapping for a field', () => {
    expect(mapRowToFields({ name: 'x' }, { title: 'name', username: null, password: null }).username).toBe('');
  });
});

describe('isRowEmpty / canImport / extractTotpSecret', () => {
  it('isRowEmpty true when no entry-bearing field is set; a tag alone is not an entry', () => {
    expect(isRowEmpty({ title: '', username: '', password: '', url: '', notes: '', tags: [], totp: null })).toBe(true);
    expect(isRowEmpty({ title: '', username: 'me', password: '', url: '', notes: '', tags: [], totp: null })).toBe(false);
    // a row carrying only a folder/group tag (e.g. a Bitwarden folder marker) is junk — skip it
    expect(isRowEmpty({ title: '', username: '', password: '', url: '', notes: '', tags: ['t'], totp: null })).toBe(true);
    expect(isRowEmpty({ title: 'note', username: '', password: '', url: '', notes: 'n', tags: ['t'], totp: null })).toBe(false);
  });
  it('canImport requires password or username mapped', () => {
    expect(canImport({ password: 'pass' })).toBe(true);
    expect(canImport({ username: 'user' })).toBe(true);
    expect(canImport({ title: 'name' })).toBe(false);
    expect(canImport(null)).toBe(false);
  });
  it('extractTotpSecret returns raw base32 unchanged and handles empties', () => {
    expect(extractTotpSecret('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
    expect(extractTotpSecret('  ')).toBe('');
    expect(extractTotpSecret('otpauth://totp/a?secret=ABC123&period=30')).toBe('ABC123');
  });
  it('extractTotpSecret returns empty for an otpauth URI without a secret', () => {
    expect(extractTotpSecret('otpauth://totp/a?issuer=y')).toBe('');
    expect(extractTotpSecret('otpauth://totp/a?secret=&x=1')).toBe('');
  });
  it('extractTotpSecret does not throw on a malformed percent-escape', () => {
    expect(extractTotpSecret('otpauth://totp/a?secret=%E0%A4%A')).toBe('%E0%A4%A');
  });
});
