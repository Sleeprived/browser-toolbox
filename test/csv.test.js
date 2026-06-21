import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  serializeCsv,
  rowsToObjects,
  objectsToRows,
  csvToJson,
  jsonToCsv,
  CsvError,
} from '../src/csv/csv.js';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with embedded commas', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
  });

  it('handles escaped quotes ("")', () => {
    expect(parseCsv('"he said ""hi"""')).toEqual([['he said "hi"']]);
  });

  it('handles embedded newlines inside quotes', () => {
    expect(parseCsv('"line1\nline2",x')).toEqual([['line1\nline2', 'x']]);
  });

  it('preserves empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('does not emit a trailing empty row for a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('supports a custom delimiter', () => {
    expect(parseCsv('a;b;c', ';')).toEqual([['a', 'b', 'c']]);
  });

  it('returns no rows for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('throws on an unterminated quote', () => {
    expect(() => parseCsv('"abc')).toThrow(CsvError);
  });
});

describe('serializeCsv', () => {
  it('quotes only when necessary', () => {
    expect(serializeCsv([['a', 'b,c', 'd"e']])).toBe('a,"b,c","d""e"');
  });

  it('quotes fields with newlines', () => {
    expect(serializeCsv([['x\ny']])).toBe('"x\ny"');
  });

  it('does not sanitize formula-like cells by default (round-trip fidelity)', () => {
    expect(serializeCsv([['=1+1', '+ok', '-3', '@x']])).toBe('=1+1,+ok,-3,@x');
  });

  it('prefixes formula-like cells with an apostrophe when sanitizeFormulas is set', () => {
    expect(
      serializeCsv([['=1+1', '+ok', '-3', '@x', '\tt', '\rr', 'safe']], ',', {
        sanitizeFormulas: true,
      }),
    ).toBe("'=1+1,'+ok,'-3,'@x,'\tt,\"'\rr\",safe");
  });
});

describe('round-trips', () => {
  const nasty = [
    ['name', 'note', 'qty'],
    ['Smith, John', 'said "hi"', '3'],
    ['multi\nline', '', '0'],
    ['plain', 'a;b', ''],
  ];

  it('rows -> CSV -> rows is stable', () => {
    const csv = serializeCsv(nasty);
    expect(parseCsv(csv)).toEqual(nasty);
  });

  it('CSV -> JSON -> CSV preserves data', () => {
    const csv = serializeCsv(nasty);
    const json = csvToJson(csv);
    const back = jsonToCsv(json);
    expect(parseCsv(back)).toEqual(nasty);
  });
});

describe('CSV <-> JSON conversion', () => {
  it('converts rows to objects using the header', () => {
    const rows = parseCsv('name,age\nAda,36\nAlan,41');
    expect(rowsToObjects(rows).objects).toEqual([
      { name: 'Ada', age: '36' },
      { name: 'Alan', age: '41' },
    ]);
  });

  it('disambiguates duplicate headers instead of losing columns', () => {
    const { header } = rowsToObjects(parseCsv('id,id,id\n1,2,3'));
    expect(header).toEqual(['id', 'id_2', 'id_3']);
  });

  it('objectsToRows unions keys across objects in first-seen order', () => {
    const rows = objectsToRows([{ a: 1, b: 2 }, { b: 3, c: 4 }]);
    expect(rows[0]).toEqual(['a', 'b', 'c']);
    expect(rows[1]).toEqual(['1', '2', '']);
    expect(rows[2]).toEqual(['', '3', '4']);
  });

  it('csvToJson produces pretty JSON of objects', () => {
    expect(JSON.parse(csvToJson('a,b\n1,2'))).toEqual([{ a: '1', b: '2' }]);
  });

  it('jsonToCsv rejects non-arrays and non-objects', () => {
    expect(() => jsonToCsv('{"a":1}')).toThrow(CsvError);
    expect(() => jsonToCsv('[1,2,3]')).toThrow(CsvError);
    expect(() => jsonToCsv('not json')).toThrow(CsvError);
  });

  it('strips a leading UTF-8 BOM so the first header is clean', () => {
    const rows = parseCsv('﻿name,age\nAda,36');
    expect(rows[0]).toEqual(['name', 'age']); // not ['﻿name', 'age']
  });

  it('pads the header to the widest row so extra cells are not lost', () => {
    const rows = parseCsv('a,b\n1,2,3');
    const { header, objects } = rowsToObjects(rows);
    expect(header).toEqual(['a', 'b', 'column_3']);
    expect(objects[0]).toEqual({ a: '1', b: '2', column_3: '3' });
  });

  it('keeps a "__proto__" header as a real own data property', () => {
    // Assert on the JSON string: an object literal { __proto__: ... } would set
    // the prototype rather than create the own key, so build expected the same
    // way the engine does (Object.create(null)) to verify the round-trip.
    const expected = Object.create(null);
    expected.__proto__ = 'foo';
    expected.age = '36';
    expect(csvToJson('__proto__,age\nfoo,36')).toBe(JSON.stringify([expected], null, 2));
  });
});
