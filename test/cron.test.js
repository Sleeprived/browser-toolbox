import { describe, it, expect } from 'vitest';
import { parseCron, nextRuns, describeCron, CronError } from '../src/cron/cron.js';

describe('parseCron', () => {
  it('parses a standard 5-field expression', () => {
    const c = parseCron('0 9 * * 1-5');
    expect([...c.minute.values]).toEqual([0]);
    expect([...c.hour.values]).toEqual([9]);
    expect([...c.dow.values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('expands steps, ranges and lists', () => {
    const c = parseCron('*/15 1-3 1,15 * *');
    expect([...c.minute.values]).toEqual([0, 15, 30, 45]);
    expect([...c.hour.values]).toEqual([1, 2, 3]);
    expect([...c.dom.values]).toEqual([1, 15]);
  });

  it('expands the N/step start-and-step form to the field maximum', () => {
    expect([...parseCron('0/15 * * * *').minute.values]).toEqual([0, 15, 30, 45]);
    expect([...parseCron('5/20 * * * *').minute.values]).toEqual([5, 25, 45]);
    expect([...parseCron('* 2/6 * * *').hour.values]).toEqual([2, 8, 14, 20]);
  });

  it('supports month and weekday names', () => {
    const c = parseCron('0 0 * jan-mar mon');
    expect([...c.month.values]).toEqual([1, 2, 3]);
    expect([...c.dow.values]).toEqual([1]);
  });

  it('normalizes weekday 7 to 0 (Sunday)', () => {
    const c = parseCron('0 0 * * 7');
    expect([...c.dow.values]).toEqual([0]);
  });

  it('expands nicknames', () => {
    expect(parseCron('@hourly').normalized).toBe('0 * * * *');
    expect(parseCron('@daily').normalized).toBe('0 0 * * *');
    expect(parseCron('@weekly').normalized).toBe('0 0 * * 0');
    expect(parseCron('@monthly').normalized).toBe('0 0 1 * *');
    expect(parseCron('@yearly').normalized).toBe('0 0 1 1 *');
    expect(parseCron('@midnight').normalized).toBe('0 0 * * *');
  });

  it('rejects malformed expressions', () => {
    expect(() => parseCron('')).toThrow(CronError);
    expect(() => parseCron('* * *')).toThrow(CronError);
    expect(() => parseCron('60 * * * *')).toThrow(CronError);
    expect(() => parseCron('* 24 * * *')).toThrow(CronError);
    expect(() => parseCron('* * 0 * *')).toThrow(CronError);
    expect(() => parseCron('5-1 * * * *')).toThrow(CronError);
    expect(() => parseCron('@bogus')).toThrow(CronError);
    expect(() => parseCron('a * * * *')).toThrow(CronError);
  });
});

describe('describeCron', () => {
  const expectations = {
    '0 9 * * 1-5': 'At 09:00, Monday through Friday.',
    '*/15 * * * *': 'Every 15 minutes, every day.',
    '0 0 * * *': 'At 00:00, every day.',
    '0 0 1 * *': 'At 00:00, on day 1 of the month.',
    '30 8 * * 1': 'At 08:30, only on Monday.',
    '0 12 * * 0': 'At 12:00, only on Sunday.',
    '0 0 1 1 *': 'At 00:00, on day 1 of the month, in January.',
    '@hourly': 'At minute 0 of every hour, every day.',
    '0 0 13 * 5': 'At 00:00, on day 13 of the month or only on Friday.',
    '0-30 9 * * *': 'At minute 0 through 30 past 09:00, every day.',
    '0 9-17 * * *': 'At minute 0 past hours 9 through 17, every day.',
  };
  for (const [expr, text] of Object.entries(expectations)) {
    it(`describes "${expr}"`, () => {
      expect(describeCron(expr)).toBe(text);
    });
  }
});

describe('nextRuns (UTC, deterministic)', () => {
  it('weekday 9am from a Saturday lands on the next Monday', () => {
    const from = new Date('2026-06-20T00:00:00Z'); // Saturday
    const runs = nextRuns('0 9 * * 1-5', from, 3).map((d) => d.toISOString());
    expect(runs).toEqual([
      '2026-06-22T09:00:00.000Z',
      '2026-06-23T09:00:00.000Z',
      '2026-06-24T09:00:00.000Z',
    ]);
  });

  it('every 15 minutes steps cleanly across the hour', () => {
    const runs = nextRuns('*/15 * * * *', new Date('2026-03-10T08:07:00Z'), 5)
      .map((d) => d.toISOString());
    expect(runs).toEqual([
      '2026-03-10T08:15:00.000Z',
      '2026-03-10T08:30:00.000Z',
      '2026-03-10T08:45:00.000Z',
      '2026-03-10T09:00:00.000Z',
      '2026-03-10T09:15:00.000Z',
    ]);
  });

  it('daily midnight rolls to the next day', () => {
    const runs = nextRuns('0 0 * * *', new Date('2026-01-01T12:00:00Z'), 2)
      .map((d) => d.toISOString());
    expect(runs).toEqual(['2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z']);
  });

  it('returns no runs immediately for an impossible date (Feb 30)', () => {
    const start = Date.now();
    const runs = nextRuns('0 0 30 2 *', new Date('2026-01-01T00:00:00Z'), 5);
    expect(runs).toEqual([]);
    expect(Date.now() - start).toBeLessThan(50); // short-circuited, not a full scan
  });

  it('yearly schedule leaps to the next occurrence', () => {
    const runs = nextRuns('0 0 1 1 *', new Date('2026-06-20T00:00:00Z'), 2)
      .map((d) => d.toISOString());
    expect(runs).toEqual(['2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z']);
  });

  it('all produced runs actually satisfy the schedule', () => {
    const runs = nextRuns('30 8 * * 1', new Date('2026-06-20T00:00:00Z'), 6);
    for (const d of runs) {
      expect(d.getUTCMinutes()).toBe(30);
      expect(d.getUTCHours()).toBe(8);
      expect(d.getUTCDay()).toBe(1);
    }
    // strictly increasing
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].getTime()).toBeGreaterThan(runs[i - 1].getTime());
    }
  });

  it('finds leap-day runs without undercounting (Feb 29)', () => {
    const runs = nextRuns('0 12 29 2 *', new Date('2026-01-01T00:00:00Z'), 3)
      .map((d) => d.toISOString());
    expect(runs).toEqual([
      '2028-02-29T12:00:00.000Z',
      '2032-02-29T12:00:00.000Z',
      '2036-02-29T12:00:00.000Z',
    ]);
  });

  it('is fast even for sparse schedules', () => {
    const start = Date.now();
    nextRuns('0 12 29 2 *', new Date('2026-01-01T00:00:00Z'), 5);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
