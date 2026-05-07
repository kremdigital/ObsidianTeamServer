// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  compare,
  emptyClock,
  happensBefore,
  increment,
  isConcurrent,
  merge,
  parseClock,
} from './vector-clock';

describe('vector clock', () => {
  it('increment bumps only the named client', () => {
    const a = increment(emptyClock(), 'A');
    expect(a).toEqual({ A: 1 });
    const a2 = increment(a, 'A');
    expect(a2).toEqual({ A: 2 });
    const ab = increment(a2, 'B');
    expect(ab).toEqual({ A: 2, B: 1 });
  });

  it('merge takes element-wise maximum', () => {
    expect(merge({ A: 1, B: 5 }, { A: 3, B: 2, C: 7 })).toEqual({ A: 3, B: 5, C: 7 });
  });

  it('detects strict precedence', () => {
    expect(compare({ A: 1 }, { A: 2 })).toBe('before');
    expect(compare({ A: 2 }, { A: 1 })).toBe('after');
    expect(happensBefore({ A: 1 }, { A: 1, B: 1 })).toBe(true);
    expect(happensBefore({ A: 2 }, { A: 1 })).toBe(false);
  });

  it('detects equality', () => {
    expect(compare({ A: 1, B: 2 }, { A: 1, B: 2 })).toBe('equal');
    expect(compare({}, {})).toBe('equal');
  });

  it('detects concurrency', () => {
    expect(isConcurrent({ A: 1 }, { B: 1 })).toBe(true);
    expect(compare({ A: 2, B: 1 }, { A: 1, B: 2 })).toBe('concurrent');
  });

  it('parseClock filters out invalid entries', () => {
    expect(parseClock(null)).toEqual({});
    expect(parseClock([1, 2, 3])).toEqual({});
    expect(parseClock({ A: 1, B: -1, C: 'oops', D: 1.5 })).toEqual({ A: 1 });
  });
});
