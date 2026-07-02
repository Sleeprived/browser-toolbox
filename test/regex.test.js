import { describe, it, expect } from 'vitest';
import { runRegex, MAX_MATCHES, MAX_TEXT_CHARS } from '../src/regex/regex.js';

describe('runRegex', () => {
  it('lists global matches with index and groups', () => {
    const r = runRegex('(\\w+)@(\\w+)', 'g', 'a@b c@d');
    expect(r.error).toBeUndefined();
    expect(r.matches.map((m) => m.text)).toEqual(['a@b', 'c@d']);
    expect(r.matches[0]).toMatchObject({ index: 0, groups: ['a', 'b'] });
  });

  it('without the g flag only the first match is reported', () => {
    const r = runRegex('\\d+', '', 'a1 b22 c333');
    expect(r.matches.map((m) => m.text)).toEqual(['1']);
  });

  it('captures named groups', () => {
    const r = runRegex('(?<year>\\d{4})-(?<month>\\d{2})', 'g', '2026-07');
    expect(r.matches[0].named).toEqual({ year: '2026', month: '07' });
  });

  it('an invalid pattern returns the SyntaxError message, never throws', () => {
    const r = runRegex('a(', 'g', 'aaa');
    expect(r.error).toMatch(/Invalid regular expression|Unterminated/i);
  });

  it('rejects bad or duplicate flags inline', () => {
    expect(runRegex('a', 'gz', 'a').error).toMatch(/flags/i);
    expect(runRegex('a', 'gg', 'a').error).toMatch(/flags/i);
  });

  it('builds highlight segments that reassemble the exact input text', () => {
    const text = 'one two one three';
    const r = runRegex('one', 'g', text);
    expect(r.segments.map((s) => s.text).join('')).toBe(text);
    expect(r.segments.filter((s) => s.match).length).toBe(2);
  });

  it('zero-length matches cannot loop forever', () => {
    const r = runRegex('a*', 'g', 'bbb');
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.length).toBeLessThanOrEqual(MAX_MATCHES);
  });

  it('caps the number of matches and flags truncation', () => {
    const r = runRegex('a', 'g', 'a'.repeat(MAX_MATCHES + 500));
    expect(r.matches.length).toBe(MAX_MATCHES);
    expect(r.truncated).toBe(true);
  });

  it('stops enumerating when the time budget is exhausted', () => {
    let calls = 0;
    // Fake clock: every check claims 10s have passed.
    const r = runRegex('a', 'g', 'aaaaaa', () => { calls++; return calls === 1 ? 0 : 999999; });
    expect(r.timedOut).toBe(true);
    expect(r.matches.length).toBe(1);
  });

  it('rejects over-limit text with a plain message', () => {
    expect(runRegex('a', 'g', 'x'.repeat(MAX_TEXT_CHARS + 1)).error).toMatch(/1 MB/);
  });

  it('empty pattern asks for a pattern instead of matching everywhere', () => {
    expect(runRegex('', 'g', 'abc').error).toMatch(/pattern/i);
  });
});

describe('zero-length matches advance by code point under the unicode flags', () => {
  it('never yields a match at a surrogate-interior index', () => {
    const res = runRegex('(?:)', 'gu', '\u{1F600}a');
    expect(res.matches.map((m) => m.index)).toEqual([0, 2, 3]);
  });
  it('still advances one code unit without a unicode flag', () => {
    const res = runRegex('(?:)', 'g', 'ab');
    expect(res.matches.map((m) => m.index)).toEqual([0, 1, 2]);
  });
});
