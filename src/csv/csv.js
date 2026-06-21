// CSV engine: a correct RFC-4180-style parser/serializer plus CSV<->JSON
// conversion. Handles quoted fields, escaped quotes (""), embedded delimiters,
// and embedded newlines. Pure functions — no DOM, no globals.

export class CsvError extends Error {}

// Parse CSV text into an array of rows (each row an array of string cells).
export function parseCsv(text, delimiter = ',') {
  if (typeof text !== 'string') throw new CsvError('Input must be a string');
  if (delimiter.length !== 1) throw new CsvError('Delimiter must be a single character');

  // Strip a leading UTF-8 BOM so the first column key isn't "﻿name".
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let sawAnyChar = false;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    sawAnyChar = true;

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      i += 1;
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else if (c === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i += 1;
    }
  }

  if (inQuotes) throw new CsvError('Unterminated quoted field');

  // Flush the final field/row unless the text ended exactly on a row break
  // (in which case row is empty and field is empty and we add nothing extra).
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  } else if (!sawAnyChar) {
    // empty input -> no rows
  }

  return rows;
}

function needsQuoting(value, delimiter) {
  return (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  );
}

function quoteCell(value, delimiter) {
  const s = value == null ? '' : String(value);
  if (needsQuoting(s, delimiter)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Serialize rows (array of arrays) back into CSV text. Uses \n line endings.
export function serializeCsv(rows, delimiter = ',') {
  if (!Array.isArray(rows)) throw new CsvError('Rows must be an array');
  return rows
    .map((row) => row.map((cell) => quoteCell(cell, delimiter)).join(delimiter))
    .join('\n');
}

// Disambiguate duplicate header names so no column is silently lost.
function uniqueHeaders(header) {
  const seen = new Map();
  return header.map((name) => {
    const base = name === '' ? 'column' : name;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

// Convert parsed rows to an array of objects. First row is the header.
// The header is padded to the widest row so extra cells are never lost.
export function rowsToObjects(rows) {
  if (rows.length === 0) return { header: [], objects: [] };
  let width = 0;
  for (const r of rows) if (r.length > width) width = r.length;
  const rawHeader = rows[0].slice();
  while (rawHeader.length < width) rawHeader.push(`column_${rawHeader.length + 1}`);
  const header = uniqueHeaders(rawHeader);
  const objects = rows.slice(1).map((row) => {
    const obj = {};
    header.forEach((key, idx) => {
      obj[key] = row[idx] !== undefined ? row[idx] : '';
    });
    return obj;
  });
  return { header, objects };
}

// Convert an array of objects to rows (header + data) for serialization.
export function objectsToRows(objects) {
  if (!Array.isArray(objects)) throw new CsvError('Expected a JSON array of objects');
  const header = [];
  const seen = new Set();
  for (const obj of objects) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new CsvError('Each JSON item must be an object');
    }
    for (const key of Object.keys(obj)) {
      if (!seen.has(key)) {
        seen.add(key);
        header.push(key);
      }
    }
  }
  const rows = [header];
  for (const obj of objects) {
    rows.push(header.map((key) => {
      const v = obj[key];
      if (v === undefined || v === null) return '';
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }));
  }
  return rows;
}

// High-level helpers used by the UI.
export function csvToJson(text, delimiter = ',', pretty = true) {
  const rows = parseCsv(text, delimiter);
  const { objects } = rowsToObjects(rows);
  return JSON.stringify(objects, null, pretty ? 2 : 0);
}

export function jsonToCsv(jsonText, delimiter = ',') {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new CsvError('Invalid JSON: ' + e.message);
  }
  if (!Array.isArray(data)) throw new CsvError('JSON must be an array of objects');
  return serializeCsv(objectsToRows(data), delimiter);
}
