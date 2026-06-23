import { describe, it, expect } from 'vitest';
import { parseOtpauth } from '../src/totp/otpauth.js';
import { base32Decode, totp } from '../src/vault/totp.js';

describe('parseOtpauth', () => {
  it('returns null for empty input', () => {
    expect(parseOtpauth('')).toBe(null);
    expect(parseOtpauth('   ')).toBe(null);
    expect(parseOtpauth(null)).toBe(null);
  });

  it('treats a bare value as a base32 secret with RFC defaults', () => {
    const r = parseOtpauth('  JBSW Y3DP EHPK 3PXP  ');
    expect(r).toEqual({ type: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, period: 30, algorithm: 'SHA-1', label: '', issuer: '' });
  });

  it('parses a full otpauth:// URI including params and issuer/label', () => {
    const r = parseOtpauth('otpauth://totp/ACME%20Co:alice@acme.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&digits=8&period=60&algorithm=SHA256');
    expect(r.type).toBe('totp');
    expect(r.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(r.digits).toBe(8);
    expect(r.period).toBe(60);
    expect(r.algorithm).toBe('SHA-256');
    expect(r.issuer).toBe('ACME Co');
    expect(r.label).toBe('ACME Co:alice@acme.com');
  });

  it('falls back to defaults for out-of-range or missing params', () => {
    const r = parseOtpauth('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=99&period=0&algorithm=MD5');
    expect(r.digits).toBe(6);
    expect(r.period).toBe(30);
    expect(r.algorithm).toBe('SHA-1');
  });

  it('reports a non-totp type so the UI can refuse it', () => {
    const r = parseOtpauth('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1');
    expect(r.type).toBe('hotp');
  });

  it('yields an empty secret for an otpauth URI with no secret param', () => {
    expect(parseOtpauth('otpauth://totp/x?issuer=ACME').secret).toBe('');
  });

  it('does not throw on a malformed percent-escape', () => {
    expect(() => parseOtpauth('otpauth://totp/x?secret=JBSWY3DP%')).not.toThrow();
  });
});

describe('TOTP generation via the parsed config (RFC 6238 vector)', () => {
  it('produces the RFC 6238 SHA-1 8-digit code at T=59', async () => {
    // Standard RFC 6238 test key "12345678901234567890" in base32, 8 digits.
    const uri = 'otpauth://totp/RFC?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8';
    const cfg = parseOtpauth(uri);
    const key = base32Decode(cfg.secret);
    const code = await totp(key, { time: 59, period: cfg.period, digits: cfg.digits, algorithm: cfg.algorithm });
    expect(code).toBe('94287082');
  });
});
