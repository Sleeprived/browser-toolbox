// Cron engine: parse a standard 5-field Unix cron expression (plus @nicknames),
// describe it in plain English, and compute the next run times.
// All scheduling math is done in UTC for determinism; the UI applies local
// timezone formatting on top. No seconds / Quartz 6-field syntax.

export class CronError extends Error {}

const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const NICKNAMES = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

function tokenToNum(tok, nameList, nameBase) {
  if (/^\d+$/.test(tok)) return Number(tok);
  if (nameList) {
    const idx = nameList.indexOf(tok.toLowerCase());
    if (idx !== -1) return idx + nameBase;
  }
  throw new CronError(`Invalid value "${tok}"`);
}

function expandField(raw, min, max, nameList, nameBase, normalizeDow) {
  raw = String(raw).trim();
  const values = new Set();

  if (raw === '') throw new CronError('Empty field');

  for (const part of raw.split(',')) {
    const m = part.match(/^(\*|\d+|[a-zA-Z]{3})(?:-(\d+|[a-zA-Z]{3}))?(?:\/(\d+))?$/);
    if (!m) throw new CronError(`Invalid term "${part}"`);
    const [, loTok, hiTok, stepTok] = m;

    let start;
    let end;
    if (loTok === '*') {
      start = min;
      end = max;
    } else {
      start = tokenToNum(loTok, nameList, nameBase);
      if (hiTok != null) {
        end = tokenToNum(hiTok, nameList, nameBase);
      } else if (stepTok != null) {
        end = max; // "N/step" means from N to the field maximum, every step
      } else {
        end = start; // a bare single value
      }
    }
    if (loTok === '*' && hiTok != null) throw new CronError(`Invalid term "${part}"`);

    const step = stepTok != null ? Number(stepTok) : 1;
    if (step < 1) throw new CronError(`Step must be >= 1 in "${part}"`);

    const single = hiTok == null && stepTok == null && loTok !== '*';
    if (single) {
      values.add(start);
    } else {
      if (end < start) throw new CronError(`Range out of order in "${part}"`);
      for (let v = start; v <= end; v += step) values.add(v);
    }
  }

  for (const v of values) {
    if (v < min || v > max) throw new CronError(`Value ${v} out of range ${min}-${max}`);
  }

  if (normalizeDow && values.has(7)) {
    values.delete(7);
    values.add(0);
  }

  return {
    all: raw === '*',
    step: /^\*\/(\d+)$/.test(raw) ? Number(raw.match(/^\*\/(\d+)$/)[1]) : null,
    values,
    raw,
  };
}

export function parseCron(expr) {
  if (typeof expr !== 'string') throw new CronError('Expression must be a string');
  let text = expr.trim();
  if (text === '') throw new CronError('Empty expression');

  if (text.startsWith('@')) {
    const mapped = NICKNAMES[text.toLowerCase()];
    if (!mapped) throw new CronError(`Unknown nickname "${text}"`);
    text = mapped;
  }

  const parts = text.split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(`Expected 5 fields, got ${parts.length}`);
  }

  const minute = expandField(parts[0], 0, 59, null, 0, false);
  const hour = expandField(parts[1], 0, 23, null, 0, false);
  const dom = expandField(parts[2], 1, 31, null, 0, false);
  const month = expandField(parts[3], 1, 12, MON_NAMES, 1, false);
  const dow = expandField(parts[4], 0, 7, DOW_NAMES, 0, true);

  return {
    source: expr.trim(),
    normalized: text,
    minute,
    hour,
    dom,
    month,
    dow,
    domRestricted: parts[2].trim() !== '*',
    dowRestricted: parts[4].trim() !== '*',
  };
}

function matches(cron, date) {
  if (!cron.minute.values.has(date.getUTCMinutes())) return false;
  if (!cron.hour.values.has(date.getUTCHours())) return false;
  if (!cron.month.values.has(date.getUTCMonth() + 1)) return false;

  const domMatch = cron.dom.values.has(date.getUTCDate());
  const dowMatch = cron.dow.values.has(date.getUTCDay());

  // Vixie cron rule: if BOTH day-of-month and day-of-week are restricted,
  // the schedule fires when EITHER matches. Otherwise use the restricted one.
  if (cron.domRestricted && cron.dowRestricted) return domMatch || dowMatch;
  if (cron.domRestricted) return domMatch;
  if (cron.dowRestricted) return dowMatch;
  return true;
}

// Compute the next `count` run times strictly after `from` (a Date or ms),
// in UTC. Returns an array of Date objects (UTC instants).
export function nextRuns(cronOrExpr, from = new Date(), count = 5) {
  const cron = typeof cronOrExpr === 'string' ? parseCron(cronOrExpr) : cronOrExpr;
  const fromMs = from instanceof Date ? from.getTime() : Number(from);

  // Short-circuit impossible day-of-month/month combinations (e.g. Feb 30) so we
  // never run the full multi-year scan only to return nothing. Only applies when
  // the day is constrained solely by day-of-month (day-of-week is unrestricted).
  if (cron.domRestricted && !cron.dowRestricted) {
    const monthMaxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const minDom = Math.min(...cron.dom.values);
    let maxAllowedDay = 0;
    for (const m of cron.month.values) maxAllowedDay = Math.max(maxAllowedDay, monthMaxDay[m - 1]);
    if (minDom > maxAllowedDay) return [];
  }

  // Start at the beginning of the next whole minute after `from`.
  let cursor = Math.floor(fromMs / 60000) * 60000 + 60000;
  const runs = [];
  // Cap the search at ~5 years of minutes to avoid hanging on impossible dates.
  const maxIterations = 5 * 366 * 24 * 60;
  let i = 0;

  while (runs.length < count && i < maxIterations) {
    const d = new Date(cursor);
    if (matches(cron, d)) runs.push(d);
    cursor += 60000;
    i++;
  }
  return runs;
}

// ---- Plain-English description ----------------------------------------------

function listJoin(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function contiguous(sortedVals) {
  for (let i = 1; i < sortedVals.length; i++) {
    if (sortedVals[i] !== sortedVals[i - 1] + 1) return false;
  }
  return sortedVals.length >= 1;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function describeTime(cron) {
  const min = cron.minute;
  const hour = cron.hour;
  const minVals = [...min.values].sort((a, b) => a - b);

  if (min.all && hour.all) return 'every minute';
  if (min.step && hour.all) return `every ${min.step} minutes`;
  if (minVals.length === 1 && hour.all) {
    return `at minute ${minVals[0]} of every hour`;
  }
  const hourVals = [...hour.values].sort((a, b) => a - b);
  if (minVals.length === 1 && hourVals.length === 1) {
    return `at ${pad2(hourVals[0])}:${pad2(minVals[0])}`;
  }
  if (hour.step && minVals.length === 1) {
    return `at minute ${minVals[0]}, every ${hour.step} hours`;
  }
  // Generic fallback.
  const minPart = min.all ? 'every minute' : `minute ${listJoin(minVals.map(String))}`;
  const hourPart = hour.all ? 'every hour' : `hour ${listJoin(hourVals.map(String))}`;
  return `at ${minPart} past ${hourPart}`;
}

function describeWeekdays(cron) {
  const vals = [...cron.dow.values].sort((a, b) => a - b);
  if (vals.length === 1) return `only on ${WEEKDAY_FULL[vals[0]]}`;
  if (contiguous(vals) && vals.length >= 3) {
    return `${WEEKDAY_FULL[vals[0]]} through ${WEEKDAY_FULL[vals[vals.length - 1]]}`;
  }
  return `on ${listJoin(vals.map((v) => WEEKDAY_FULL[v]))}`;
}

function describeDom(cron) {
  const vals = [...cron.dom.values].sort((a, b) => a - b);
  if (vals.length === 1) return `on day ${vals[0]} of the month`;
  return `on days ${listJoin(vals.map(String))} of the month`;
}

function describeMonths(cron) {
  const vals = [...cron.month.values].sort((a, b) => a - b);
  if (contiguous(vals) && vals.length >= 3) {
    return `from ${MONTH_FULL[vals[0] - 1]} through ${MONTH_FULL[vals[vals.length - 1] - 1]}`;
  }
  return `in ${listJoin(vals.map((v) => MONTH_FULL[v - 1]))}`;
}

export function describeCron(cronOrExpr) {
  const cron = typeof cronOrExpr === 'string' ? parseCron(cronOrExpr) : cronOrExpr;

  const parts = [describeTime(cron)];

  // Day phrase: respect Vixie OR-semantics when both dom and dow are restricted.
  if (cron.domRestricted && cron.dowRestricted) {
    parts.push(`${describeDom(cron)} or ${describeWeekdays(cron)}`);
  } else if (cron.domRestricted) {
    parts.push(describeDom(cron));
  } else if (cron.dowRestricted) {
    parts.push(describeWeekdays(cron));
  } else {
    parts.push('every day');
  }

  if (!cron.month.all) {
    parts.push(describeMonths(cron));
  }

  let sentence = parts.join(', ');
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
  return sentence;
}
