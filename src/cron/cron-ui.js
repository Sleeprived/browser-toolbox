import { parseCron, describeCron, nextRuns, CronError } from './cron.js';

const exprInput = document.getElementById('expr');
const errorBox = document.getElementById('error');
const resultBox = document.getElementById('result');
const descEl = document.getElementById('description');
const runsEl = document.getElementById('next-runs');
const tzLabel = document.getElementById('tzlabel');

const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

try {
  tzLabel.textContent = `(${Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'})`;
} catch {
  tzLabel.textContent = '(local time)';
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
  resultBox.classList.add('hidden');
}

function showResult(expr) {
  const cron = parseCron(expr);
  descEl.textContent = describeCron(cron);

  runsEl.replaceChildren();
  const runs = nextRuns(cron, new Date(), 5);
  if (runs.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No upcoming runs found within the search window.';
    runsEl.appendChild(li);
  } else {
    for (const d of runs) {
      const li = document.createElement('li');
      li.textContent = fmt.format(d); // formatted in the browser's local timezone
      runsEl.appendChild(li);
    }
  }
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
