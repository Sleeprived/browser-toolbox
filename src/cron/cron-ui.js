import { parseCron, describeCron, nextRuns, fieldSummaries, weeklyHeatmap, CronError } from './cron.js';

const exprInput = document.getElementById('expr');
const errorBox = document.getElementById('error');
const resultBox = document.getElementById('result');
const descEl = document.getElementById('description');
const fieldsEl = document.getElementById('fields');
const warnEl = document.getElementById('dow-warning');
const heatWrap = document.getElementById('heatmap-wrap');
const heatNote = document.getElementById('heatmap-note');
const runsEl = document.getElementById('next-runs');
const tzLabel = document.getElementById('tzlabel');

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// All cron math is in UTC (see cron.js), and the plain-English description prints
// the raw field values verbatim. Format the run times in UTC too so the two halves
// of the result always show the same clock time, regardless of the viewer's zone.
const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
});

tzLabel.textContent = '(UTC)';

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
  resultBox.classList.add('hidden');
}

function renderFields(cron) {
  fieldsEl.replaceChildren();
  for (const f of fieldSummaries(cron)) {
    const cell = document.createElement('div');
    cell.className = 'cron-field' + (f.all ? ' is-any' : '');

    const label = document.createElement('div');
    label.className = 'cf-label';
    label.textContent = f.label;

    const raw = document.createElement('div');
    raw.className = 'cf-raw mono';
    raw.textContent = f.raw;

    const val = document.createElement('div');
    val.className = 'cf-val';
    val.textContent = f.display;

    const range = document.createElement('div');
    range.className = 'cf-range';
    range.textContent = f.range;

    cell.append(label, raw, val, range);
    fieldsEl.appendChild(cell);
  }
}

function renderWarning(cron) {
  if (cron.domRestricted && cron.dowRestricted) {
    warnEl.textContent =
      `Heads up: this restricts both day-of-month (${cron.dom.raw}) and day-of-week (${cron.dow.raw}). `
      + 'Cron combines those two fields with OR, not AND — the job runs whenever either one matches, '
      + 'not only when they line up.';
    warnEl.classList.remove('hidden');
  } else {
    warnEl.classList.add('hidden');
  }
}

function renderHeatmap(cron, from) {
  heatWrap.replaceChildren();
  const grid = weeklyHeatmap(cron, from, 5);

  if (!grid.anyFires) {
    heatNote.textContent = 'This schedule does not fire in the next 5 weeks — see the run list below.';
    return;
  }

  const table = document.createElement('div');
  table.className = 'heatmap';
  table.setAttribute('aria-hidden', 'true'); // colour grid; the run list carries the same info for SRs

  // Header row: a blank corner, then an hour tick every 3 hours.
  table.appendChild(document.createElement('div')); // corner
  for (let h = 0; h < 24; h++) {
    const head = document.createElement('div');
    head.className = 'hm-hour';
    head.textContent = h % 3 === 0 ? String(h) : '';
    table.appendChild(head);
  }

  let total = 0;
  for (let w = 0; w < 7; w++) {
    const label = document.createElement('div');
    label.className = 'hm-day';
    label.textContent = WEEKDAY_SHORT[w];
    table.appendChild(label);

    for (let h = 0; h < 24; h++) {
      const n = grid.counts[w][h];
      total += n;
      const cell = document.createElement('div');
      cell.className = 'hm-cell';
      if (n > 0) {
        const alpha = 0.18 + 0.82 * (n / grid.max);
        cell.style.background = `rgba(91, 157, 255, ${alpha.toFixed(3)})`;
        cell.title = `${WEEKDAY_SHORT[w]} ${String(h).padStart(2, '0')}:00 — ${n} run${n === 1 ? '' : 's'}`;
      }
      table.appendChild(cell);
    }
  }

  heatWrap.appendChild(table);
  heatNote.textContent =
    `${total} run${total === 1 ? '' : 's'} across the next 5 weeks. Each cell is one weekday × hour slot; darker means more frequent.`;
}

function renderRuns(cron, from) {
  runsEl.replaceChildren();
  const runs = nextRuns(cron, from, 5);
  if (runs.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No upcoming runs found within the search window.';
    runsEl.appendChild(li);
    return;
  }
  for (const d of runs) {
    const li = document.createElement('li');
    li.textContent = fmt.format(d); // formatted in UTC to match the description
    runsEl.appendChild(li);
  }
  if (runs.length < 5) {
    const li = document.createElement('li');
    li.className = 'lead';
    li.textContent = `Only ${runs.length} upcoming run${runs.length === 1 ? '' : 's'} fall within the search window — this schedule is rare.`;
    runsEl.appendChild(li);
  }
}

function showResult(expr) {
  const cron = parseCron(expr);
  const now = new Date();

  descEl.textContent = describeCron(cron);
  renderFields(cron);
  renderWarning(cron);
  renderHeatmap(cron, now);
  renderRuns(cron, now);

  errorBox.classList.add('hidden');
  resultBox.classList.remove('hidden');
}

function update() {
  const expr = exprInput.value.trim();
  if (expr === '') {
    errorBox.classList.add('hidden');
    resultBox.classList.add('hidden');
    return;
  }
  try {
    showResult(expr);
  } catch (e) {
    if (e instanceof CronError) showError(e.message);
    else showError('Could not parse that expression.');
  }
}

exprInput.addEventListener('input', update);

for (const btn of document.querySelectorAll('[data-ex]')) {
  btn.addEventListener('click', () => {
    exprInput.value = btn.getAttribute('data-ex');
    update();
  });
}

update();
