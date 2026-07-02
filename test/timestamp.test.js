import { describe, it, expect } from 'vitest';
import { parseEpoch, formatBoth, dateToEpoch, generateUuid, parseUuid } from '../src/timestamp/timestamp.js';

describe('parseEpoch', () => {
  it('auto-detects seconds vs milliseconds by magnitude', () => {
    expect(parseEpoch('1767225600')).toEqual({ ms: 1767225600000, unit: 's' });
    expect(parseEpoch('1767225600000')).toEqual({ ms: 1767225600000, unit: 'ms' });
  });

  it('handles negative (pre-1970) epochs', () => {
    expect(parseEpoch('-86400')).toEqual({ ms: -86400000, unit: 's' });
  });

  it('rejects garbage with a plain message, never NaN', () => {
    expect(parseEpoch('12.5').error).toMatch(/digits only/i);
    expect(parseEpoch('abc').error).toMatch(/digits only/i);
    expect(parseEpoch('').error).toMatch(/Enter/i);
    expect(parseEpoch('9'.repeat(30)).error).toMatch(/too large/i);
  });

  it('rejects epochs beyond the representable Date range', () => {
    expect(parseEpoch('9000000000000000').error).toMatch(/range/i);
  });
});

describe('formatBoth / dateToEpoch', () => {
  it('round-trips through a Date', () => {
    const { ms } = parseEpoch('1767225600');
    const f = formatBoth(ms);
    expect(f.iso).toBe('2026-01-01T00:00:00.000Z');
    expect(f.utc).toContain('2026');
    const d = new Date(ms);
    expect(dateToEpoch(d)).toEqual({ s: 1767225600, ms: 1767225600000 });
  });
});

describe('generateUuid', () => {
  it('produces valid, distinct v4 UUIDs', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const u = generateUuid();
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      seen.add(u);
    }
    expect(seen.size).toBe(50);
  });
});

describe('parseUuid', () => {
  it('reports version and variant for a v4', () => {
    const p = parseUuid('F47AC10B-58CC-4372-A567-0E02B2C3D479');
    expect(p.version).toBe(4);
    expect(p.variant).toBe('RFC 4122');
    expect(p.timestampMs).toBeUndefined();
  });

  it('extracts the embedded timestamp from a v1', () => {
    // Well-known example UUID: 2022-02-22T19:22:22Z region.
    const p = parseUuid('c232ab00-9414-11ec-b3c8-9f68deced846');
    expect(p.version).toBe(1);
    expect(new Date(p.timestampMs).toISOString()).toBe('2022-02-22T19:22:22.000Z');
  });

  it('extracts the millisecond timestamp from a v7', () => {
    // RFC 9562 example: 017F22E2-79B0-7CC3-98C4-DC0C0C07398F → 2022-02-22T19:22:22Z
    const p = parseUuid('017F22E2-79B0-7CC3-98C4-DC0C0C07398F');
    expect(p.version).toBe(7);
    expect(new Date(p.timestampMs).toISOString()).toBe('2022-02-22T19:22:22.000Z');
  });

  it('accepts urn:uuid: and braced forms', () => {
    expect(parseUuid('urn:uuid:f47ac10b-58cc-4372-a567-0e02b2c3d479').version).toBe(4);
    expect(parseUuid('{f47ac10b-58cc-4372-a567-0e02b2c3d479}').version).toBe(4);
  });

  it('rejects non-UUIDs with a plain message', () => {
    expect(parseUuid('not-a-uuid').error).toMatch(/valid UUID/i);
    expect(parseUuid('').error).toMatch(/Enter/i);
    expect(parseUuid('f47ac10b58cc4372a5670e02b2c3d479').error).toMatch(/valid UUID/i);
  });
});

describe('parseUuid brace handling', () => {
  it('accepts a balanced {uuid} pair', () => {
    expect(parseUuid('{123e4567-e89b-42d3-a456-426614174000}').version).toBe(4);
  });
  it('rejects unbalanced braces', () => {
    expect(parseUuid('{123e4567-e89b-42d3-a456-426614174000').error).toBeTruthy();
    expect(parseUuid('123e4567-e89b-42d3-a456-426614174000}').error).toBeTruthy();
  });
});

describe('v1 UUID timestamps floor pre-1970 tick counts', () => {
  it('a v1 UUID 1 tick before the Unix epoch reads as -1 ms, not 0', () => {
    // Gregorian-to-Unix offset minus one 100ns tick, as a v1 time field.
    const ticks = 122192928000000000n - 1n;
    const hex = ticks.toString(16).padStart(15, '0');
    const uuid = `${hex.slice(7)}-${hex.slice(3, 7)}-1${hex.slice(0, 3)}-8000-000000000000`;
    expect(parseUuid(uuid).timestampMs).toBe(-1);
  });
});

describe('v1 UUID timestamps always fit the Date range', () => {
  it('even the maximum 60-bit tick count yields a timestamp (~year 5236)', () => {
    const p = parseUuid('ffffffff-ffff-1fff-8fff-ffffffffffff');
    expect(p.version).toBe(1);
    expect(p.timestampMs).toBeGreaterThan(0);
    expect(Math.abs(p.timestampMs)).toBeLessThanOrEqual(8.64e15);
  });
});
