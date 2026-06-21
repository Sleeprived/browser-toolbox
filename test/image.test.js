import { describe, it, expect } from 'vitest';
import { computeTargetSize, orientationToTransform } from '../src/image/image.js';

describe('computeTargetSize', () => {
  it('locks aspect ratio from width', () => {
    expect(computeTargetSize(4000, 3000, { width: 400, lock: true })).toEqual({ width: 400, height: 300 });
  });
  it('locks aspect ratio from height', () => {
    expect(computeTargetSize(4000, 3000, { height: 300, lock: true })).toEqual({ width: 400, height: 300 });
  });
  it('fits within a box when both given + locked', () => {
    expect(computeTargetSize(4000, 3000, { width: 400, height: 400, lock: true })).toEqual({ width: 400, height: 300 });
  });
  it('honors percent scaling', () => {
    expect(computeTargetSize(1000, 500, { percent: 50 })).toEqual({ width: 500, height: 250 });
  });
  it('allows free (unlocked) stretch', () => {
    expect(computeTargetSize(1000, 500, { width: 200, height: 200, lock: false })).toEqual({ width: 200, height: 200 });
  });
  it('returns source size when no constraints', () => {
    expect(computeTargetSize(800, 600, {})).toEqual({ width: 800, height: 600 });
  });
  it('throws on non-positive source', () => {
    expect(() => computeTargetSize(0, 100, { width: 10 })).toThrow();
  });
});

describe('orientationToTransform', () => {
  it('maps 1 to identity', () => {
    expect(orientationToTransform(1)).toEqual({ rotate: 0, flip: false, swap: false });
  });
  it('maps 6 to a 90° rotation with axis swap', () => {
    expect(orientationToTransform(6)).toEqual({ rotate: 90, flip: false, swap: true });
  });
  it('maps 3 to 180°', () => {
    expect(orientationToTransform(3)).toEqual({ rotate: 180, flip: false, swap: false });
  });
  it('defaults unknown values to identity', () => {
    expect(orientationToTransform(999)).toEqual({ rotate: 0, flip: false, swap: false });
  });
});
