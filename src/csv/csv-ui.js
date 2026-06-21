import {
  parseCsv,
  serializeCsv,
  rowsToObjects,
  objectsToRows,
  CsvError,
} from './csv.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const delimSel = document.getElementById('delim');
const fileInput = document.getElementById('file');
const csvIn = document.getElementById('csv-in');
const parseBtn = document.getElementById('parse');
const sampleBtn = document.getElementById('sample');
const errorBox = document.getElementById('error');
const warnBox = document.getElementById('warn');
const tableCard = document.getElementById('table-card');
const outputCard = document.getElementById('output-card');
const dims = document.getElementById('dims');
const table = document.getElementById('table');
const prettyChk = document.getElementById('pretty');
const toJsonBtn = document.getElementById('to-json');
const dlJsonBtn = document.getElementById('dl-json');
const dlCsvBtn = document.getElementById('dl-csv');
const jsonOut = document.getElementById('json-out');
const jsonIn = document.getElementById('json-in');
const fromJsonBtn = document.getElementById('from-json');

// Application state: a header array and data rows (arrays aligned to header).
let state = { header: [], rows: [], sortCol: -1, sortDir: 1 };

function delimiter() {
  return delimSel.value === '\\t' ? '\t' : delimSel.value;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}
function clearError() {
  errorBox.classList.add('hidden');
}
function showWarn(msg) {
  warnBox.textContent = msg;
  warnBox.classList.remove('hidden');
}
function clearWarn() {
  warnBox.classList.add('hidden');
}

function setData(header, rows) {
  state = { header, rows, sortCol: -1, sortDir: 1 };
  render();
}

function render() {
  table.replaceChildren();
  if (state.header.length === 0) {
    tableCard.classList.add('hidden');
    outputCard.classList.add('hidden');
    return;
  }
  tableCard.classList.remove('hidden');
  outputCard.classList.remove('hidden');
  dims.textContent = `(${state.rows.length} rows × ${state.header.length} cols)`;

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  state.header.forEach((name, idx) => {
    const th = document.createElement('th');

    const sortBtn = document.createElement('button');
    sortBtn.className = 'btn secondary';
    sortBtn.type = 'button';
    let label = name;
    if (state.sortCol === idx) label += state.sortDir === 1 ? ' ▲' : ' ▼';
    sortBtn.textContent = label; // textContent = XSS-safe
    sortBtn.addEventListener('click', () => sortByColumn(idx));

    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn secondary';
    renameBtn.type = 'button';
    renameBtn.textContent = '✎';
    renameBtn.title = 'Rename column';
    renameBtn.addEventListener('click', () => renameColumn(idx));

    const dropBtn = document.createElement('button');
    dropBtn.className = 'btn secondary';
    dropBtn.type = 'button';
    dropBtn.textContent = '✕';
    dropBtn.title = 'Drop column';
    dropBtn.addEventListener('click', () => dropColumn(idx));

    const wrap = document.createElement('div');
    wrap.className = 'btn-row';
    wrap.append(sortBtn, renameBtn, dropBtn);
    th.appendChild(wrap);
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  // Cap rendered rows for responsiveness; full data is still kept in state.
  const limit = Math.min(state.rows.length, 500);
  for (let r = 0; r < limit; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < state.header.length; c++) {
      const td = document.createElement('td');
      td.textContent = state.rows[r][c] !== undefined ? state.rows[r][c] : '';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  if (state.rows.length > limit) {
    const note = document.createElement('caption');
    note.textContent = `Showing first ${limit} of ${state.rows.length} rows (all rows are exported).`;
    table.appendChild(note);
  }
}

function sortByColumn(idx) {
  if (state.sortCol === idx) state.sortDir *= -1;
  else { state.sortCol = idx; state.sortDir = 1; }
  const dir = state.sortDir;
  state.rows.sort((a, b) => {
    const x = a[idx] ?? '';
    const y = b[idx] ?? '';
    const isNum = (v) => /^-?\d+(\.\d+)?$/.test(String(v).trim());
    const bothNum = isNum(x) && isNum(y);
    if (bothNum) return (Number(x) - Number(y)) * dir;
    return String(x).localeCompare(String(y)) * dir;
  });
  render();
}

function renameColumn(idx) {
  const next = window.prompt('Rename column', state.header[idx]);
  if (next === null) return;
  state.header[idx] = next;
  render();
}

function dropColumn(idx) {
  state.header.splice(idx, 1);
  state.rows.forEach((row) => row.splice(idx, 1));
  // Keep the sort indicator pointing at the right column after the shift.
  if (state.sortCol === idx) state.sortCol = -1;
  else if (state.sortCol > idx) state.sortCol -= 1;
  render();
}

function parseFromText() {
  clearError();
  clearWarn();
  try {
    const rows = parseCsv(csvIn.value, delimiter());
    if (rows.length === 0) {
      showError('No data to parse.');
      setData([], []);
      return;
    }
    let width = 0;
    for (const r of rows) if (r.length > width) width = r.length;
    const header = [];
    for (let i = 0; i < width; i++) {
      const h = rows[0][i];
      header.push(h === undefined || h === '' ? `column_${i + 1}` : h);
    }
    const ragged = rows.some((r) => r.length !== width);
    if (ragged) showWarn('Some rows have a different number of columns — short rows were padded and extra cells kept.');
    setData(header, rows.slice(1));
  } catch (e) {
    showError(e instanceof CsvError ? e.message : 'Could not parse CSV.');
  }
}

function currentRows() {
  return [state.header, ...state.rows];
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

parseBtn.addEventListener('click', parseFromText);

sampleBtn.addEventListener('click', () => {
  csvIn.value = 'name,role,city\nAda Lovelace,Mathematician,"London, UK"\nAlan Turing,"Computer Scientist","Maida Vale"\nGrace Hopper,Admiral,"New York"';
  parseFromText();
});

function readCsvFile(f) {
  if (!f) return;
  if (f.size > MAX_FILE_BYTES) {
    showError(`That file is ${(f.size / 1048576).toFixed(1)} MB — over the 25 MB limit. Skipped.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => { csvIn.value = String(reader.result); parseFromText(); };
  reader.onerror = () => showError('Could not read that file.');
  reader.readAsText(f);
}

fileInput.addEventListener('change', () => readCsvFile(fileInput.files && fileInput.files[0]));

['dragenter', 'dragover'].forEach((evt) =>
  csvIn.addEventListener(evt, (e) => { e.preventDefault(); csvIn.classList.add('drag'); }),
);
csvIn.addEventListener('dragleave', (e) => { e.preventDefault(); csvIn.classList.remove('drag'); });
csvIn.addEventListener('drop', (e) => {
  e.preventDefault();
  csvIn.classList.remove('drag');
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) readCsvFile(f);
});

toJsonBtn.addEventListener('click', () => {
  const { objects } = rowsToObjects(currentRows());
  jsonOut.textContent = JSON.stringify(objects, null, prettyChk.checked ? 2 : 0);
});

dlJsonBtn.addEventListener('click', () => {
  const { objects } = rowsToObjects(currentRows());
  download('data.json', JSON.stringify(objects, null, prettyChk.checked ? 2 : 0), 'application/json');
});

dlCsvBtn.addEventListener('click', () => {
  download('data.csv', serializeCsv(currentRows(), delimiter(), { sanitizeFormulas: true }), 'text/csv');
});

fromJsonBtn.addEventListener('click', () => {
  clearError();
  let data;
  try {
    data = JSON.parse(jsonIn.value);
  } catch (e) {
    showError('Invalid JSON: ' + e.message);
    return;
  }
  try {
    const rows = objectsToRows(data);
    setData(rows[0], rows.slice(1));
  } catch (e) {
    showError(e instanceof CsvError ? e.message : 'Could not load JSON.');
  }
});
