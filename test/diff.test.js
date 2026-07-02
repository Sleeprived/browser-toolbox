import { describe, it, expect } from 'vitest';
import { diffLines, diffWords, MAX_DIFF_CHARS } from '../src/diff/diff.js';

const join = (ops, type) => ops.filter((o) => o.type === type).map((o) => o.text);

describe('diffLines', () => {
  it('identical inputs are all "same"', () => {
    const { ops } = diffLines('a\nb\nc', 'a\nb\nc');
    expect(ops.every((o) => o.type === 'same')).toBe(true);
    expect(ops.length).toBe(3);
  });

  it('reports an added and a removed line', () => {
    const { ops } = diffLines('one\ntwo\nthree', 'one\n2\nthree');
    expect(join(ops, 'del')).toEqual(['two']);
    expect(join(ops, 'add')).toEqual(['2']);
    expect(join(ops, 'same')).toEqual(['one', 'three']);
  });

  it('handles pure insertion and pure deletion', () => {
    expect(join(diffLines('a\nc', 'a\nb\nc').ops, 'add')).toEqual(['b']);
    expect(join(diffLines('a\nb\nc', 'a\nc').ops, 'del')).toEqual(['b']);
  });

  it('reconstructs both inputs exactly from the ops (losslessness)', () => {
    const a = 'x\ny\nz\nw';
    const b = 'x\nq\nz';
    const { ops } = diffLines(a, b);
    const left = ops.filter((o) => o.type !== 'add').map((o) => o.text).join('\n');
    const right = ops.filter((o) => o.type !== 'del').map((o) => o.text).join('\n');
    expect(left).toBe(a);
    expect(right).toBe(b);
  });

  it('emits del before add for a replaced line (replace-pair ordering)', () => {
    const { ops } = diffLines('keep\nold line\nkeep2', 'keep\nnew line\nkeep2');
    const types = ops.map((o) => o.type);
    expect(types).toEqual(['same', 'del', 'add', 'same']);
  });

  it('handles empty sides without crashing', () => {
    expect(diffLines('', '').ops).toEqual([{ type: 'same', text: '' }]);
    expect(join(diffLines('', 'a\nb').ops, 'add').length).toBeGreaterThan(0);
  });

  it('finds an LCS through interleaved changes', () => {
    const { ops } = diffLines('a\nb\nc\nd', 'b\nx\nd');
    expect(join(ops, 'same')).toEqual(['b', 'd']);
  });

  it('refuses an over-size pane with tooLarge, not a hang', () => {
    const big = 'x'.repeat(MAX_DIFF_CHARS + 1);
    expect(diffLines(big, 'x')).toEqual({ tooLarge: true });
    expect(diffLines('x', big)).toEqual({ tooLarge: true });
  });

  it('refuses a middle whose LCS table would blow the cell budget', () => {
    // Two fully-different 3000-line bodies → 9M cells > 4M cap.
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n');
    expect(diffLines(a, b)).toEqual({ tooLarge: true });
  });

  it('common prefix/suffix trimming lets large-but-similar inputs through', () => {
    const lines = Array.from({ length: 50000 }, (_, i) => `line ${i}`);
    const a = lines.join('\n');
    const changed = [...lines];
    changed[25000] = 'CHANGED';
    const { ops } = diffLines(a, changed.join('\n'));
    expect(join(ops, 'del')).toEqual(['line 25000']);
    expect(join(ops, 'add')).toEqual(['CHANGED']);
  });
});

describe('diffWords', () => {
  it('marks only the changed word', () => {
    const { a, b } = diffWords('the quick fox', 'the slow fox');
    expect(a.map((s) => s.text).join('')).toBe('the quick fox');
    expect(b.map((s) => s.text).join('')).toBe('the slow fox');
    expect(a.find((s) => s.changed).text.trim()).toBe('quick');
    expect(b.find((s) => s.changed).text.trim()).toBe('slow');
  });

  it('marks nothing when the lines are equal', () => {
    const { a, b } = diffWords('same line', 'same line');
    expect(a.every((s) => !s.changed)).toBe(true);
    expect(b.every((s) => !s.changed)).toBe(true);
  });

  it('falls back to whole-line changed for token-heavy lines', () => {
    const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ');
    const { a } = diffWords(long, 'other');
    expect(a).toEqual([{ text: long, changed: true }]);
  });
});

describe('LCS cell cap matches the real allocation', () => {
  it('refuses a skewed middle whose (n+1)*(m+1) table would exceed the cap', () => {
    // 1,999,999 empty lines vs 2 lines: n*m = 3,999,998 slips under a 4M n*m
    // check, but the real allocation is (n+1)*(m+1) = 6M cells — must refuse.
    const a = '\n'.repeat(1999998);
    expect(diffLines(a, 'x\ny').tooLarge).toBe(true);
  });
});

describe('large middles survive the backtrack', () => {
  it('a skewed diff under the caps does not overflow the argument limit', () => {
    // 1 line vs 200,000 lines passes every cap, but its ~200k-op middle used
    // to be spread into ops.push(...) and threw RangeError.
    const b = Array.from({ length: 200000 }, (_, i) => `b${i}`).join('\n');
    const { ops } = diffLines('x', b);
    expect(ops.length).toBe(200001); // 1 del + 200,000 adds
    expect(ops.filter((o) => o.type === 'same').length).toBe(0);
  });
});
